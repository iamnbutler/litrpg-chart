/**
 * Typed client for the (undocumented) Audible catalog API.
 *
 * Hard-won facts this client encodes:
 * - Throttling returns HTTP 200 with products:[] while total_results still
 *   reports the real count. That signature throws ThrottleError, which
 *   aborts the whole run without writing state (the circuit breaker).
 * - `title` comes from the product_desc response group, NOT product_attrs.
 * - Pagination silently caps around page 10 (~550 results per query).
 * - `series=` filtering is broken, but the series-parent ASIN's
 *   `relationships` response group lists every volume with sequence numbers.
 * - Every request draws from a run-wide budget; exceeding it raises
 *   BudgetExhausted, which ends the run cleanly (progress is kept).
 */
import type { HttpClient } from "./http.ts";
import type { Rating, SeriesRef, SourceRecord } from "./types.ts";

const API = "https://api.audible.com/1.0";
export const MAX_RESULTS_PER_PAGE = 50;
/** Pages beyond this silently repeat; never request past it. */
export const MAX_PAGE = 9;

export const HYDRATE_RESPONSE_GROUPS =
	"product_desc,product_attrs,contributors,media,rating,series,category_ladders";
const SEARCH_RESPONSE_GROUPS = "product_desc,product_attrs,contributors,series,rating,media";

export class ThrottleError extends Error {
	constructor(public readonly url: string) {
		super(`Audible throttle signature (200 + empty products with nonzero total) at ${url}`);
		this.name = "ThrottleError";
	}
}

export class BudgetExhausted extends Error {
	constructor(public readonly limit: number) {
		super(`Request budget of ${limit} exhausted`);
		this.name = "BudgetExhausted";
	}
}

