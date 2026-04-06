import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHttpClient, type HttpClient } from "../http.js";
import {
  upsertBook,
  upsertBookSource,
  setBookSubgenres,
  insertFetchRun,
  completeFetchRun,
  upsertSearchCursor,
  getSearchCursor,
  type BookRow,
} from "../db/index.js";
import type { Fetcher, FetcherResult } from "./types.js";

const AUDIBLE_API = "https://api.audible.com/1.0/catalog/products";
const RESPONSE_GROUPS =
  "product_attrs,contributors,series,media,rating,category_ladders";

/** How many days before a search cursor is considered stale */
const CURSOR_STALE_DAYS = 7;

interface AudibleProduct {
  asin: string;
  title?: string;
  subtitle?: string;
  merchandising_summary?: string;
  language?: string;
  release_date?: string;
  publication_datetime?: string;
  runtime_length_min?: number;
  authors?: { asin?: string; name: string }[];
  narrators?: { name: string }[];
  series?: { asin?: string; title: string; sequence?: string }[];
  product_images?: Record<string, string>;
  rating?: { overall_distribution?: { average_rating?: number; num_ratings?: number } };
  category_ladders?: { ladder: { id: string; name: string }[] }[];
}

interface AudibleResponse {
  products?: AudibleProduct[];
  total_results?: number;
}

interface CategoryConfig {
  id: string;
  name: string;
  maxPages: number;
}

interface SearchConfig {
  genres: string[];
  series: string[];
  categories: CategoryConfig[];
}

