import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpClient } from '../http/client.js';
import type { Fetcher, FetcherResult } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AUDIBLE_API = 'https://api.audible.com/1.0/catalog/products';
const RESPONSE_GROUPS = 'product_attrs,contributors,series,media,rating,category_ladders';

const GENRE_MAX_PAGES = 15;
const SERIES_MAX_PAGES = 3;
const CURSOR_FRESHNESS_DAYS = 7;

interface AudibleProduct {
  asin: string;
  title?: string;
  subtitle?: string;
  series?: Array<{ title: string; sequence?: string }>;
  authors?: Array<{ name: string }>;
  narrators?: Array<{ name: string }>;
  release_date?: string;
  publication_datetime?: string;
  product_images?: Record<string, string>;
  runtime_length_min?: number;
  merchandising_summary?: string;
  language?: string;
  rating?: { overall_distribution?: { average_rating?: number; num_ratings?: number } };
  category_ladders?: Array<{ ladder: Array<{ name: string; id: string }> }>;
}

interface AudibleResponse {
  products?: AudibleProduct[];
  total_results?: number;
}

interface SearchConfig {
  genre_searches: string[];
  series_searches: string[];
}

function loadSearchConfig(): SearchConfig {
  const configPath = path.resolve(__dirname, '..', 'config', 'audible-searches.json');
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#xa0;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function guessSubgenres(product: AudibleProduct): string[] {
  const text = [product.title, product.subtitle, product.merchandising_summary]
    .filter(Boolean).join(' ').toLowerCase();
  const subgenres: string[] = [];
  if (/litrpg|lit[\s-]?rpg|gamelit/.test(text)) subgenres.push('litrpg');
  if (/cultivation|cultivator|qi |dao |xianxia|wuxia/.test(text)) subgenres.push('cultivation');
  if (/progression\s*fantasy|level\s*up|skill\s*tree|class\s*system/.test(text)) subgenres.push('progression');
  if (/dungeon\s*core|dungeon\s*crawl/.test(text)) subgenres.push('dungeon');
  if (/isekai|transported|reincarnated|reborn\s*(in|as|into)|summoned\s*(to|into)|another\s*world/.test(text)) subgenres.push('isekai');
  if (subgenres.length === 0) subgenres.push('progression');
  return subgenres;
}

export class AudibleFetcher implements Fetcher {
  readonly name = 'audible';
  private db: Database.Database;
  private http: HttpClient;

  // Prepared statements (lazily initialized)
  private stmts!: ReturnType<typeof this.prepareStatements>;

  constructor(db: Database.Database, http?: HttpClient) {
    this.db = db;
    this.http = http ?? new HttpClient({ timeout: 15_000, retries: 3, rateLimit: 300 });
  }

  private prepareStatements() {
    return {
      findBook: this.db.prepare('SELECT asin FROM books WHERE asin = ?'),

      insertBook: this.db.prepare(`
        INSERT INTO books (asin, title, subtitle, series_name, series_number, author, narrator,
          release_date, cover_url, runtime_minutes, description, language, rating_average, rating_count, url)
        VALUES (@asin, @title, @subtitle, @series_name, @series_number, @author, @narrator,
          @release_date, @cover_url, @runtime_minutes, @description, @language, @rating_average, @rating_count, @url)
      `),

      updateBook: this.db.prepare(`
        UPDATE books SET
          narrator = @narrator,
          cover_url = @cover_url,
          rating_average = @rating_average,
          rating_count = @rating_count,
          release_date = @release_date,
          updated_at = datetime('now')
        WHERE asin = @asin
      `),

      upsertSource: this.db.prepare(`
        INSERT INTO book_sources (asin, source, raw_response)
        VALUES (@asin, @source, @raw_response)
        ON CONFLICT(asin, source) DO UPDATE SET
          raw_response = @raw_response,
          fetched_at = datetime('now')
      `),

      insertSubgenre: this.db.prepare(`
        INSERT OR IGNORE INTO book_subgenres (asin, subgenre) VALUES (?, ?)
      `),

      insertFetchRun: this.db.prepare(`
        INSERT INTO fetch_runs (source, search_key, year, pages_fetched, results_found)
        VALUES (@source, @search_key, @year, @pages_fetched, @results_found)
      `),

      updateFetchRunComplete: this.db.prepare(`
        UPDATE fetch_runs SET completed_at = datetime('now'), pages_fetched = @pages_fetched, results_found = @results_found
        WHERE id = @id
      `),

      upsertCursor: this.db.prepare(`
        INSERT INTO search_cursors (source, search_key, year, last_completed_at, is_exhausted)
        VALUES (@source, @search_key, @year, datetime('now'), @is_exhausted)
        ON CONFLICT(source, search_key, year) DO UPDATE SET
          last_completed_at = datetime('now'),
          is_exhausted = @is_exhausted
      `),

      getCursor: this.db.prepare(`
        SELECT last_completed_at, is_exhausted FROM search_cursors
        WHERE source = ? AND search_key = ? AND year = ?
      `),

      startFetchRun: this.db.prepare(`
        INSERT INTO fetch_runs (source, search_key, year) VALUES (@source, @search_key, @year)
      `),
    };
  }

