/**
 * Scrape Audible series pages to discover all audiobook ASINs,
 * then enrich each via direct ASIN lookup.
 *
 * This bypasses the unreliable keyword search API.
 * See CLAUDE.md for why this approach is necessary.
 *
 * Usage: npx tsx scripts/backend/scrape-series.ts
 */

import { getDb, closeDb } from "./db.js";

const AUDIBLE_API = "https://api.audible.com/1.0/catalog/products";
const RESPONSE_GROUPS = "product_attrs,contributors,series,media,rating,category_ladders";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

interface AudibleProduct {
  asin: string;
  title?: string;
  subtitle?: string;
  merchandising_summary?: string;
  language?: string;
  release_date?: string;
  runtime_length_min?: number;
  authors?: { asin?: string; name: string }[];
  narrators?: { name: string }[];
  series?: { asin: string; title: string; sequence: string }[];
  product_images?: Record<string, string>;
  rating?: { overall_distribution?: { average_rating?: number; num_ratings?: number } };
}

// Series to scrape: { seriesId (our DB), seriesAsin (Audible), seriesTitle (Audible), slug }
const SERIES = [
  { id: "dungeon-crawler-carl", asin: "B0937JMKYV", title: "Dungeon Crawler Carl", slug: "Dungeon-Crawler-Carl-Audiobooks" },
  { id: "the-primal-hunter", asin: "B09MZKWFTB", title: "The Primal Hunter", slug: "The-Primal-Hunter-Audiobooks" },
  { id: "defiance-of-the-fall", asin: "B09B4CQQBT", title: "Defiance of the Fall", slug: "Defiance-of-the-Fall-Audiobooks" },
  { id: "he-who-fights-with-monsters", asin: "B08WJ59784", title: "He Who Fights with Monsters", slug: "He-Who-Fights-with-Monsters-Audiobooks" },
  { id: "the-path-of-ascension", asin: "B0BV3CNHF9", title: "The Path of Ascension", slug: "The-Path-of-Ascension-Audiobooks" },
  { id: "the-wandering-inn", asin: "B07X3TZ2GQ", title: "The Wandering Inn", slug: "The-Wandering-Inn-Audiobooks" },
  { id: "cradle", asin: "B07GVRN95T", title: "Cradle", slug: "Cradle-Audiobooks" },
  { id: "beware-of-chicken", asin: "B0B5GDJ38K", title: "Beware of Chicken", slug: "Beware-of-Chicken-Audiobooks" },
  { id: "arcane-ascension", asin: "B07CYK585L", title: "Arcane Ascension", slug: "Arcane-Ascension-Audiobooks" },
  { id: "the-completionist-chronicles", asin: "B07RNVB14M", title: "The Completionist Chronicles", slug: "The-Completionist-Chronicles-Audiobooks" },
];

/**
 * Step 1: Scrape the Audible series page HTML to extract product ASINs.
 */
