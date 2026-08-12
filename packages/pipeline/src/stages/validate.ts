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
	 * Fraction of HYDRATED books with a non-null value, per key field.
	 * Unhydrated stubs (fresh close-series volumes) are pending work, not
	 * regressions — counting them here once discarded a whole bootstrap run.
	 */
	fieldCoverage: z.record(z.string(), z.number()),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

const COVERAGE_FIELDS = ["title", "releaseDate", "coverUrl", "rating"] as const;

export function takeSnapshot(corpus: Corpus, now: string): Snapshot {
	const books = [...corpus.books.values()];
	const hydrated = books.filter((b) => b.meta.lastHydratedAt !== null);
	const fieldCoverage: Record<string, number> = {};
	for (const field of COVERAGE_FIELDS) {
		const covered = hydrated.filter((b) => b[field] !== null).length;
		fieldCoverage[field] = hydrated.length === 0 ? 0 : covered / hydrated.length;
	}
	return {
		takenAt: now,
		books: books.length,
		series: corpus.series.size,
		hydrated: hydrated.length,
		fieldCoverage,
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
		for (const [field, prevCov] of Object.entries(prev.fieldCoverage)) {
			const nowCov = snapshot.fieldCoverage[field] ?? 0;
			const regress = (prevCov - nowCov) * 100;
			if (regress > config.validate.maxNullRegressPct) {
				problems.push(
					`${field} coverage regressed ${regress.toFixed(1)}pp (${(prevCov * 100).toFixed(1)}% → ${(nowCov * 100).toFixed(1)}%)`,
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
