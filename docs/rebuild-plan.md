# LitRPG Chart — Ground-Up Rebuild Plan

_Drafted 2026-08-12. Context: the v1 backend's SQLite DB lived in a GitHub Actions cache (now evicted — the DB no longer exists), the weekly cron was auto-disabled for repo inactivity, discovery was ~7,500 keyword-search requests per run against an API that silently throttles at ~500–1,000, and the live ingest path bypassed all merge logic. The UI's visual design and structure are good and are preserved; everything else is rebuilt._

## Design principles (hindsight-driven)

1. **Canonical data lives in git as NDJSON.** SQLite is a transient index rebuilt from NDJSON at the start of every pipeline run. Durability, reviewable diffs, regression guarding, local-dev parity, and cron keepalive all fall out of this one decision.
2. **Series are the unit of truth.** LitRPG is series fiction. Discovery closes over series via the Audible `relationships` endpoint (1 request = every volume + sequence numbers, verified working). Classification is series-level first, inherited by books. Series identity is the **Audible series ASIN**, never a title slug.
3. **The API budget is a first-class constraint.** Hard per-run request budget (~600). Circuit breaker on the throttle signature (`products: []` with `total_results > 0`) aborts the run writing *no* state. A throttled run leaves zero footprint.
4. **One ingest path, merge-only writes.** Null never overwrites non-null; manual corrections always win; every write is attributable to a source.
5. **Deploys are pure functions of the repo.** The deploy workflow performs zero network fetches. Data freshness and site deployment are fully decoupled workflows.
6. **Stable public IDs.** Book = ASIN, series = series ASIN. These are the keys the upcoming localStorage features (watch/hide series) will persist, so they must never change across exports.

## Repo layout

```
litrpg-chart/
├── data/                        # CANONICAL — committed, the database
│   ├── books.ndjson             # one book per line, sorted by ASIN
│   ├── series.ndjson            # one series per line, sorted by series ASIN
│   ├── corrections.ndjson       # manual field-level overrides (always win)
│   └── snapshots/meta.json      # last run stats, for validate diffing
├── packages/
│   ├── contract/                # shared: zod schemas for exported JSON + TS types
│   ├── pipeline/                # backend (replaces scripts/backend entirely)
│   │   ├── src/
│   │   │   ├── cli.ts           # discover | close-series | hydrate | classify | validate | export | run | stats
│   │   │   ├── store.ts         # NDJSON ⇄ SQLite (bun:sqlite), deterministic serialization
│   │   │   ├── http.ts          # ported from v1 (tested) + budget + circuit breaker
│   │   │   ├── audible.ts       # typed client: search, category browse, product, series relationships
│   │   │   ├── hardcover.ts     # LitRPG tag dump for recall cross-check (optional token)
│   │   │   ├── stages/          # one file per CLI stage
│   │   │   └── merge.ts         # single write path: field-priority merge + corrections
│   │   └── config/              # keyword slices, category nodes, classifier patterns, filters
│   └── web/                     # SvelteKit app (visuals ported 1:1)
└── .github/workflows/
    ├── ci.yml                   # typecheck + test + build on PR/push
    ├── data.yml                 # weekly cron + dispatch: run pipeline → validate → commit data/
    └── deploy.yml               # on push to main: export → vite build → Pages (no fetching)
```

Runtime: **Bun** (single lockfile, runs TS directly, `bun:sqlite` built in — drops tsx and better-sqlite3). Conservative fallback: npm + tsx + better-sqlite3; nothing in the plan depends on the choice.

## Data model (NDJSON, canonical)

**books.ndjson** — key `asin`:
```jsonc
{ "asin": "B08C6YJ1LS", "title": "...", "authors": ["Matt Dinniman"], "narrators": ["Jeff Hays"],
  "series": { "asin": "B0937JMKYV", "position": "1" },  // null for standalones
  "releaseDate": "2020-09-01", "runtimeMin": 785, "language": "english",
  "rating": { "avg": 4.9, "count": 41234 }, "coverUrl": "...", "description": "...",
  "aiNarrated": false, "publisher": "...",
  "meta": { "firstSeenAt": "...", "lastHydratedAt": "...", "sources": ["audible"] } }
```

**series.ndjson** — key `asin`:
```jsonc
{ "asin": "B0937JMKYV", "name": "Dungeon Crawler Carl",
  "subgenres": ["litrpg", "dungeon"],          // series-level classification (inherited by books)
  "classification": { "method": "keyword|hardcover|manual", "confidence": 0.9 },
  "include": true,                              // false = curated out (harem/erotica/non-genre)
  "lastClosedAt": "...", "active": true }       // active = had a release in last 18mo → weekly closure
```