async function scrapeSeriesPage(slug: string, seriesAsin: string): Promise<string[]> {
  const url = `https://www.audible.com/series/${slug}/${seriesAsin}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
  });
  if (!resp.ok) return [];
  const html = await resp.text();

  // Extract ASINs from product links: /pd/<slug>/<ASIN>
  const asinPattern = /\/pd\/[^/"]+\/([A-Z0-9]{10})/g;
  const asins = new Set<string>();
  let match;
  while ((match = asinPattern.exec(html)) !== null) {
    asins.add(match[1]);
  }
  return [...asins];
}

/**
 * Step 2: Look up each ASIN via the API to get full metadata.
 */
async function lookupAsin(asin: string): Promise<AudibleProduct | null> {
  const url = `${AUDIBLE_API}/${asin}?response_groups=${RESPONSE_GROUPS}&image_sizes=500`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { product?: AudibleProduct };
    return data.product ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const db = getDb();

  const upsert = db.prepare(`
    UPDATE books SET
      title = COALESCE(NULLIF(@title, ''), title),
      author = COALESCE(NULLIF(@author, ''), author),
      narrator = COALESCE(NULLIF(@narrator, ''), narrator),
      release_date = COALESCE(NULLIF(@release_date, ''), release_date),
      cover_url = COALESCE(NULLIF(@cover_url, ''), cover_url),
      runtime_minutes = COALESCE(@runtime_minutes, runtime_minutes),
      rating = CASE WHEN @rating > 0 THEN @rating ELSE rating END,
      rating_count = CASE WHEN @rating_count > 0 THEN @rating_count ELSE rating_count END,
      description = COALESCE(NULLIF(@description, ''), description),
      updated_at = datetime('now')
    WHERE id = @id
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO books (id, title, subtitle, author, narrator, series_id,
      series_number, release_date, cover_url, runtime_minutes,
      rating, rating_count, description, url, is_ai_narrated)
    VALUES (@id, @title, @subtitle, @author, @narrator, @series_id,
      @series_number, @release_date, @cover_url, @runtime_minutes,
      @rating, @rating_count, @description, @url, 0)
  `);

  const ensureSeries = db.prepare(`
    INSERT INTO series (id, title, author) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title
  `);

  const ensureSubgenre = db.prepare(`
    INSERT OR IGNORE INTO book_subgenres (book_id, subgenre, confidence, source)
    VALUES (?, 'litrpg', 1.0, 'manual')
  `);

  let totalNew = 0;
  let totalEnriched = 0;

  for (const series of SERIES) {
    console.log(`\n=== ${series.title} ===`);

    // Step 1: Scrape ASINs from series page
    console.log(`  Scraping https://www.audible.com/series/${series.slug}/${series.asin}`);
    const asins = await scrapeSeriesPage(series.slug, series.asin);
    console.log(`  Found ${asins.length} ASINs on page`);
    await sleep(1000);

    // Step 2: Look up each ASIN
    let seriesBooks = 0;
    for (const asin of asins) {
      await sleep(500);
      const product = await lookupAsin(asin);
      if (!product) continue;

      // Only keep products that belong to this series
      const seriesEntry = product.series?.find((s) => s.title === series.title);
      if (!seriesEntry) continue;
      if (product.language && product.language !== "english") continue;

      seriesBooks++;
      const seq = seriesEntry.sequence ? parseFloat(seriesEntry.sequence) : null;
      const author = (product.authors ?? []).map((a) => a.name).join(", ");
      const narrator = (product.narrators ?? []).map((n) => n.name).join(", ");

      // Check if book exists
      const exists = db.prepare("SELECT id FROM books WHERE id = ?").get(asin);

      if (exists) {
        // Enrich existing book
        upsert.run({
          id: asin,
          title: product.title ?? "",
          author,
          narrator,
          release_date: product.release_date ?? "",
          cover_url: product.product_images?.["500"] ?? "",
          runtime_minutes: product.runtime_length_min ?? null,
          rating: product.rating?.overall_distribution?.average_rating ?? 0,
          rating_count: product.rating?.overall_distribution?.num_ratings ?? 0,
          description: stripHtml(product.merchandising_summary ?? ""),
        });
        totalEnriched++;
        console.log(`  [enrich] #${seq} ${product.title || asin}`);
      } else {
        // Insert new book
        ensureSeries.run(series.id, series.title, author.split(",")[0]?.trim() ?? "");
        insert.run({
          id: asin,
          title: product.title ?? "",
          subtitle: product.subtitle ?? null,
          author,
          narrator,
          series_id: series.id,
          series_number: seq,
          release_date: product.release_date ?? null,
          cover_url: product.product_images?.["500"] ?? null,
          runtime_minutes: product.runtime_length_min ?? null,
          rating: product.rating?.overall_distribution?.average_rating ?? null,
          rating_count: product.rating?.overall_distribution?.num_ratings ?? null,
          description: stripHtml(product.merchandising_summary ?? ""),
          url: `https://www.audible.com/pd/${asin}`,
        });
        ensureSubgenre.run(asin);
        totalNew++;
        console.log(`  [NEW] #${seq} ${product.title || asin}`);
      }
    }
    console.log(`  ${seriesBooks} books in series (from ${asins.length} ASINs)`);
  }

  console.log(`\nDone: ${totalNew} new, ${totalEnriched} enriched`);
  closeDb();
}

main().catch(console.error);
