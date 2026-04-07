# LitRPG Chart

## Audible API Quirks

The Audible catalog API (`https://api.audible.com/1.0/catalog/products`) has several undocumented behaviors that affect data fetching:

### Rate Limiting
- Returns HTTP 200 with **empty `products: []`** when rate-limited (no 429 status).
- `total_results` field still shows the correct count even when products are empty.
- Kicks in after ~500-1000 requests. Recovery time is unclear (hours).
- The fetcher's `fetchPageMerged` best-of-3 retry doesn't help since all attempts get the same empty response.

### Series Filter Doesn't Work
- The `series=<ASIN>` parameter does NOT filter by series. It returns the entire catalog (~73K results) with no actual filtering.
- To find all books in a series, the reliable approach is:
  1. Scrape the Audible series webpage to get book ASINs
  2. Look up each ASIN individually via `/catalog/products/<ASIN>`

### Keyword Search Limitations
- Searches for unique titles (e.g. "Carl's Doomsday Scenario") often return 0 results.
- Numbered series titles (e.g. "Primal Hunter 2") work better but are still inconsistent.
- Adding author names to search terms sometimes reduces results to 0.

### Recommended Approach for Complete Series Backfill
1. Find the series page URL: `https://www.audible.com/series/<Name>-Audiobooks/<SERIES_ASIN>`
2. Scrape ASINs from the HTML: look for `/pd/<slug>/<ASIN>` patterns
3. Fetch each ASIN individually: `GET /catalog/products/<ASIN>?response_groups=product_attrs,contributors,series,media,rating,category_ladders`
4. Filter results to only products belonging to the target series via `product.series[].title`

### Manual Backfill Script
`scripts/backend/manual-backfill.ts` — inserts known book data directly when the API is unavailable. Ratings/covers will be populated on the next successful API fetch. Use this for critical series where gaps are unacceptable.

## Pipeline

- `npm run pipeline:fetch` — fetches from Audible (respects search_cursors for dedup)
- `npm run pipeline:build` — full pipeline: fetch + classify + score + export
- `npm run pipeline:export` — just re-export static JSON from existing DB data
- `npx tsx scripts/backend/manual-backfill.ts` — manual series backfill
