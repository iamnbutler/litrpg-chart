/**
 * VALIDATE: the regression guard, gating the data commit (not the deploy).
 * Compares the corpus about to be saved against the last committed snapshot;
 * shrinkage or field-quality regression beyond thresholds fails the run
 * before anything is written back.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { PipelineConfig } from "../config.ts";
import type { Corpus } from "../types.ts";

const SnapshotSchema = z.object({
	takenAt: z.string(),
	books: z.number().int(),
	series: z.number().int(),
	hydrated: z.number().int().default(0),
	/**
	 * ABSOLUTE count of books with a non-null value, per key field.
	 * Ratios proved composition-sensitive: hydrating the long tail (preorders
	 * without cover art yet) diluted coverage and false-failed healthy runs.
	 * Counts only fall when existing values are destroyed — which is the one
	 * thing merge-only writes should make impossible, so a drop means a bug.
	 */
	fieldCovered: z.record(z.string(), z.number()).default({}),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

const COVERAGE_FIELDS = ["title", "releaseDate", "coverUrl", "rating"] as const;

export function takeSnapshot(corpus: Corpus, now: string): Snapshot {
	const books = [...corpus.books.values()];
	const hydrated = books.filter((b) => b.meta.lastHydratedAt !== null);
	const fieldCovered: Record<string, number> = {};
	for (const field of COVERAGE_FIELDS) {
		fieldCovered[field] = books.filter((b) => b[field] !== null).length;
	}
	return {
		takenAt: now,
		books: books.length,
		series: corpus.series.size,
		hydrated: hydrated.length,
		fieldCovered,
	};
}

export interface ValidateResult {
	ok: boolean;
	problems: string[];
	snapshot: Snapshot;
}

export function validate(
	corpus: Corpus,
	config: PipelineConfig,
	snapshotPath: string,
	now: string,
): ValidateResult {
	const snapshot = takeSnapshot(corpus, now);
	const problems: string[] = [];

	if (existsSync(snapshotPath)) {
		const prev = SnapshotSchema.parse(JSON.parse(readFileSync(snapshotPath, "utf8")));

		const bookShrink = prev.books === 0 ? 0 : ((prev.books - snapshot.books) / prev.books) * 100;
		if (bookShrink > config.validate.maxBookShrinkPct) {
			problems.push(
				`books shrank ${bookShrink.toFixed(1)}% (${prev.books} → ${snapshot.books}), max allowed ${config.validate.maxBookShrinkPct}%`,
			);
		}
		const seriesShrink =
			prev.series === 0 ? 0 : ((prev.series - snapshot.series) / prev.series) * 100;
		if (seriesShrink > config.validate.maxSeriesShrinkPct) {
			problems.push(
				`series shrank ${seriesShrink.toFixed(1)}% (${prev.series} → ${snapshot.series}), max allowed ${config.validate.maxSeriesShrinkPct}%`,
			);
		}
		for (const [field, prevCount] of Object.entries(prev.fieldCovered ?? {})) {
			const nowCount = snapshot.fieldCovered[field] ?? 0;
			const dropPct = prevCount === 0 ? 0 : ((prevCount - nowCount) / prevCount) * 100;
			if (dropPct > config.validate.maxNullRegressPct) {
				problems.push(
					`books with ${field} dropped ${prevCount} → ${nowCount} (-${dropPct.toFixed(1)}%) — existing values were destroyed`,
				);
			}
		}
	}

	return { ok: problems.length === 0, problems, snapshot };
}

export function writeSnapshot(snapshotPath: string, snapshot: Snapshot): void {
	mkdirSync(dirname(snapshotPath), { recursive: true });
	writeFileSync(snapshotPath, JSON.stringify(snapshot, null, "\t") + "\n", "utf8");
}

export function snapshotPathFor(dataDir: string): string {
	return join(dataDir, "snapshots", "meta.json");
}
