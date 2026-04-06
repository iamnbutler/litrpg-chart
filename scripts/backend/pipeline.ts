/**
 * Pipeline orchestrator — ties all fetchers, matchers, classifiers, and exporters
 * together into a coherent, sequential pipeline.
 *
 * Stages:
 *   1. MIGRATE    → Apply pending database migrations
 *   2. FETCH      → Run all enabled fetchers (Audible, Hardcover, Royal Road)
 *   3. CORRECT    → Apply community corrections (manual overrides)
 *   4. CLASSIFY   → Run subgenre classification on all books
 *   5. DETECT     → Run AI narration detection
 *   6. SCORE      → Compute quality scores
 *   7. EXPORT     → Generate static JSON files
 *   8. GUARD      → Validate exported data (deploy guard)
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { runMigrations, getMigrationVersion } from "./migrate.js";
import { AudibleFetcher } from "./fetchers/audible.js";
import { closeDb } from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineOptions {
  year?: number;
  full?: boolean;
  source?: string;
  skipGuard?: boolean;
  dryRun?: boolean;
}

export interface StageResult {
  name: string;
  duration: number;
  result: "success" | "warning" | "error";
  details: string;
}

export interface PipelineResult {
  stages: StageResult[];
  totalDuration: number;
  booksProcessed: number;
  booksExported: number;
}

type StageFn = (ctx: PipelineContext) => Promise<string>;

interface StageDefinition {
  name: string;
  fn: StageFn;
  /** If true, a failure in this stage causes a non-zero exit code. */
  critical: boolean;
}

interface PipelineContext {
  options: PipelineOptions;
  years: number[];
  projectRoot: string;
  booksProcessed: number;
  booksExported: number;
}

// ---------------------------------------------------------------------------
// Stage implementations — delegate to existing modules
// ---------------------------------------------------------------------------

const stageMigrate: StageFn = async (_ctx) => {
  const count = runMigrations();
  const version = getMigrationVersion();
  if (count === 0) return `already up to date (version ${version})`;
  return `applied ${count} migration(s), now at version ${version}`;
};

const stageFetch: StageFn = async (ctx) => {
  const { options } = ctx;
  if (options.source && options.source !== "audible") {
    return `skipped (source=${options.source} not yet implemented)`;
  }

  const fetcher = new AudibleFetcher();
  const parts: string[] = [];

  for (const year of ctx.years) {
    console.log(`  Fetching ${year}...`);
    const result = await fetcher.fetch({
      year,
      incremental: !options.full,
    });
    ctx.booksProcessed += result.booksFound;
    parts.push(
      `${year}: ${result.booksNew} new, ${result.booksUpdated} updated`
    );
    if (result.errors.length > 0) {
      parts.push(`  (${result.errors.length} errors)`);
    }
  }

  return parts.join("; ");
};

const stageCorrect: StageFn = async (_ctx) => {
  // Community corrections not yet implemented (#35)
  return "not yet implemented";
};

const stageClassify: StageFn = async (_ctx) => {
  // Subgenre classification not yet implemented (#36)
  return "not yet implemented";
};

const stageDetect: StageFn = async (_ctx) => {
  // AI narration detection not yet implemented (#37)
  return "not yet implemented";
};

const stageScore: StageFn = async (_ctx) => {
  // Quality scoring not yet implemented (#38)
  return "not yet implemented";
};

const stageExport: StageFn = async (ctx) => {
  if (ctx.options.dryRun) {
    return "dry run — skipped";
  }

  // Delegate to the JSON exporter (runs as a separate process since it's a script with top-level execution)
  const exporterPath = join(
    import.meta.dirname,
    "exporters",
    "json.ts"
  );
  try {
    execSync(`npx tsx ${exporterPath}`, {
      stdio: "inherit",
      cwd: ctx.projectRoot,
    });
    return "static JSON files written";
  } catch {
    throw new Error("JSON export failed");
  }
};

