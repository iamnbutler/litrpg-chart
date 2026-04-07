/**
 * Targeted backfill: fetch specific missing books by ASIN lookup.
 * Bypasses the normal fetcher to avoid rate limiting from bulk searches.
 *
 * Usage: npx tsx scripts/backend/backfill-series.ts
 */

import { getDb, closeDb } from "./db.js";
import { upsertBook, upsertBookSource, setBookSubgenres } from "./db/index.js";
import type { BookRow } from "./db/index.js";

const AUDIBLE_API = "https://api.audible.com/1.0/catalog/products";
const RESPONSE_GROUPS = "product_attrs,contributors,series,media,rating,category_ladders";

interface AudibleProduct {
  asin: string;
  title?: string;
  subtitle?: string;
  merchandising_summary?: string;
  language?: string;
  release_date?: string;
  runtime_length_min?: number;
  rating?: { overall_distribution?: { average_rating?: number; num_ratings?: number } };
  authors?: { asin?: string; name: string }[];
  narrators?: { name: string }[];
  series?: { asin: string; title: string; sequence: string }[];
  product_images?: Record<string, string>;
  category_ladders?: { ladder: { id: string; name: string }[] }[];
  content_type?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchProducts(keywords: string): Promise<AudibleProduct[]> {
  const url = new URL(AUDIBLE_API);
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("num_results", "50");
  url.searchParams.set("page", "1");
  url.searchParams.set("response_groups", RESPONSE_GROUPS);
  url.searchParams.set("image_sizes", "500");

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { products?: AudibleProduct[] };
  return data.products ?? [];
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

function productToBookRow(p: AudibleProduct, seriesTitle: string): BookRow {
  const seq = p.series?.find((s) => s.title === seriesTitle)?.sequence;
  return {
    id: p.asin,
    title: p.title ?? "",
    subtitle: p.subtitle ?? null,
    series_name: seriesTitle,
    series_number: seq ? parseFloat(seq) : null,
    author: (p.authors ?? []).map((a) => a.name).join(", "),
    narrator: (p.narrators ?? []).map((n) => n.name).join(", ") || null,
    release_date: p.release_date ?? null,
    cover_url: p.product_images?.["500"] ?? null,
    runtime_minutes: p.runtime_length_min ?? null,
    rating: p.rating?.overall_distribution?.average_rating ?? null,
    rating_count: p.rating?.overall_distribution?.num_ratings ?? null,
    description: stripHtml(p.merchandising_summary ?? ""),
    url: `https://www.audible.com/pd/${p.asin}`,
    is_ai_narrated: false,
  };
}

// Series to backfill: { seriesId, seriesTitle (on Audible), searchQueries }
const SERIES_TO_BACKFILL = [
  {
    seriesId: "dungeon-crawler-carl",
    seriesTitle: "Dungeon Crawler Carl",
    searches: [
      "Dungeon Crawler Carl Matt Dinniman",
      "Carl's Doomsday Scenario",
      "Dungeon Anarchist's Cookbook",
      "Gate of the Feral Gods",
      "Butcher's Masquerade",
      "Eye of the Bedlam Bride",
      "This Inevitable Ruin Matt Dinniman",
    ],
  },
  {
    seriesId: "the-primal-hunter",
    seriesTitle: "The Primal Hunter",
    searches: [
      "Primal Hunter Zogarth",
      "Primal Hunter 2",
      "Primal Hunter 3",
      "Primal Hunter 4",
      "Primal Hunter 5",
      "Primal Hunter 7",
      "Primal Hunter 8",
      "Primal Hunter 9",
      "Primal Hunter 11",
      "Primal Hunter 12",
    ],
  },
  {
    seriesId: "defiance-of-the-fall",
    seriesTitle: "Defiance of the Fall",
    searches: [
      "Defiance of the Fall TheFirstDefier",
      "Defiance of the Fall 2",
      "Defiance of the Fall 3",
      "Defiance of the Fall 4",
      "Defiance of the Fall 5",
      "Defiance of the Fall 6",
      "Defiance of the Fall 8",
      "Defiance of the Fall 9",
      "Defiance of the Fall 10",
      "Defiance of the Fall 11",
      "Defiance of the Fall 12",
      "Defiance of the Fall 13",
      "Defiance of the Fall 14",
      "Defiance of the Fall 15",
    ],
  },
  {
    seriesId: "he-who-fights-with-monsters",
    seriesTitle: "He Who Fights with Monsters",
    searches: [
      "He Who Fights with Monsters Shirtaloon",
      "He Who Fights with Monsters 2",
      "He Who Fights with Monsters 3",
      "He Who Fights with Monsters 4",
      "He Who Fights with Monsters 5",
      "He Who Fights with Monsters 6",
      "He Who Fights with Monsters 7",
      "He Who Fights with Monsters 8",
      "He Who Fights with Monsters 9",
      "He Who Fights with Monsters 10",
      "He Who Fights with Monsters 12",
    ],
  },
  {
    seriesId: "the-path-of-ascension",
    seriesTitle: "The Path of Ascension",
    searches: [
      "Path of Ascension C. Mantis",
      "Path of Ascension 2",
      "Path of Ascension 3",
      "Path of Ascension 4",
      "Path of Ascension 5",
      "Path of Ascension 6",
      "Path of Ascension 7",
      "Path of Ascension 8",
      "Path of Ascension 9",
      "Path of Ascension 10",
    ],
  },
];

async function main() {
  const db = getDb();
  const seen = new Set<string>();
  let totalNew = 0;
  let totalUpdated = 0;

  // Pre-load existing ASINs for these series
  const existing = db
    .prepare(
      `SELECT id FROM books WHERE series_id IN (${SERIES_TO_BACKFILL.map(() => "?").join(",")})`,
    )
    .all(...SERIES_TO_BACKFILL.map((s) => s.seriesId)) as { id: string }[];
  for (const row of existing) seen.add(row.id);
  console.log(`Found ${seen.size} existing books across target series\n`);

  for (const series of SERIES_TO_BACKFILL) {
    console.log(`=== ${series.seriesTitle} ===`);

    for (const query of series.searches) {
      await sleep(1000); // 1s between requests to avoid rate limiting
      try {
        const products = await fetchProducts(query);
        // Filter to only products in this series
        const matched = products.filter((p) =>
          p.series?.some((s) => s.title === series.seriesTitle) && p.language === "english",
        );

        for (const p of matched) {
          const bookRow = productToBookRow(p, series.seriesTitle);
          const isNew = !seen.has(p.asin);
          seen.add(p.asin);

          upsertBook(bookRow);
          upsertBookSource(p.asin, "audible", JSON.stringify(p));

          if (isNew) {
            totalNew++;
            console.log(`  [NEW] #${bookRow.series_number} ${bookRow.title}`);
          } else {
            totalUpdated++;
          }
        }

        if (matched.length === 0) {
          console.log(`  [miss] "${query}" → ${products.length} results, 0 matched series`);
        }
      } catch (err) {
        console.error(`  [error] "${query}": ${err}`);
      }
    }
    console.log();
  }

  console.log(`Done: ${totalNew} new, ${totalUpdated} updated`);
  closeDb();
}

main().catch(console.error);
