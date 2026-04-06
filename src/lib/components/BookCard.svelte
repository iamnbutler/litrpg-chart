<script lang="ts">
	import type { Book } from '$lib/types';
	import { subgenreLabels, subgenreColors } from '$lib/types';

	let { book, onAuthorClick, onSeriesClick }: {
		book: Book;
		onAuthorClick?: (name: string) => void;
		onSeriesClick?: (series: string) => void;
	} = $props();

	const released = $derived(new Date(book.releaseDate) <= new Date());
	const days = $derived(Math.ceil((new Date(book.releaseDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	// Fallback hue for placeholder covers
	function seriesHue(series: string): number {
		let hash = 0;
		for (let i = 0; i < series.length; i++) {
			hash = series.charCodeAt(i) + ((hash << 5) - hash);
		}
		return Math.abs(hash) % 360;
	}

	const hue = $derived(seriesHue(book.series));
</script>

<a
	class="book-card"
	class:released
	href={book.url}
	target="_blank"
	rel="noopener noreferrer"
>
	<div class="info">
		<h3 class="title">{book.title}</h3>
		<p class="author">{#each book.author.split(', ') as name, i}{#if i > 0}, {/if}{#if onAuthorClick}<button class="link-btn" onclick={(e) => { e.preventDefault(); onAuthorClick(name.trim()); }}>{name.trim()}</button>{:else}{name.trim()}{/if}{/each} {#if book.narrator}<span class="narrator">with {#each book.narrator.split(', ') as name, i}{#if i > 0}, {/if}{#if onAuthorClick}<button class="link-btn" onclick={(e) => { e.preventDefault(); onAuthorClick(name.trim()); }}>{name.trim()}</button>{:else}{name.trim()}{/if}{/each}</span>{/if}</p>

		<div class="tags">
			{#each book.subgenres as genre}
				<span class="tag" style="--tag-color: {subgenreColors[genre]}">{subgenreLabels[genre]}</span>
			{/each}
			{#if book.seriesNumber}
				<button class="tag series-tag" onclick={(e) => { e.preventDefault(); onSeriesClick?.(book.series); }}>Book {book.seriesNumber}{#if book.series} &middot; {book.series}{/if}</button>
			{/if}
		</div>

		{#if book.description}
			<p class="description">{book.description}</p>
		{/if}

		<p class="meta-line">
			{formatDate(book.releaseDate)}
			{#if book.audiobookLength}
				<span class="separator">&middot;</span>
				<span class="length">{book.audiobookLength}</span>
			{/if}
		</p>
	</div>

	<div class="cover">
		{#if book.coverUrl}
			<img src={book.coverUrl} alt={book.title} loading="lazy" />
		{:else}
			<div class="cover-placeholder" style="--hue: {hue}">
				<span class="cover-number">#{book.seriesNumber ?? '?'}</span>
				<span class="cover-series">{book.series}</span>
			</div>
		{/if}

		{#if !released}
			<div class="countdown">
				{#if days <= 0}
					<span class="countdown-text">Out now</span>
				{:else if days <= 7}
					<span class="countdown-text soon">{days}d</span>
				{:else}
					<span class="countdown-text">{days}d</span>
				{/if}
			</div>
		{:else}
			<div class="released-badge">Released</div>
		{/if}
	</div>
</a>

<style>
	.book-card {
		display: grid;
		grid-template-columns: 1fr 160px;
		gap: 0;
		background: var(--card-bg);
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid var(--border);
		text-decoration: none;
		color: inherit;
	}

	.cover {
		position: relative;
		width: 160px;
		min-height: 220px;
		overflow: hidden;
		background: var(--surface);
	}

	.cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.cover-placeholder {
		width: 100%;
		height: 100%;
		background: linear-gradient(
			135deg,
			hsl(var(--hue), 50%, 25%),
			hsl(var(--hue), 60%, 15%)
		);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.cover-number {
		font-size: 2rem;
		font-weight: 800;
		color: hsla(var(--hue), 70%, 75%, 0.9);
		line-height: 1;
	}

	.cover-series {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: hsla(var(--hue), 50%, 70%, 0.7);
		margin-top: 0.5rem;
		line-height: 1.3;
		text-align: center;
	}

	.countdown {
		position: absolute;
		top: 8px;
		right: 8px;
	}

	.countdown-text {
		background: var(--surface);
		color: var(--text-secondary);
		padding: 2px 8px;
		border-radius: 6px;
		font-family: var(--font-mono, monospace);
		font-size: 0.65rem;
		font-weight: 600;
	}

	.countdown-text.soon {
		background: var(--yellow);
		color: var(--bg);
	}

	.released-badge {
		position: absolute;
		top: 8px;
		right: 8px;
		background: var(--green);
		color: var(--bg);
		padding: 2px 8px;
		border-radius: 6px;
		font-family: var(--font-mono, monospace);
		font-size: 0.65rem;
		font-weight: 600;
	}

	.info {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.title {
		font-family: var(--font-serif);
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
		line-height: 1.3;
		text-wrap: balance;
	}

	.author {
		font-family: var(--font-serif);
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin: 0;
	}

	.narrator {
		color: inherit;
	}

	.link-btn {
		all: unset;
		cursor: pointer;
		text-decoration: underline;
		text-decoration-color: transparent;
		text-underline-offset: 2px;
		transition: text-decoration-color 0.15s;
	}

	.link-btn:hover {
		text-decoration-color: currentColor;
	}

	.meta-line {
		font-family: var(--font-mono, monospace);
		font-size: 0.7rem;
		color: var(--text-muted);
		margin: auto 0 0;
		padding-top: 0.5rem;
	}

	.separator {
		margin: 0 0.3rem;
		opacity: 0.5;
	}

	.length {
		opacity: 0.8;
	}

	.tags {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		margin-top: 0.35rem;
	}

	.tag {
		font-family: var(--font-mono, monospace);
		font-size: 0.6rem;
		padding: 2px 8px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--tag-color, var(--accent)) 15%, transparent);
		color: var(--tag-color, var(--text-secondary));
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.series-tag {
		--tag-color: var(--text-secondary);
		background: color-mix(in srgb, var(--text-muted) 10%, transparent);
	}

	.description {
		font-family: var(--font-serif);
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin: 0.7rem 0 0;
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	@media (max-width: 500px) {
		.book-card {
			grid-template-columns: 1fr 110px;
		}

		.cover {
			width: 110px;
			min-height: 160px;
		}

		.title {
			font-size: 0.85rem;
		}

		.info {
			padding: 0.75rem;
		}
	}
</style>
