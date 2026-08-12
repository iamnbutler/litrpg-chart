# LitRPG Chart

A chart of LitRPG/progression-fantasy audiobooks. Bun workspaces monorepo:

- `data/` — **the canonical database**: NDJSON committed to git (books, series, corrections). SQLite does not exist here; the pipeline loads these into memory each run.
- `packages/contract` — zod schemas for the exported JSON; the only boundary between pipeline and web. Both sides import it.
- `packages/pipeline` — fetch/classify/validate/export. Run with `bun run pipeline <cmd>`.
- `packages/web` — SvelteKit SPA (Svelte 5 runes, adapter-static, Gruvbox theme).

Node 22 required for svelte tooling (`.nvmrc`); bun for everything else.

## Commands

```
bun run pipeline run --budget 600   # full pipeline: discover → close-series → hydrate → classify → validate → save → export
bun run pipeline export             # offline: static JSON from committed data/ (run before web dev/build)
bun run pipeline stats              # corpus health
bun run check                       # typecheck everything
bun run test                        # pipeline tests (vitest)
bun run dev / bun run build         # web app (needs a prior pipeline export)
```

## Architecture rules (learned the hard way in v1)

1. **Canonical data lives in `data/*.ndjson`, committed.** Never store state in CI caches. `corrections.ndjson` is hand-edited and never rewritten by the pipeline; corrections are applied at read time and always win.
2. **Identity is Audible ASINs** — books by product ASIN, series by series ASIN. Never key anything on title slugs (except author/narrator browse slugs from the shared `slugify`).
3. **merge.ts is the only writer** to book records. Fetchers emit `SourceRecord`s (the intermediary format; future sources — Audnexus, Hardcover — plug in there). Null/missing never overwrites real data.
4. **Every API request draws from a run budget**; hitting the ceiling ends the run cleanly and the remaining work rolls to the next run. Partial runs are safe by construction.
5. **Classification is series-level**; volumes inherit. Curate via `corrections.ndjson` (`include: false` kills a series from the chart; `subgenres: [...]` with `classifiedBy` manual pins genres).
6. **Deploys never fetch.** deploy.yml = export + build from the committed corpus. data.yml (weekly cron) is the only thing that talks to Audible, and its commit both triggers the deploy and keeps the cron alive (GitHub disables schedules after 60 days without repo activity — this killed v1).

## Audible API facts (verified 2026-08)

- Throttling = HTTP 200 with `products: []` while `total_results` > 0. The client throws `ThrottleError` on this signature; the run aborts fetching but keeps prior progress.
- `title` requires the `product_desc` response group (NOT `product_attrs`).
- Pagination caps at page 10 silently (~550 results per query slice) — `MAX_PAGE` in audible.ts.
- `series=` filter is broken. Series enumeration: `GET /1.0/catalog/products/{SERIES_ASIN}?response_groups=relationships` → all volumes with sequence numbers. This is the close-series stage and the reason series gaps stay closed.
- Category browse works via `category_id` (Fantasy `18580607011`, Sci-Fi `18580628011`); there is NO LitRPG browse node — genre classification is ours.
- `num_results` max 50. Stay under ~600 requests/run; the documented-by-experience rate limit starts around 500–1000.