const stageGuard: StageFn = async (ctx) => {
  if (ctx.options.skipGuard) {
    return "skipped (--skip-guard)";
  }
  if (ctx.options.dryRun) {
    return "skipped (dry run)";
  }

  const guardPath = join(ctx.projectRoot, "scripts", "deploy-guard.js");
  try {
    execSync(`node ${guardPath}`, {
      stdio: "inherit",
      cwd: ctx.projectRoot,
    });
    return "all checks passed";
  } catch {
    throw new Error("deploy guard failed");
  }
};

// ---------------------------------------------------------------------------
// Stage registry
// ---------------------------------------------------------------------------

const ALL_STAGES: StageDefinition[] = [
  { name: "MIGRATE", fn: stageMigrate, critical: false },
  { name: "FETCH", fn: stageFetch, critical: true },
  { name: "CORRECT", fn: stageCorrect, critical: false },
  { name: "CLASSIFY", fn: stageClassify, critical: false },
  { name: "DETECT", fn: stageDetect, critical: false },
  { name: "SCORE", fn: stageScore, critical: false },
  { name: "EXPORT", fn: stageExport, critical: true },
  { name: "GUARD", fn: stageGuard, critical: true },
];

/** Map CLI subcommands to stage index ranges (inclusive). */
export const SUBCOMMAND_STAGES: Record<string, [number, number]> = {
  fetch: [0, 1], // MIGRATE + FETCH
  export: [6, 7], // EXPORT + GUARD
  classify: [3, 5], // CLASSIFY + DETECT + SCORE
  build: [0, 7], // all stages
};

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

function determineYears(options: PipelineOptions): number[] {
  if (options.year) return [options.year];
  const current = new Date().getFullYear();
  return [current - 1, current, current + 1];
}

export async function runPipeline(
  options: PipelineOptions = {},
  stageRange?: [number, number]
): Promise<PipelineResult> {
  const start = Date.now();
  const years = determineYears(options);

  const projectRoot = join(import.meta.dirname, "..", "..");

  const ctx: PipelineContext = {
    options,
    years,
    projectRoot,
    booksProcessed: 0,
    booksExported: 0,
  };

  const [startIdx, endIdx] = stageRange ?? [0, ALL_STAGES.length - 1];
  const stagesToRun = ALL_STAGES.slice(startIdx, endIdx + 1);
  const totalStages = ALL_STAGES.length;

  console.log("Pipeline started");

  const results: StageResult[] = [];

  for (const stage of stagesToRun) {
    const stageIdx = ALL_STAGES.indexOf(stage);
    const label = `  [${stageIdx + 1}/${totalStages}]`;
    const stageStart = Date.now();

    let result: StageResult;
    try {
      const details = await stage.fn(ctx);
      const duration = (Date.now() - stageStart) / 1000;
      result = { name: stage.name, duration, result: "success", details };
      console.log(
        `${label} ${stage.name.padEnd(10)} \u2713 (${duration.toFixed(1)}s) \u2014 ${details}`
      );
    } catch (err: unknown) {
      const duration = (Date.now() - stageStart) / 1000;
      const msg = err instanceof Error ? err.message : String(err);
      const severity = stage.critical ? "error" : "warning";
      result = { name: stage.name, duration, result: severity, details: msg };
      const icon = stage.critical ? "\u2717" : "\u26A0";
      console.error(
        `${label} ${stage.name.padEnd(10)} ${icon} (${duration.toFixed(1)}s) \u2014 ${msg}`
      );
    }

    results.push(result);
  }

  closeDb();

  const totalDuration = (Date.now() - start) / 1000;

  console.log(
    `\nPipeline completed in ${totalDuration.toFixed(1)}s \u2014 ` +
      `${ctx.booksProcessed} books processed, ${ctx.booksExported} exported`
  );

  return {
    stages: results,
    totalDuration,
    booksProcessed: ctx.booksProcessed,
    booksExported: ctx.booksExported,
  };
}

export function hasCriticalFailure(result: PipelineResult): boolean {
  return result.stages.some((s) => s.result === "error");
}