  async fetch(options: { year: number; incremental: boolean }): Promise<FetcherResult> {
    this.stmts = this.prepareStatements();
    const { year, incremental } = options;
    const config = loadSearchConfig();
    const result: FetcherResult = { source: this.name, booksFound: 0, booksNew: 0, booksUpdated: 0, errors: [] };

    const allSearches: Array<{ keyword: string; type: 'genre' | 'series' }> = [
      ...config.genre_searches.map(k => ({ keyword: k, type: 'genre' as const })),
      ...config.series_searches.map(k => ({ keyword: k, type: 'series' as const })),
    ];

    for (const search of allSearches) {
      if (incremental && this.shouldSkipSearch(search.keyword, year)) {
        console.log(`  [skip] "${search.keyword}" (recent cursor)`);
        continue;
      }

      try {
        const { pagesFound, resultsFound } = await this.runSearch(search, year, result);
        this.recordSearchCompletion(search.keyword, year, pagesFound, resultsFound);
      } catch (err) {
        const msg = `Failed "${search.keyword}": ${err instanceof Error ? err.message : String(err)}`;
        console.error(`  ${msg}`);
        result.errors.push(msg);
      }
    }

    console.log(
      `  Audible ${year}: ${result.booksFound} found, ${result.booksNew} new, ${result.booksUpdated} updated, ${result.errors.length} errors`
    );
    return result;
  }

  private shouldSkipSearch(searchKey: string, year: number): boolean {
    const currentYear = new Date().getFullYear();
    // Always re-fetch current year
    if (year === currentYear) return false;

    const cursor = this.stmts.getCursor.get(this.name, searchKey, year) as
      | { last_completed_at: string; is_exhausted: number }
      | undefined;

    if (!cursor) return false;

    // For past years, skip if cursor is marked exhausted
    if (year < currentYear && cursor.is_exhausted) return true;

    // Skip if completed within freshness window
    if (cursor.last_completed_at) {
      const completedAt = new Date(cursor.last_completed_at + 'Z');
      const daysAgo = (Date.now() - completedAt.getTime()) / (1000 * 60 * 60 * 24);
      return daysAgo < CURSOR_FRESHNESS_DAYS;
    }

    return false;
  }

  private async runSearch(
    search: { keyword: string; type: 'genre' | 'series' },
    year: number,
    result: FetcherResult
  ): Promise<{ pagesFound: number; resultsFound: number }> {
    const maxPages = search.type === 'genre' ? GENRE_MAX_PAGES : SERIES_MAX_PAGES;
    const sort = search.type === 'genre' ? '-ReleaseDate' : '';
    let pagesFound = 0;
    let resultsFound = 0;

    console.log(`  Searching "${search.keyword}" (${search.type})...`);

    for (let page = 1; page <= maxPages; page++) {
      const data = search.type === 'genre'
        ? await this.fetchPage(search.keyword, page, sort)
        : await this.fetchPageMerged(search.keyword, page, sort);

      if (!data.products || data.products.length === 0) break;

      pagesFound++;

      for (const product of data.products) {
        if (product.language && product.language !== 'english') continue;
        const releaseYear = product.release_date
          ? new Date(product.release_date).getFullYear()
          : null;
        if (releaseYear !== year) continue;

        resultsFound++;
        result.booksFound++;
        this.storeProduct(product, result);
      }

      // For genre searches: stop if we've gone past the target year
      if (search.type === 'genre' && data.products.length > 0) {
        const last = data.products[data.products.length - 1];
        if (last.release_date && new Date(last.release_date).getFullYear() < year) break;
      }

      // Stop if we got fewer than a full page
      if (data.products.length < 50) break;
    }

    return { pagesFound, resultsFound };
  }

