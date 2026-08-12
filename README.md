# LitRPG Chart

Seasonal chart of LitRPG / progression-fantasy audiobooks — [nate.rip/litrpg-chart](https://nate.rip/litrpg-chart/).

The catalog lives in this repo as newline-delimited JSON (`data/*.ndjson`), updated weekly by a scheduled pipeline that talks to the Audible catalog API, and rendered by a static SvelteKit app. See [CLAUDE.md](CLAUDE.md) for architecture rules and [docs/rebuild-plan.md](docs/rebuild-plan.md) for the design rationale.

## Development

```bash
bun install
bun run pipeline export   # generate packages/web/static/data from the committed corpus
bun run dev               # web app on localhost
```

Refreshing data locally (optional; the weekly workflow does this in CI):

```bash
bun run pipeline run --budget 300
```

## Layout

| Path | What |
|---|---|
| `data/` | Canonical corpus (committed NDJSON) + `corrections.ndjson` for manual overrides |
| `packages/contract` | Zod schemas of the exported JSON — the pipeline↔web boundary |
| `packages/pipeline` | Discover / close-series / hydrate / classify / validate / export |
| `packages/web` | SvelteKit SPA (GitHub Pages) |
