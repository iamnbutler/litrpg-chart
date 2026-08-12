/**
 * CLOSE-SERIES: the gap-killer. One relationships request per series returns
 * every volume with its sequence number; unknown volumes become stub books
 * for the hydrate stage. Series are refreshed on a rolling policy — recently
 * active series weekly, dormant ones monthly — oldest-checked first, so a
 * budget-limited run always makes progress and the remainder rolls forward.
 */
import type { AudibleClient } from "../audible.ts";
import { ensureSeries } from "../merge.ts";
import type { PipelineConfig } from "../config.ts";
import type { Corpus } from "../types.ts";

export interface CloseSeriesResult {
	seriesChecked: number;
	newVolumes: number;
	goneSeries: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Series due for a closure check, most-overdue first. */
export function selectSeriesDue(corpus: Corpus, config: PipelineConfig, now: string): string[] {
	const nowMs = Date.parse(now);

	// A series is "active" if any of its books released within the window
	// (including future/preorder dates).
	const latestRelease = new Map<string, number>();
	for (const book of corpus.books.values()) {
		if (!book.series || !book.releaseDate) continue;
		const t = Date.parse(book.releaseDate);
		if (Number.isNaN(t)) continue;
		const prev = latestRelease.get(book.series.asin);
		if (prev === undefined || t > prev) latestRelease.set(book.series.asin, t);
	}

	const due: Array<{ asin: string; lastClosed: number }> = [];
	for (const s of corpus.series.values()) {
		const last = s.lastClosedAt ? Date.parse(s.lastClosedAt) : 0;
		const latest = latestRelease.get(s.asin);
		const active = latest !== undefined && nowMs - latest < config.closure.activeWindowDays * DAY_MS;
		const refreshMs =
			(active ? config.closure.activeRefreshDays : config.closure.dormantRefreshDays) * DAY_MS;
		if (nowMs - last >= refreshMs) due.push({ asin: s.asin, lastClosed: last });
	}
	due.sort((a, b) => a.lastClosed - b.lastClosed);
	return due.map((d) => d.asin);
}

export async function closeSeries(
	corpus: Corpus,
	client: AudibleClient,
	config: PipelineConfig,
	now: string,
	log: (msg: string) => void,
): Promise<CloseSeriesResult> {
	const result: CloseSeriesResult = { seriesChecked: 0, newVolumes: 0, goneSeries: 0 };
	const due = selectSeriesDue(corpus, config, now);
	log(`close-series: ${due.length} series due`);

	for (const seriesAsin of due) {
		const series = corpus.series.get(seriesAsin);
		if (!series) continue;
		const volumes = await client.getSeriesVolumes(seriesAsin);
		result.seriesChecked++;

		if (volumes === null) {
			// Series product gone from the catalog; stop checking it weekly but
			// keep its books. (lastClosedAt still advances so it goes dormant.)
			result.goneSeries++;
			series.lastClosedAt = now;
			continue;
		}

		for (const vol of volumes) {
			const existing = corpus.books.get(vol.asin);
			if (existing) {
				// Books discovered by keyword search sometimes lack the series
				// link or position; the relationships listing is authoritative.
				if (!existing.series || existing.series.asin === seriesAsin) {
					existing.series = { asin: seriesAsin, name: series.name, position: vol.sequence };
				}
				continue;
			}
			corpus.books.set(vol.asin, {
				asin: vol.asin,
				title: null,
				subtitle: null,
				authors: [],
				narrators: [],
				series: { asin: seriesAsin, name: series.name, position: vol.sequence },
				releaseDate: null,
				runtimeMin: null,
				language: null,
				rating: null,
				coverUrl: null,
				description: null,
				publisher: null,
				aiNarrated: false,
				subgenres: null,
				meta: { firstSeenAt: now, lastHydratedAt: null, sources: [] },
			});
			result.newVolumes++;
		}
		ensureSeries(corpus, seriesAsin, series.name);
		series.lastClosedAt = now;
	}

	return result;
}
