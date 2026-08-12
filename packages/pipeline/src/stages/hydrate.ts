/**
 * HYDRATE: full product fetches. Priority order:
 *   1. never-hydrated books (stubs from close-series, thin seeds)
 *   2. stalest previously-hydrated books (rolling rating refresh)
 * Runs until the request budget is gone; the rest rolls to the next run.
 */
import type { AudibleClient } from "../audible.ts";
import { toSourceRecord } from "../audible.ts";
import { applySourceRecord } from "../merge.ts";
import type { Corpus } from "../types.ts";

export interface HydrateResult {
	hydrated: number;
	missing: number;
}

export function selectHydrationQueue(corpus: Corpus): string[] {
	const never: string[] = [];
	const stale: Array<{ asin: string; at: number }> = [];
	for (const book of corpus.books.values()) {
		if (book.meta.lastHydratedAt === null) never.push(book.asin);
		else stale.push({ asin: book.asin, at: Date.parse(book.meta.lastHydratedAt) });
	}
	stale.sort((a, b) => a.at - b.at);
	return [...never, ...stale.map((s) => s.asin)];
}

export async function hydrate(
	corpus: Corpus,
	client: AudibleClient,
	now: string,
	log: (msg: string) => void,
	/** Stop early once the shared budget drops below this reserve. */
	stopAtRemaining = 0,
): Promise<HydrateResult> {
	const result: HydrateResult = { hydrated: 0, missing: 0 };
	const queue = selectHydrationQueue(corpus);
	log(`hydrate: ${queue.length} in queue`);

	for (const asin of queue) {
		if (client.budget.remaining <= stopAtRemaining) break;
		const product = await client.getProduct(asin);
		if (product === null) {
			// Delisted or region-blocked. Stamp it so it rotates to the back of
			// the stale queue instead of blocking the front forever.
			const book = corpus.books.get(asin);
			if (book) book.meta.lastHydratedAt = now;
			result.missing++;
			continue;
		}
		applySourceRecord(corpus, toSourceRecord(product, true, now));
		result.hydrated++;
		if (result.hydrated % 50 === 0) log(`hydrate: ${result.hydrated} done`);
	}

	return result;
}
