import { error } from '@sveltejs/kit';
import { fetchMeta, fetchYearBooks } from '$lib/data';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
	const year = Number(params.year);
	if (!/^\d{4}$/.test(params.year) || Number.isNaN(year)) error(404, 'Not found');

	const [meta, books] = await Promise.all([fetchMeta(fetch), fetchYearBooks(year, fetch)]);
	const availableYears = Object.keys(meta?.years ?? {})
		.map(Number)
		.sort((a, b) => a - b);

	return { year, books, availableYears, lastUpdated: meta?.lastUpdated ?? null };
};
