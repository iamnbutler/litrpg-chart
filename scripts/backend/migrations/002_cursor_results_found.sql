-- Track results_found in search_cursors so we can distinguish
-- "genuinely no results" from "rate-limited empty response".
-- Zero-result exhausted cursors get retried; productive ones stay cached.

ALTER TABLE search_cursors ADD COLUMN results_found INTEGER DEFAULT 0;

-- Backfill from fetch_runs where possible (use most recent run per cursor)
UPDATE search_cursors SET results_found = COALESCE(
  (SELECT MAX(fr.results_found) FROM fetch_runs fr
   WHERE fr.source = search_cursors.source
     AND fr.search_key = search_cursors.search_key
     AND fr.year = search_cursors.year),
  0
);
