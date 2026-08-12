/**
 * Pipeline CLI.
 *
 *   bun src/cli.ts run        # discover → close-series → hydrate → classify → validate → save → export
 *   bun src/cli.ts discover|close-series|hydrate   # single fetch stage (+ classify/validate/save)
 *   bun src/cli.ts classify   # offline: reclassify + validate + save
 *   bun src/cli.ts export     # offline: export static JSON from committed data
 *   bun src/cli.ts validate   # offline: check corpus against snapshot
 *   bun src/cli.ts stats      # offline: corpus health report
 *
 * Flags: --budget N (default from config) --data-dir PATH --out-dir PATH
 *
 * Exit codes: 0 = ok (including a throttle-shortened run whose data still
 * validates), 1 = hard error, 2 = validation failure (nothing saved).
 *
 * Fetch stages stop cleanly on BudgetExhausted; ThrottleError additionally
 * flags the run summary so CI can surface it. Progress made before either
 * stop is kept — merge-only writes make partial runs safe by construction.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Corpus } from "./types.ts";
import { createHttpClient } from "./http.ts";
import { AudibleClient, BudgetExhausted, RequestBudget, ThrottleError } from "./audible.ts";
import { loadCorpus, saveCorpus } from "./store.ts";
import { loadExportFilters, loadPipelineConfig, loadSubgenrePatterns } from "./config.ts";
import { discover } from "./stages/discover.ts";
import { closeSeries } from "./stages/closeSeries.ts";
import { hydrate, selectHydrationQueue } from "./stages/hydrate.ts";
import { classify } from "./stages/classify.ts";
import { snapshotPathFor, validate, writeSnapshot } from "./stages/validate.ts";
import { exportData } from "./stages/export.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_DATA_DIR = join(ROOT, "data");
const DEFAULT_OUT_DIR = join(ROOT, "packages", "web", "static", "data");

interface Args {
	command: string;
	budget: number | null;
	dataDir: string;
	outDir: string;
}

function parseArgs(argv: string[]): Args {
	const [command = "run", ...rest] = argv;
	const args: Args = { command, budget: null, dataDir: DEFAULT_DATA_DIR, outDir: DEFAULT_OUT_DIR };
	for (let i = 0; i < rest.length; i++) {
		const flag = rest[i];
		const val = () => {
			const v = rest[++i];
			if (v === undefined) throw new Error(`missing value for ${flag}`);
			return v;
		};
		if (flag === "--budget") args.budget = Number.parseInt(val(), 10);
		else if (flag === "--data-dir") args.dataDir = resolve(val());
		else if (flag === "--out-dir") args.outDir = resolve(val());
		else throw new Error(`unknown flag: ${flag}`);
	}
	return args;
}

const log = (msg: string) => console.error(`[pipeline] ${msg}`);

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const config = loadPipelineConfig();
	const patterns = loadSubgenrePatterns();
	const now = new Date().toISOString();
	const corpus = loadCorpus(args.dataDir);
	log(`loaded corpus: ${corpus.books.size} books, ${corpus.series.size} series, ${corpus.corrections.length} corrections`);

	const summary: Record<string, unknown> = { startedAt: now, command: args.command, throttled: false };

	// ---- Offline commands ----
	if (args.command === "stats") {
		printStats(corpus);
		return 0;
	}
	if (args.command === "export") {
		const result = exportData(corpus, loadExportFilters(), args.outDir, now);
		log(`export: ${result.books} books, ${result.series} series, years ${result.years[0]}–${result.years.at(-1)}`);
		log(`export dropped: ${JSON.stringify(result.dropped)}`);
		return 0;
	}
	if (args.command === "validate") {
		const v = validate(corpus, config, snapshotPathFor(args.dataDir), now);
		for (const p of v.problems) log(`VALIDATION: ${p}`);
		log(v.ok ? "validate: ok" : "validate: FAILED");
		return v.ok ? 0 : 2;
	}

	// ---- Fetch + save commands ----
	const budget = new RequestBudget(args.budget ?? config.budgetDefault);
	const client = new AudibleClient(createHttpClient({ minDelayMs: 500 }), budget);

	const fetchStages: Record<string, () => Promise<void>> = {
		discover: async () => {
			summary.discover = await discover(corpus, client, config, patterns, now, log);
		},
		"close-series": async () => {
			summary.closeSeries = await closeSeries(corpus, client, config, now, log);
		},
		hydrate: async () => {
			summary.hydrate = await hydrate(corpus, client, now, log);
		},
	};

	const sequence =
		args.command === "run"
			? ["discover", "close-series", "hydrate"]
			: args.command === "classify"
				? []
				: fetchStages[args.command]
					? [args.command]
					: null;
	if (sequence === null) throw new Error(`unknown command: ${args.command}`);

	try {
		for (const stage of sequence) await fetchStages[stage]();
	} catch (err) {
		if (err instanceof BudgetExhausted) {
			log(`budget exhausted (${budget.limit} requests) — keeping progress, moving on`);
		} else if (err instanceof ThrottleError) {
			summary.throttled = true;
			log(`THROTTLED: ${err.message}`);
			log("keeping progress made before the throttle; aborting further fetches");
		} else {
			throw err;
		}
	}
	log(`requests used: ${budget.used}/${budget.limit}`);

	summary.classify = classify(corpus, patterns);

	const v = validate(corpus, config, snapshotPathFor(args.dataDir), now);
	for (const p of v.problems) log(`VALIDATION: ${p}`);
	if (!v.ok) {
		log("validate: FAILED — nothing saved");
		return 2;
	}

	saveCorpus(args.dataDir, corpus);
	writeSnapshot(snapshotPathFor(args.dataDir), v.snapshot);
	log(`saved corpus: ${corpus.books.size} books, ${corpus.series.size} series`);

	if (args.command === "run") {
		const result = exportData(corpus, loadExportFilters(), args.outDir, now);
		summary.export = result;
		log(`export: ${result.books} books across ${result.years.length} years`);
	}

	// Machine-readable run summary for CI (commit messages, issue bodies).
	const summaryDir = join(args.dataDir, "snapshots");
	mkdirSync(summaryDir, { recursive: true });
	summary.finishedAt = new Date().toISOString();
	summary.requestsUsed = budget.used;
	summary.books = corpus.books.size;
	summary.series = corpus.series.size;
	writeFileSync(join(summaryDir, "last-run.json"), JSON.stringify(summary, null, "\t") + "\n");

	return 0;
}

function printStats(corpus: Corpus): void {
	const books = [...corpus.books.values()];
	const unhydrated = books.filter((b) => b.meta.lastHydratedAt === null).length;
	const rated = books.filter((b) => b.rating !== null).length;
	const inSeries = books.filter((b) => b.series !== null).length;
	const years = new Map<string, number>();
	for (const b of books) {
		if (!b.releaseDate) continue;
		const y = b.releaseDate.slice(0, 4);
		years.set(y, (years.get(y) ?? 0) + 1);
	}
	const withGenre = [...corpus.series.values()].filter((s) => s.subgenres.length > 0).length;
	console.log(`books:  ${books.length} (${unhydrated} unhydrated, ${rated} rated, ${inSeries} in series)`);
	console.log(`series: ${corpus.series.size} (${withGenre} with subgenres)`);
	console.log(`hydration queue: ${selectHydrationQueue(corpus).length}`);
	console.log("by year:");
	for (const [y, n] of [...years.entries()].sort()) console.log(`  ${y}: ${n}`);
}

main().then(
	(code) => process.exit(code),
	(err) => {
		console.error(`[pipeline] FATAL: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
		process.exit(1);
	},
);
