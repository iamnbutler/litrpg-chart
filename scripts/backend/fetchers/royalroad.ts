/**
 * Royal Road scraper for series discovery and genre enrichment.
 *
 * Scrapes the "Best Rated" lists for LitRPG-adjacent genres to discover
 * series that should be searched on Audible. Also captures genre tags
 * for better subgenre classification.
 *
 * Rate limiting: 3 seconds between page fetches — Royal Road is a
 * small site and we want to be respectful.
 *
 * Caching: Results are cached for 7 days via search_cursors.
 * A full scrape is ~5-10 pages total (not hundreds).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  insertFetchRun,
  completeFetchRun,
  upsertSearchCursor,
  getSearchCursor,
} from "../db/index.js";

const RR_BASE = "https://www.royalroad.com";
const CACHE_DAYS = 7;

/** Genre pages to scrape — only the most relevant LitRPG-adjacent ones. */
const GENRE_PAGES = [
  { tag: "litrpg", url: "/fictions/best-rated?tag=litrpg", subgenre: "litrpg" },
  { tag: "gamelit", url: "/fictions/best-rated?tag=gamelit", subgenre: "litrpg" },
  { tag: "progression", url: "/fictions/best-rated?tag=progression", subgenre: "litrpg" },
  { tag: "cultivation", url: "/fictions/best-rated?tag=cultivation", subgenre: "cultivation" },
  { tag: "isekai", url: "/fictions/best-rated?tag=isekai", subgenre: "isekai" },
  { tag: "dungeon", url: "/fictions/best-rated?tag=dungeon+core", subgenre: "dungeon" },
];

export interface DiscoveredSeries {
  title: string;
  author: string;
  subgenres: string[];
  rrUrl: string;
  /** Suggested search term for Audible */
  searchTerm: string;
}

/**
 * Extract fiction entries from a Royal Road best-rated page.
 * Uses simple regex parsing — no DOM parser dependency needed.
 *
 * Title links look like:
 *   <a href="/fiction/65629/the-game-at-carousel" class="font-red-sunglo bold">Title</a>
 * Author links look like:
 *   <a href="https://www.royalroad.com/profile/12345/fictions" ...>AuthorName</a>
 */
function parseFictionList(html: string): { title: string; author: string; url: string }[] {
  const fictions: { title: string; author: string; url: string }[] = [];
  const seen = new Set<string>();

  // Match fiction title links with the distinctive RR styling class
  const titlePattern = /<a[^>]+href="(\/fiction\/\d+\/[^"]+)"[^>]*class="[^"]*bold[^"]*"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = titlePattern.exec(html)) !== null) {
    const url = match[1];
    const title = match[2].trim();

    // Deduplicate (each fiction appears twice in the HTML)
    if (seen.has(url)) continue;
    seen.add(url);

    // Search nearby HTML for author profile link
    const afterTitle = html.slice(match.index, match.index + 1000);
    const authorMatch = afterTitle.match(/<a[^>]+(?:profile\/\d+)[^>]*>([^<]+)<\/a>/);
    const author = authorMatch ? authorMatch[1].trim() : "";

    if (title && url) {
      fictions.push({ title, author, url });
    }
  }

  return fictions;
}

const USER_AGENT = "litrpg-chart/1.0 (audiobook chart, minimal scraping)";
const REQUEST_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class RoyalRoadScraper {
  name = "royalroad";

  async discover(): Promise<{ discovered: DiscoveredSeries[]; errors: string[] }> {
    const errors: string[] = [];
    const allSeries = new Map<string, DiscoveredSeries>();

    console.log(`  [royalroad] Scraping best-rated lists (${GENRE_PAGES.length} genres)...`);
    const runId = insertFetchRun("royalroad", "discovery", 0);
    let pagesFetched = 0;

    for (const genre of GENRE_PAGES) {
      const cursorKey = `best-rated:${genre.tag}`;

      // Check cache
      const cursor = getSearchCursor("royalroad", cursorKey, 0);
      if (cursor) {
        const fetchedAt = new Date(cursor.last_fetched_at + "Z").getTime();
        const ageDays = (Date.now() - fetchedAt) / (1000 * 60 * 60 * 24);
        if (ageDays < CACHE_DAYS) {
          console.log(`    [skip] ${genre.tag} (cached ${Math.round(ageDays)}d ago)`);
          continue;
        }
      }

      try {
        await sleep(REQUEST_DELAY_MS);

        const url = `${RR_BASE}${genre.url}`;
        const response = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const fictions = parseFictionList(html);
        pagesFetched++;

        console.log(`    ${genre.tag}: found ${fictions.length} fictions`);

        for (const f of fictions) {
          const key = f.title.toLowerCase();
          if (!allSeries.has(key)) {
            allSeries.set(key, {
              title: f.title,
              author: f.author,
              subgenres: [genre.subgenre],
              rrUrl: `${RR_BASE}${f.url}`,
              searchTerm: `${f.title} audiobook`,
            });
          } else {
            // Add subgenre if not already present
            const existing = allSeries.get(key)!;
            if (!existing.subgenres.includes(genre.subgenre)) {
              existing.subgenres.push(genre.subgenre);
            }
          }
        }

        upsertSearchCursor("royalroad", cursorKey, 0, true);
      } catch (err) {
        const msg = `Royal Road scrape failed for ${genre.tag}: ${err instanceof Error ? err.message : err}`;
        console.error(`    ${msg}`);
        errors.push(msg);
      }
    }

    const discovered = [...allSeries.values()];
    completeFetchRun(runId, pagesFetched, discovered.length);

    // Filter to series NOT already in our Audible search config
    const existingSeries = this.getExistingSearchTerms();
    const newSeries = discovered.filter((s) => {
      const lower = s.title.toLowerCase();
      return !existingSeries.some((e) => lower.includes(e) || e.includes(lower));
    });

    console.log(`  [royalroad] Discovered ${discovered.length} series (${newSeries.length} new)`);

    return { discovered: newSeries, errors };
  }

  private getExistingSearchTerms(): string[] {
    try {
      const configPath = join(import.meta.dirname, "..", "config", "audible-searches.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      return [...(config.genres ?? []), ...(config.series ?? [])].map((s: string) => s.toLowerCase());
    } catch {
      return [];
    }
  }
}
