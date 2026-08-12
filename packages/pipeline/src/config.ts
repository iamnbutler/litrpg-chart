/** Pipeline configuration: discovery slices, closure policy, validation thresholds. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "config");

const PipelineConfigSchema = z.object({
	budgetDefault: z.number().int().positive(),
	discovery: z.object({
		comment: z.string().optional(),
		categories: z.array(
			z.object({ id: z.string(), name: z.string(), pages: z.number().int().min(1).max(10) }),
		),
		keywords: z.array(z.object({ q: z.string(), pages: z.number().int().min(1).max(10) })),
	}),
	closure: z.object({
		activeWindowDays: z.number().int().positive(),
		activeRefreshDays: z.number().int().positive(),
		dormantRefreshDays: z.number().int().positive(),
	}),
	validate: z.object({
		maxBookShrinkPct: z.number().nonnegative(),
		maxSeriesShrinkPct: z.number().nonnegative(),
		maxNullRegressPct: z.number().nonnegative(),
	}),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

const ExportFiltersSchema = z.object({
	authorBlocklist: z.array(z.string()),
	contentPatterns: z.array(z.string()),
});
export type ExportFilters = z.infer<typeof ExportFiltersSchema>;

export type SubgenrePatterns = Record<string, RegExp[]>;

function readJson(file: string): unknown {
	return JSON.parse(readFileSync(join(CONFIG_DIR, file), "utf8"));
}

export function loadPipelineConfig(): PipelineConfig {
	return PipelineConfigSchema.parse(readJson("pipeline.json"));
}

/** v1 file shape: { authorBlocklist: string[], contentFilter: { patterns: string[] }, ... } */
export function loadExportFilters(): ExportFilters {
	const raw = readJson("export-filters.json") as {
		authorBlocklist?: string[];
		contentFilter?: { patterns?: string[] };
	};
	return ExportFiltersSchema.parse({
		authorBlocklist: raw.authorBlocklist ?? [],
		contentPatterns: raw.contentFilter?.patterns ?? [],
	});
}

/**
 * Subgenre keyword patterns (salvaged from v1's subgenres.json:
 * { <subgenre>: { patterns: string[], weight: {...} }, defaultSubgenre }).
 * Weights are dropped — classification is series-level and binary now.
 */
export function loadSubgenrePatterns(): SubgenrePatterns {
	const raw = readJson("subgenres.json") as Record<string, { patterns?: string[] } | string>;
	const out: SubgenrePatterns = {};
	for (const [key, value] of Object.entries(raw)) {
		if (key === "defaultSubgenre" || typeof value === "string") continue;
		out[key] = (value.patterns ?? []).map((p) => new RegExp(p, "i"));
	}
	return out;
}