  private async fetchPage(keywords: string, page: number, sort: string): Promise<AudibleResponse> {
    const params: Record<string, string> = {
      keywords,
      num_results: '50',
      page: String(page),
      response_groups: RESPONSE_GROUPS,
      image_sizes: '500',
    };
    if (sort) params.products_sort_by = sort;

    return this.http.get<AudibleResponse>(AUDIBLE_API, params);
  }

  private async fetchPageMerged(keywords: string, page: number, sort: string, attempts = 3): Promise<AudibleResponse> {
    const productsByAsin = new Map<string, AudibleProduct>();
    for (let i = 0; i < attempts; i++) {
      try {
        const data = await this.fetchPage(keywords, page, sort);
        for (const p of data.products ?? []) {
          if (!productsByAsin.has(p.asin)) {
            productsByAsin.set(p.asin, p);
          }
        }
        if ((data.products?.length ?? 0) >= 50) break;
      } catch {
        // retry
      }
    }
    return { products: [...productsByAsin.values()] };
  }

  private storeProduct(product: AudibleProduct, result: FetcherResult): void {
    const asin = product.asin;
    const series = product.series?.[0];
    let seriesNumber: number | null = null;
    if (series?.sequence) {
      const num = parseFloat(series.sequence);
      if (!isNaN(num)) seriesNumber = num;
    }

    let title = product.title ?? 'Untitled';
    const rating = product.rating?.overall_distribution;

    const bookData = {
      asin,
      title,
      subtitle: product.subtitle ?? null,
      series_name: series?.title ?? null,
      series_number: seriesNumber,
      author: (product.authors ?? []).map(a => a.name).join(', ') || null,
      narrator: (product.narrators ?? []).map(n => n.name).join(', ') || null,
      release_date: product.publication_datetime ?? (product.release_date ? `${product.release_date}T00:00:00Z` : null),
      cover_url: product.product_images?.['500'] ?? null,
      runtime_minutes: product.runtime_length_min ?? null,
      description: product.merchandising_summary ? stripHtml(product.merchandising_summary) : null,
      language: product.language ?? null,
      rating_average: rating?.average_rating ?? null,
      rating_count: rating?.num_ratings ?? null,
      url: `https://www.audible.com/pd/${asin}`,
    };

    const existing = this.stmts.findBook.get(asin);

    const runInTransaction = this.db.transaction(() => {
      if (existing) {
        this.stmts.updateBook.run({
          asin,
          narrator: bookData.narrator,
          cover_url: bookData.cover_url,
          rating_average: bookData.rating_average,
          rating_count: bookData.rating_count,
          release_date: bookData.release_date,
        });
        result.booksUpdated++;
      } else {
        this.stmts.insertBook.run(bookData);
        result.booksNew++;
      }

      // Upsert source with raw API response
      this.stmts.upsertSource.run({
        asin,
        source: this.name,
        raw_response: JSON.stringify(product),
      });

      // Store subgenres
      const subgenres = guessSubgenres(product);
      for (const sg of subgenres) {
        this.stmts.insertSubgenre.run(asin, sg);
      }
    });

    runInTransaction();
  }

  private recordSearchCompletion(searchKey: string, year: number, pagesFetched: number, resultsFound: number): void {
    this.stmts.insertFetchRun.run({
      source: this.name,
      search_key: searchKey,
      year,
      pages_fetched: pagesFetched,
      results_found: resultsFound,
    });

    this.stmts.upsertCursor.run({
      source: this.name,
      search_key: searchKey,
      year,
      is_exhausted: pagesFetched < (GENRE_MAX_PAGES) ? 1 : 0,
    });
  }
}
