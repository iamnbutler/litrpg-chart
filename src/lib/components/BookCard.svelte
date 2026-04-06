<script lang="ts">
	import type { Book } from '$lib/types';
	import { subgenreLabels, subgenreColors } from '$lib/types';

	let { book }: { book: Book } = $props();

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

	<div class="info">
		<h3 class="title">{book.title}</h3>
		<p class="author">{book.author}</p>

		{#if book.narrator}
			<p class="narrator">
				Narrated by {book.narrator}
				{#if book.isAINarrated}
					<span class="ai-badge">AI</span>
				{/if}
			</p>
		{:else}
			<p class="narrator">
				<span class="ai-badge">No narrator</span>
			</p>
		{/if}

		<p class="release-date">
			{formatDate(book.releaseDate)}
			{#if book.audiobookLength}
				<span class="separator">&middot;</span>
				<span class="length">{book.audiobookLength}</span>
			{/if}
			{#if book.rating}
				<span class="separator">&middot;</span>
				<span class="rating">{book.rating.toFixed(1)}&star;</span>
				{#if book.ratingCount}
					<span class="rating-count">({book.ratingCount.toLocaleString()})</span>
				{/if}
			{/if}
		</p>

		<div class="tags">
			{#if book.seriesNumber}
				<span class="tag series-tag">Book {book.seriesNumber}</span>
			{/if}
			{#each book.subgenres as genre}
				<span class="tag" style="--tag-color: {subgenreColors[genre]}">{subgenreLabels[genre]}</span>
			{/each}
		</div>

		{#if book.description}
			<p class="description">{book.description}</p>
		{/if}
	</div>
</a>

<style>
	.book-card {
		display: grid;
		grid-template-columns: 130px 1fr;
		gap: 0;
		background: var(--card-bg);
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid var(--border);
		transition: transform 0.15s ease, box-shadow 0.15s ease;
		text-decoration: none;
		color: inherit;
	}

	.book-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
	}

	.cover {
		position: relative;
		width: 130px;
		min-height: 195px;
		overflow: hidden;
		background: #1a1d2e;
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
		background: rgba(0, 0, 0, 0.75);
		color: #a0aec0;
		padding: 2px 8px;
		border-radius: 6px;
		font-size: 0.7rem;
		font-weight: 600;
		backdrop-filter: blur(4px);
	}

	.countdown-text.soon {
		background: rgba(245, 158, 11, 0.4);
		color: #fbbf24;
	}

	.released-badge {
		position: absolute;
		top: 8px;
		right: 8px;
		background: rgba(16, 185, 129, 0.25);
		color: #34d399;
		padding: 2px 8px;
		border-radius: 6px;
		font-size: 0.7rem;
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
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
		line-height: 1.3;
	}

	.author {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin: 0;
	}

	.narrator {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0;
	}

	.ai-badge {
		display: inline-block;
		font-size: 0.6rem;
		padding: 1px 5px;
		border-radius: 3px;
		background: rgba(239, 68, 68, 0.15);
		color: #f87171;
		font-weight: 600;
		vertical-align: middle;
		margin-left: 0.3rem;
	}

	.rating {
		color: #fbbf24;
	}

	.rating-count {
		opacity: 0.6;
		font-size: 0.65rem;
	}

	.release-date {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0.25rem 0 0;
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
		font-size: 0.65rem;
		padding: 2px 8px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--tag-color, #6366f1) 15%, transparent);
		color: var(--tag-color, #94a3b8);
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.series-tag {
		--tag-color: #94a3b8;
		background: rgba(148, 163, 184, 0.1);
	}

	.description {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0.35rem 0 0;
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	@media (max-width: 600px) {
		.book-card {
			grid-template-columns: 100px 1fr;
		}

		.cover {
			width: 100px;
			min-height: 150px;
		}

		.title {
			font-size: 0.85rem;
		}
	}
</style>
