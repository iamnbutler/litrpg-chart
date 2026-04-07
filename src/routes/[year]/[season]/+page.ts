import type { PageLoad } from './$types';
import type { Season } from '$lib/types';

export const prerender = true;

export function entries() {
	const seasons = ['winter', 'spring', 'summer', 'fall'];
	const years: number[] = [];
	for (let y = 2017; y <= 2027; y++) years.push(y);
	return years.flatMap((y) => seasons.map((s) => ({ year: String(y), season: s })));
}

export const load: PageLoad = ({ params }) => {
	return {
		year: parseInt(params.year, 10),
		season: params.season as Season
	};
};