**corrections.ndjson** — `{ "target": "<asin>", "kind": "book|series", "set": { "field": value }, "note": "why" }`. Applied last on every run; hand-edited; replaces v1's manual-backfill/blocklist script sprawl (author blocklist and content-regex filters move to `pipeline/config/`).

Files are sorted by key with stable field order → a weekly data commit diffs as "+12 books, ~340 rating updates," human-reviewable in the GitHub UI.

### Why series-level classification
v1 classified per-book from descriptions: 42–52% fell through to a default label, and export dropped books with no subgenre — a major source of "missing" books. A series gets classified once (keywords + Hardcover LitRPG-tag cross-check + manual correction), every volume inherits it, and at ~500 series human curation of the edge cases is actually tractable. Book-level overrides remain possible via corrections.

## Pipeline stages

Every run: load NDJSON → build throwaway SQLite index → run stages → serialize back to NDJSON → validate → (CI) commit.

1. **discover** (~50–100 req): Fantasy/SF category nodes (`category_id`, verified working) sorted `-ReleaseDate`, first 2–3 pages each, plus ~8 keyword slices sorted `-ReleaseDate`. Collect unknown ASINs whose metadata smells like genre (keyword prefilter) as candidates. The ~550/query pagination cap is irrelevant for incrementals.
2. **close-series** (~1 req/series): for every series with `lastClosedAt` past policy (active: 7d, dormant: 30d) plus any series newly seen in discover, `GET /catalog/products/{seriesAsin}?response_groups=relationships` → diff volumes against known books → missing volumes become candidates. **This is the gap-killer.** Budget-aware: oldest-checked first, remainder rolls to next run.
3. **hydrate** (1 req/book): full product fetch for candidates + stale rating refresh (oldest `lastHydratedAt` first, fills remaining budget). Response groups **must include `product_desc`** (title moved out of `product_attrs` — likely v1's null-title bug). Writes go through `merge.ts` only.
4. **classify**: series-level rules from config patterns; optional Hardcover tag pass; corrections applied last. Never destructive (v1's fetch path deleted CLASSIFY output on every run).
5. **validate**: diff against `snapshots/meta.json` — fail (exit non-zero, no commit) if books shrink >1%, series shrink, or null-rate of key fields (title, releaseDate, cover) regresses. This is the deploy guard, restored where it belongs: gating the *data commit*, not the deploy.
6. **export**: generate `packages/web/static/data/` (gitignored, deterministic — deploy re-runs it).

**HTTP layer**: port v1's `http.ts` (timeout/retry/jitter — the one well-tested module) and add: run-wide request budget, per-host pacing, and the throttle circuit breaker (`products: []` && `total_results > 0` → abort run, exit distinct code, no state written). Optional Audnexus per-ASIN fallback when throttled (no rating counts, so hydration only defers).

## Export contract (`packages/contract`)

Zod schemas, single source of truth. Pipeline validates on export; web imports the inferred types (v1 had two divergent hand-written `Book` types).

```
static/data/
├── meta.json                    # lastUpdated, years{}, counts, schemaVersion
├── years/<year>.json            # ExportedBook[] — same shape the UI uses today
├── series/index.json            # ALL series, compact: {asin, name, authors, subgenres,
│                                #   bookCount, firstYear, lastYear, coverUrl} — ~50KB
└── browse/
    ├── series/<seriesAsin>.json     # full ExportedBook[] for one series
    ├── authors/<slug>.json          # precomputed per-author books
    └── narrators/<slug>.json        # precomputed per-narrator books
```

`ExportedBook` keeps today's fields (BookCard/BrowseModal port unchanged) plus `seriesAsin`. Changes from v1: the 655KB monolithic `series.json` becomes lazy per-entity files plus a compact `series/index.json` — which is exactly what the localStorage watch/hide feature needs to render a "watched series" view without loading the whole corpus.

## Frontend rebuild (`packages/web`)

Visuals and structure preserved: Gruvbox theme, Lora/Lilex, SeasonNav year navigation, GenreFilter chips, FilterPopover, BookCard grid, BrowseModal. Port each component to Svelte 5 runes with typed props from `contract`.

What changes under the hood:

- **URL as state.** `/{year}` routes with SvelteKit `load` in `+page.ts` (replaces onMount fetch — gets preloading/back-button/deep-links for free), prerendered per year. Browse modals via shallow routing (`/series/<asin>` etc.) so they're shareable and back-button-friendly, still rendering as overlays.
- **Data layer** (`lib/data.ts`): thin typed fetchers over the contract. Author/narrator lookups hit precomputed files instead of linear-scanning a 655KB blob.
- **User-state store now, features later** (`lib/prefs.svelte.ts`): a versioned localStorage-persisted runes store —
  ```ts
  { v: 1, watchedSeries: string[],  // series ASINs
    hiddenSeries: string[], hiddenAuthors: string[],
    sort: SortMode, subgenreFilters: Subgenre[] }
  ```
  Wired into filtering/sort from day one (persisting current filter prefs proves the plumbing); watch/hide UI lands as M5 with stable ASIN keys already in every export. Schema is versioned for painless migration.

## Workflows

**data.yml** — Mondays + `workflow_dispatch` (with `budget` and `stage` inputs):
checkout → bun install → `pipeline run --budget 600` → validate → commit `data/` with a stats message ("data: +12 books, 3 series closed, 214 ratings refreshed") → push. On any failure: create/update a pinned "data pipeline failing" issue (fixes silent-death; issues #6/#41). The weekly push is repo activity, so **GitHub can never auto-disable the cron again** — the failure mode that killed v1 is structurally impossible while the pipeline succeeds, and loudly visible when it doesn't.

**deploy.yml** — on push to main: bun install → `pipeline export` → `vite build` → Pages. No network fetches, no cache, deterministic. A data commit from data.yml triggers it, so a successful data run auto-deploys.

**ci.yml** — PRs: typecheck all packages, pipeline unit tests (merge rules, classifier, validate thresholds, NDJSON round-trip determinism), contract validation of a fixture export, web build.

## Bootstrap (one-time, run locally — no CI time limits)

1. **Seed** from the committed April export (~1,040 books across `static/data/*.json`) → `books.ndjson` skeleton, flagged needs-hydration. Salvage v1's 257-series search list + 220-entry series-reference.json as *seed series names*, and its author blocklist/content filters into pipeline config. Then delete `scripts/` entirely.
2. **Enumerate**: keyword slices × category nodes × both sort directions (each query capped at ~550 results; heavy overlap, dedupe by ASIN), paced at ~400 req/session over a few evenings — state committed between sessions, so nothing is ever lost to an interruption.
3. **Close** every discovered series ASIN (one request each), then **hydrate** everything.
4. **Curate**: classify, dump `series.ndjson` sorted by rating-count, and hand-review the top of the list plus everything the classifier is unsure about — with a Hardcover LitRPG-tag diff as a recall check. This one-time pass replaces v1's blocklist whack-a-mole with an explicit `include` bit per series.

Expected corpus: several thousand books / 500–1,000 series (v1 peaked at ~1,300 raw with keyword search only; the `keywords=litrpg` result count alone is ~5,000).

## Milestones

- **M0 — Scaffold** (small): workspaces, contract package, CI. Old site keeps deploying throughout.
- **M1 — Pipeline core** (the bulk): store, http+budget+breaker, audible client, discover/close/hydrate/merge + tests. Exit: bootstrap enumeration complete locally, `data/` committed.
- **M2 — Classify/validate/export** (medium): stages 4–6, curation pass. Exit: exported JSON validates against contract with more, cleaner books than the live site.
- **M3 — Web port** (medium): visual-parity port to runes + URL state + prefs store. Exit: side-by-side parity.
- **M4 — Cutover** (small): new workflows live, legacy `scripts/`, root svelte app, and dead config deleted; first scheduled run commits + deploys unattended.
- **M5 — Watch/hide features** (next phase): UI on top of the prefs store + series index shipped in M2/M3.

## Risks

- **Unofficial API changes/blocks** — the corpus in git means the site never regresses; worst case exports serve last-good data indefinitely. Audnexus as partial fallback; scraping as last resort.
- **Standalone books** (no series ASIN): keyed by book ASIN; closure doesn't apply, discovery still finds them.
- **Marketplace duplicates/re-releases** (v1 issue #14): US-only at ingest; a `duplicateOf` correction field handles known cases; fuzzy dedup deliberately deferred.
- **Rate-limit opacity**: budgets are conservative guesses; the breaker + git state make a throttled run cost nothing but time.