function loadSearchConfig(): SearchConfig {
  const configPath = join(
    import.meta.dirname,
    "..",
    "config",
    "audible-searches.json"
  );
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#xa0;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function guessSubgenres(product: AudibleProduct): string[] {
  const text = [product.title, product.subtitle, product.merchandising_summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const subgenres: string[] = [];
  if (/litrpg|lit[\s-]?rpg|gamelit/.test(text)) subgenres.push("litrpg");
  if (/cultivation|cultivator|qi |dao |xianxia|wuxia/.test(text))
    subgenres.push("cultivation");
  if (/dungeon\s*core|dungeon\s*crawl/.test(text))
    subgenres.push("dungeon");
  if (
    /isekai|transported|reincarnated|reborn\s*(in|as|into)|summoned\s*(to|into)|another\s*world/.test(
      text
    )
  )
    subgenres.push("isekai");
  return subgenres;
}

/** Detect AI narration: "Virtual Voice", voice replicas/clones, or no narrator. */
function isAiNarrated(p: AudibleProduct): boolean {
  const narrators = p.narrators ?? [];
  if (narrators.length === 0) return true;
  return narrators.some((n) =>
    /virtual\s*voice|voice\s*replica|voice\s*clone|ai[\s-]*narrat/i.test(n.name)
  );
}

function productToBookRow(p: AudibleProduct): BookRow {
  const series = p.series?.[0];
  let seriesNumber: number | null = null;
  if (series?.sequence) {
    const num = parseFloat(series.sequence);
    if (!isNaN(num)) seriesNumber = num;
  }

  let title = p.title ?? "";
  if (!title && series) {
    title = seriesNumber ? `${series.title} ${seriesNumber}` : series.title;
  }
  if (!title) title = "Untitled";

  const rating = p.rating?.overall_distribution;

  return {
    id: p.asin,
    title,
    subtitle: p.subtitle ?? null,
    author: (p.authors ?? []).map((a) => a.name).join(", ") || null,
    narrator: (p.narrators ?? []).map((n) => n.name).join(", ") || null,
    series_name: series?.title ?? null,
    series_number: seriesNumber,
    release_date: p.release_date ?? null,
    cover_url: p.product_images?.["500"] ?? null,
    runtime_minutes: p.runtime_length_min ?? null,
    rating: rating?.average_rating ?? null,
    rating_count: rating?.num_ratings ?? null,
    description: p.merchandising_summary ? stripHtml(p.merchandising_summary) : null,
    url: `https://www.audible.com/pd/${p.asin}`,
    is_ai_narrated: isAiNarrated(p),
  };
}

function isCursorFresh(
  cursor: { last_fetched_at: string; is_exhausted: number } | undefined,
  year: number,
  currentYear: number,
  staleDays: number
): boolean {
  if (!cursor) return false;
  // Current year: always re-fetch
  if (year === currentYear) return false;
  // Past years: skip if exhausted
  if (cursor.is_exhausted) return true;
  // Check staleness
  const fetchedAt = new Date(cursor.last_fetched_at + "Z").getTime();
  const ageMs = Date.now() - fetchedAt;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays < staleDays;
}

export class AudibleFetcher implements Fetcher {
  name = "audible";
  private http: HttpClient;
  private staleDays: number;

  constructor(options?: { staleDays?: number }) {
    this.http = createHttpClient({ timeoutMs: 15000, maxRetries: 3, minDelayMs: 300 });
    this.staleDays = options?.staleDays ?? CURSOR_STALE_DAYS;
  }

  private async fetchPage(
    keywords: string,
    page: number,
    sort?: string
  ): Promise<AudibleResponse> {
    const params: Record<string, string> = {
      keywords,
      num_results: "50",
      page: String(page),
      response_groups: RESPONSE_GROUPS,
      image_sizes: "500",
    };
    if (sort) params.products_sort_by = sort;
    return this.http.get<AudibleResponse>(AUDIBLE_API, params);
  }

  /**
   * Best-of-N retry: fetch a page multiple times and merge by ASIN
   * to compensate for Audible API returning partial results.
   */
  private async fetchPageMerged(
    keywords: string,
    page: number,
    sort?: string,
    attempts = 3
  ): Promise<AudibleProduct[]> {
    const byAsin = new Map<string, AudibleProduct>();
    for (let i = 0; i < attempts; i++) {
      try {
        const data = await this.fetchPage(keywords, page, sort);
        for (const p of data.products ?? []) {
          if (!byAsin.has(p.asin)) byAsin.set(p.asin, p);
        }
        if ((data.products?.length ?? 0) >= 50) break;
      } catch {
        // retry
      }
    }
    return [...byAsin.values()];
  }

  private async fetchCategoryPage(
    categoryId: string,
    page: number,
    sort?: string
  ): Promise<AudibleResponse> {
    const params: Record<string, string> = {
      category_id: categoryId,
      num_results: "50",
      page: String(page),
      response_groups: RESPONSE_GROUPS,
      image_sizes: "500",
    };
    if (sort) params.products_sort_by = sort;
    return this.http.get<AudibleResponse>(AUDIBLE_API, params);
  }

  private processProduct(
    product: AudibleProduct,
    year: number,
    seen: Set<string>,
    options?: { skipYearFilter?: boolean }
  ): { isNew: boolean } | null {
    if (seen.has(product.asin)) return null;
    // English only
    if (product.language !== "english") return null;
    if (!product.release_date) return null;
    // Year filter (skipped for series searches — store in actual release year)
    if (!options?.skipYearFilter) {
      const releaseYear = new Date(product.release_date).getFullYear();
      if (releaseYear !== year) return null;
    }
    // No content filtering at fetch time — store everything

    seen.add(product.asin);

    const bookRow = productToBookRow(product);
    const isNew = upsertBook(bookRow);
    upsertBookSource(product.asin, "audible", JSON.stringify(product));
    setBookSubgenres(product.asin, guessSubgenres(product));

    return { isNew };
  }

  async fetch(options: {
    year: number;
    incremental: boolean;
  }): Promise<FetcherResult> {
    const { year, incremental } = options;
    const currentYear = new Date().getFullYear();
    const config = loadSearchConfig();
    const seen = new Set<string>();
    const errors: string[] = [];
    let booksNew = 0;
    let booksUpdated = 0;
    let booksFound = 0;

    // Category browsing: use category_id to browse Audible's genre taxonomy
    for (const category of config.categories) {
      const searchKey = `category:${category.name}`;

      if (incremental) {
        const cursor = getSearchCursor("audible", searchKey, year);
        if (isCursorFresh(cursor, year, currentYear, this.staleDays)) {
          console.log(`  [skip] ${searchKey} (cursor fresh)`);
          continue;
        }
      }

      const runId = insertFetchRun("audible", searchKey, year);
      let pagesFetched = 0;
      let resultsFound = 0;
      let isExhausted = false;

      console.log(`  Browsing category: ${category.name} (${category.id})`);
      try {
        for (let page = 1; page <= category.maxPages; page++) {
          const data = await this.fetchCategoryPage(category.id, page, "-ReleaseDate");
          const products = data.products ?? [];
          pagesFetched++;
          resultsFound += products.length;

          if (products.length === 0) {
            isExhausted = true;
            break;
          }

          for (const p of products) {
            const result = this.processProduct(p, year, seen);
            if (result) {
              booksFound++;
              if (result.isNew) booksNew++;
              else booksUpdated++;
            }
          }

          // Stop if we've gone past the target year
          const last = products[products.length - 1];
          if (last?.release_date && new Date(last.release_date).getFullYear() < year) {
            isExhausted = true;
            break;
          }

          if (products.length < 50) {
            isExhausted = true;
            break;
          }
        }
      } catch (err) {
        const msg = `Category browse "${category.name}" failed: ${err instanceof Error ? err.message : err}`;
        console.error(`  ${msg}`);
        errors.push(msg);
      }

      completeFetchRun(runId, pagesFetched, resultsFound);
      upsertSearchCursor("audible", searchKey, year, isExhausted);
    }

    // Genre keyword searches: paginate deeply, sorted by date
    for (const keyword of config.genres) {
      const searchKey = `genre:${keyword}`;

      if (incremental) {
        const cursor = getSearchCursor("audible", searchKey, year);
        if (isCursorFresh(cursor, year, currentYear, this.staleDays)) {
          console.log(`  [skip] ${searchKey} (cursor fresh)`);
          continue;
        }
      }

      const runId = insertFetchRun("audible", searchKey, year);
      let pagesFetched = 0;
      let resultsFound = 0;
      let isExhausted = false;

      console.log(`  Searching: ${keyword}`);
      try {
        for (let page = 1; page <= 15; page++) {
          const data = await this.fetchPage(keyword, page, "-ReleaseDate");
          const products = data.products ?? [];
          pagesFetched++;
          resultsFound += products.length;

          if (products.length === 0) {
            isExhausted = true;
            break;
          }

          for (const p of products) {
            const result = this.processProduct(p, year, seen);
            if (result) {
              booksFound++;
              if (result.isNew) booksNew++;
              else booksUpdated++;
            }
          }

          // Stop if we've gone past the target year
          const last = products[products.length - 1];
          if (last?.release_date && new Date(last.release_date).getFullYear() < year) {
            isExhausted = true;
            break;
          }

          if (products.length < 50) {
            isExhausted = true;
            break;
          }
        }
      } catch (err) {
        const msg = `Genre search "${keyword}" failed: ${err instanceof Error ? err.message : err}`;
        console.error(`  ${msg}`);
        errors.push(msg);
      }

      completeFetchRun(runId, pagesFetched, resultsFound);
      upsertSearchCursor("audible", searchKey, year, isExhausted);
    }

    // Series-specific searches: merged best-of-3 per page (no date sort)
    for (const keyword of config.series) {
      const searchKey = `series:${keyword}`;

      if (incremental) {
        const cursor = getSearchCursor("audible", searchKey, year);
        if (isCursorFresh(cursor, year, currentYear, this.staleDays)) {
          console.log(`  [skip] ${searchKey} (cursor fresh)`);
          continue;
        }
      }

      const runId = insertFetchRun("audible", searchKey, year);
      let pagesFetched = 0;
      let resultsFound = 0;
      let isExhausted = false;

      console.log(`  Searching series: ${keyword}`);
      try {
        for (let page = 1; page <= 3; page++) {
          const products = await this.fetchPageMerged(keyword, page, undefined, 3);
          pagesFetched++;
          resultsFound += products.length;

          if (products.length === 0) {
            isExhausted = true;
            break;
          }

          for (const p of products) {
            const result = this.processProduct(p, year, seen, { skipYearFilter: true });
            if (result) {
              booksFound++;
              if (result.isNew) booksNew++;
              else booksUpdated++;
            }
          }

          if (products.length < 50) {
            isExhausted = true;
            break;
          }
        }
      } catch (err) {
        const msg = `Series search "${keyword}" failed: ${err instanceof Error ? err.message : err}`;
        console.error(`  ${msg}`);
        errors.push(msg);
      }

      completeFetchRun(runId, pagesFetched, resultsFound);
      upsertSearchCursor("audible", searchKey, year, isExhausted);
    }

    return {
      source: this.name,
      booksFound,
      booksNew,
      booksUpdated,
      errors,
    };
  }
}
