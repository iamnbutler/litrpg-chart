// Prerendered shell; collection membership lives in localStorage, but the
// series index (names/covers for every exported series) loads here.
import { fetchSeriesIndex } from '$lib/data';
import type { PageLoad } from './$types';

export const prerender = true;

export const load: PageLoad = async ({ fetch }) => {
	const seriesIndex = (await fetchSeriesIndex(fetch)) ?? [];
	return { seriesIndex };
};
