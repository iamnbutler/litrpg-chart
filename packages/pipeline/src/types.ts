/**
 * Canonical record types — the shapes stored in data/*.ndjson.
 *
 * Design rules:
 * - Book identity is the Audible ASIN; series identity is the Audible
 *   series ASIN. Never title slugs.
 * - Fetchers never touch these records directly: they emit SourceRecords
 *   (the intermediary exchange format), and merge.ts is the only writer.
 * - Corrections are applied at READ time (see corrections.ts), so fetched
 *   data and manual overrides can never fight over the same stored field.
 */
import { z } from "zod";
import { SubgenreSchema } from "@litrpg/contract";

export const SeriesRefSchema = z.object({
	asin: z.string(),
	name: z.string(),
	/** Audible sequence string ("1", "2.5", "1-3"), verbatim. */
	position: z.string().nullable(),
});
export type SeriesRef = z.infer<typeof SeriesRefSchema>;

export const RatingSchema = z.object({
	avg: z.number(),
	count: z.number().int(),
});
export type Rating = z.infer<typeof RatingSchema>;

export const BookRecordSchema = z.object({
	asin: z.string().min(1),
	/** Null until first hydration (seed rows may start with a title). */
	title: z.string().nullable(),
	/** Often carries the strongest genre signal ("A LitRPG Adventure"). */
	subtitle: z.string().nullable(),
	authors: z.array(z.string()),
	narrators: z.array(z.string()),
	series: SeriesRefSchema.nullable(),
	/** ISO date YYYY-MM-DD. */
	releaseDate: z.string().nullable(),
	runtimeMin: z.number().int().nullable(),
	language: z.string().nullable(),
	rating: RatingSchema.nullable(),
	coverUrl: z.string().nullable(),
	description: z.string().nullable(),
	publisher: z.string().nullable(),
	aiNarrated: z.boolean(),
	/** Book-level subgenres; series-level classification is the norm. */
	subgenres: z.array(SubgenreSchema).nullable(),
	meta: z.object({
		firstSeenAt: z.string(),
		lastHydratedAt: z.string().nullable(),
		/** Sources that have contributed fields to this record. */
		sources: z.array(z.string()),
	}),
});
export type BookRecord = z.infer<typeof BookRecordSchema>;

export const SeriesRecordSchema = z.object({
	asin: z.string().min(1),
	name: z.string().min(1),
	subgenres: z.array(SubgenreSchema),
	classifiedBy: z.enum(["keyword", "manual"]).nullable(),
	/**
	 * Whether this series belongs on the chart at all.
	 * null = undecided (exported only if classification found genre signals);
	 * false = curated out (set via corrections, replaces v1's blocklists);
	 * true = curated in.
	 */
	include: z.boolean().nullable(),
	/** Last successful series-closure check (relationships fetch). */
	lastClosedAt: z.string().nullable(),
});
export type SeriesRecord = z.infer<typeof SeriesRecordSchema>;

export const CorrectionSchema = z.object({
	kind: z.enum(["book", "series"]),
	/** Book ASIN or series ASIN. */
	target: z.string().min(1),
	/** Field patches, applied at read time; always win over fetched data. */
	set: z.record(z.string(), z.unknown()),
	note: z.string().optional(),
});
export type Correction = z.infer<typeof CorrectionSchema>;

/**
 * The intermediary exchange format between fetchers and the canonical store.
 * Every source (Audible today; Audnexus/Hardcover later) normalizes into
 * this shape, and merge.ts folds it into BookRecords under merge rules.
 * A field that is `undefined` means "this source says nothing about it" —
 * distinct from `null`, which means "this source affirms it is absent".
 */
export interface SourceRecord {
	source: "audible" | "audnexus" | "hardcover" | "seed";
	asin: string;
	fetchedAt: string;
	fields: Partial<{
		title: string;
		subtitle: string;
		authors: string[];
		narrators: string[];
		series: SeriesRef | null;
		releaseDate: string;
		runtimeMin: number;
		language: string;
		rating: Rating | null;
		coverUrl: string;
		description: string;
		publisher: string;
		aiNarrated: boolean;
	}>;
	/** True only for full product fetches (sets meta.lastHydratedAt). */
	isHydration: boolean;
}

export interface Corpus {
	books: Map<string, BookRecord>;
	series: Map<string, SeriesRecord>;
	corrections: Correction[];
}