export class RequestBudget {
	#used = 0;
	constructor(public readonly limit: number) {}
	get used(): number {
		return this.#used;
	}
	get remaining(): number {
		return Math.max(0, this.limit - this.#used);
	}
	take(): void {
		if (this.#used >= this.limit) throw new BudgetExhausted(this.limit);
		this.#used++;
	}
}

// ---- Raw API shapes (only the fields we read) ----

interface RawProduct {
	asin: string;
	title?: string;
	subtitle?: string;
	authors?: Array<{ name: string; asin?: string }>;
	narrators?: Array<{ name: string }>;
	series?: Array<{ asin?: string; title?: string; sequence?: string }>;
	release_date?: string;
	runtime_length_min?: number;
	language?: string;
	rating?: {
		overall_distribution?: { display_average_rating?: string | number; num_ratings?: number };
	};
	product_images?: Record<string, string>;
	publisher_name?: string;
	publisher_summary?: string;
	merchandising_summary?: string;
	relationships?: Array<{
		asin: string;
		relationship_type: string;
		relationship_to_product: string;
		sequence?: string;
		sort?: string;
	}>;
}

interface CatalogResponse {
	products?: RawProduct[];
	total_results?: number;
}

export interface SearchQuery {
	keywords?: string;
	categoryId?: string;
	page?: number;
	sortBy?: "-ReleaseDate" | "ReleaseDate" | "-Title" | "Title" | "BestSellers";
}

export interface SeriesVolume {
	asin: string;
	sequence: string | null;
}

export class AudibleClient {
	constructor(
		private readonly http: HttpClient,
		public readonly budget: RequestBudget,
	) {}

	async search(q: SearchQuery): Promise<{ products: RawProduct[]; totalResults: number }> {
		this.budget.take();
		const params: Record<string, string> = {
			num_results: String(MAX_RESULTS_PER_PAGE),
			page: String(Math.min(q.page ?? 0, MAX_PAGE)),
			products_sort_by: q.sortBy ?? "-ReleaseDate",
			response_groups: SEARCH_RESPONSE_GROUPS,
		};
		if (q.keywords) params.keywords = q.keywords;
		if (q.categoryId) params.category_id = q.categoryId;

		const url = `${API}/catalog/products`;
		const res = await this.http.get<CatalogResponse>(url, params);
		const products = res.products ?? [];
		const totalResults = res.total_results ?? 0;
		if (products.length === 0 && totalResults > 0) throw new ThrottleError(url);
		return { products, totalResults };
	}

	/** Full product fetch (hydration). Returns null on 404/gone. */
	async getProduct(asin: string): Promise<RawProduct | null> {
		this.budget.take();
		try {
			const res = await this.http.get<{ product?: RawProduct }>(
				`${API}/catalog/products/${asin}`,
				{ response_groups: HYDRATE_RESPONSE_GROUPS },
			);
			return res.product ?? null;
		} catch (err) {
			if (isNotFound(err)) return null;
			throw err;
		}
	}

	/**
	 * Every volume in a series, via the series-parent product's relationships.
	 * One request per series — this is what closes catalog gaps.
	 */
	async getSeriesVolumes(seriesAsin: string): Promise<SeriesVolume[] | null> {
		this.budget.take();
		try {
			const res = await this.http.get<{ product?: RawProduct }>(
				`${API}/catalog/products/${seriesAsin}`,
				{ response_groups: "relationships" },
			);
			const rels = res.product?.relationships ?? [];
			return rels
				.filter((r) => r.relationship_type === "series" && r.relationship_to_product === "child")
				.map((r) => ({ asin: r.asin, sequence: r.sequence ?? null }));
		} catch (err) {
			if (isNotFound(err)) return null;
			throw err;
		}
	}
}

function isNotFound(err: unknown): boolean {
	return typeof err === "object" && err !== null && "status" in err && (err as { status: number }).status === 404;
}

// ---- Normalization into the intermediary exchange format ----

const AI_NARRATOR = /virtual voice/i;

export function toSourceRecord(p: RawProduct, isHydration: boolean, now: string): SourceRecord {
	const narrators = (p.narrators ?? []).map((n) => n.name).filter(Boolean);
	const fields: SourceRecord["fields"] = {};

	if (p.title) fields.title = p.title;
	if (p.subtitle) fields.subtitle = p.subtitle;
	const authors = (p.authors ?? []).map((a) => a.name).filter(Boolean);
	if (authors.length) fields.authors = authors;
	if (narrators.length) {
		fields.narrators = narrators.filter((n) => !AI_NARRATOR.test(n));
		fields.aiNarrated = narrators.some((n) => AI_NARRATOR.test(n));
	}
	const series = toSeriesRef(p);
	if (series) fields.series = series;
	if (p.release_date) fields.releaseDate = p.release_date.slice(0, 10);
	if (p.runtime_length_min != null) fields.runtimeMin = p.runtime_length_min;
	if (p.language) fields.language = p.language.toLowerCase();
	const rating = toRating(p);
	if (rating) fields.rating = rating;
	const cover = p.product_images?.["500"] ?? Object.values(p.product_images ?? {})[0];
	if (cover) fields.coverUrl = cover;
	const description = stripHtml(p.publisher_summary ?? p.merchandising_summary ?? "");
	if (description) fields.description = description;
	if (p.publisher_name) fields.publisher = p.publisher_name;

	return { source: "audible", asin: p.asin, fetchedAt: now, fields, isHydration };
}

function toSeriesRef(p: RawProduct): SeriesRef | null {
	const s = p.series?.[0];
	if (!s?.asin || !s.title) return null;
	return { asin: s.asin, name: s.title, position: s.sequence ?? null };
}

function toRating(p: RawProduct): Rating | null {
	const d = p.rating?.overall_distribution;
	if (!d || d.num_ratings == null) return null;
	const avg = typeof d.display_average_rating === "string"
		? Number.parseFloat(d.display_average_rating)
		: d.display_average_rating;
	if (avg == null || Number.isNaN(avg)) return null;
	return { avg, count: d.num_ratings };
}

export function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function audibleUrl(asin: string): string {
	return `https://www.audible.com/pd/${asin}`;
}
