# Timeline Navigation Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the year dropdown + season tabs with a continuous vertical scroll of all seasons (newest at top), a Time Machine-style timeline ruler on the right, and a floating position pill. URLs like `/2026/summer` deep-link to specific seasons.

**Architecture:** Single SvelteKit page with `[year]/[season]` routes. Root `/` redirects to current season. All seasons render in one scroll. IntersectionObserver tracks visible section to update URL, pill, and ruler. Lazy-load year data as user scrolls near it.

**Tech Stack:** SvelteKit 5 (Svelte 5 runes), adapter-static with 404.html fallback, GitHub Pages

---

### Task 1: Routing & Adapter Config

**Files:**
- Modify: `svelte.config.js`
- Modify: `src/lib/types.ts`
- Create: `src/routes/+page.svelte` (replace: redirect to current season)
- Create: `src/routes/[year]/[season]/+page.svelte` (main app)
- Create: `src/routes/[year]/[season]/+page.ts` (load params + entries)

**What:**
1. Add `fallback: '404.html'` to adapter-static config (handles deep links on GH Pages)
2. Add `Season` type (`'winter' | 'spring' | 'summer' | 'fall'`) and season<->quarter mapping to types.ts
3. Root `+page.svelte`: redirect to `/{currentYear}/{currentSeason}` on mount
4. `[year]/[season]/+page.ts`: parse year/season from params, export `entries()` for prerendering all year/season combos
5. `[year]/[season]/+page.svelte`: the main app

### Task 2: Continuous Scroll Page

**Files:**
- Create: `src/routes/[year]/[season]/+page.svelte`
- Modify: `src/lib/api.ts` (add fetchAllYears helper)

**What:**
1. On mount, load meta.json to determine available years
2. Load initial year (from URL) + adjacent years
3. Render all loaded seasons as `<section>` elements, reverse chronological (newest at top)
4. Each season section has a sticky header ("Winter 2026") and the existing book grid
5. Genre filters, sort, count in a global sticky header toolbar
6. Filters/sort apply across all visible seasons
7. IntersectionObserver on season headers to track current visible season
8. As user scrolls near an unloaded year, trigger fetch
9. On load, scroll to the season matching the URL

### Task 3: TimelineRuler Component (Desktop)

**Files:**
- Create: `src/lib/components/TimelineRuler.svelte`

**What:**
1. Fixed position on right edge, vertically centered
2. Year labels with season tick marks between them
3. Active/current position highlighted
4. Click any year/season to scroll there
5. Hidden on mobile (< 768px)

### Task 4: FloatingPill Component

**Files:**
- Create: `src/lib/components/FloatingPill.svelte`

**What:**
1. Fixed position, top-center on desktop, bottom-center on mobile
2. Shows current season label (e.g., "Summer 2026")
3. Tap/click opens a quick-jump popover listing all available years
4. Replaces SeasonNav entirely

### Task 5: URL Sync & Scroll-to-Section

**What:**
1. As user scrolls, update URL via `history.replaceState()` to match visible season
2. On initial load, parse URL and `scrollIntoView` the target season
3. Clicking timeline ruler or pill jumps scrolls to section and updates URL
4. Debounce URL updates to avoid excessive history entries

### Task 6: Cleanup & Deploy

**What:**
1. Remove SeasonNav component (no longer used)
2. Remove mobile-bottom-bar from old page
3. Verify build works with `npm run check` and `vite build`
4. Verify 404.html is generated in build output
5. Test deep links work locally with `vite preview`
