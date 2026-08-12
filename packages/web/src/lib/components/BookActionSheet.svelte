<script lang="ts">
	import { base } from '$app/paths';
	import type { Book } from '$lib/types';
	import { prefs } from '$lib/prefs.svelte';

	let { book, onClose }: { book: Book; onClose: () => void } = $props();

	let closing = $state(false);

	function handleClose() {
		closing = true;
		setTimeout(onClose, 180);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') handleClose();
	}

	const inCollection = $derived(book.seriesAsin ? prefs.isWatched(book.seriesAsin) : false);
	const read = $derived(prefs.isRead(book.asin));
	const hidden = $derived(
		book.seriesAsin ? prefs.hiddenSeries.has(book.seriesAsin) : prefs.hiddenBooks.has(book.asin)
	);

	function toggleCollection() {
		if (book.seriesAsin) prefs.toggleWatchedSeries(book.seriesAsin);
	}

	function toggleHide() {
		if (book.seriesAsin) prefs.toggleHiddenSeries(book.seriesAsin);
		else prefs.toggleHiddenBook(book.asin);
		handleClose();
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sheet-backdrop" class:closing onclick={handleClose} onkeydown={() => {}}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sheet" class:closing onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
		<div class="sheet-head">
			{#if book.coverUrl}
				<img class="thumb" src={book.coverUrl} alt="" />
			{/if}
			<div class="head-text">
				<span class="sheet-title">{book.title}</span>
				{#if book.seriesName}
					<span class="sheet-sub">{book.seriesName}{book.seriesPosition ? ` — Book ${book.seriesPosition}` : ''}</span>
				{/if}
			</div>
			<button class="sheet-close" onclick={handleClose} aria-label="Close">&times;</button>
		</div>

		<div class="actions">
			<a class="action" href={book.url} target="_blank" rel="noopener noreferrer" onclick={handleClose}>
				<span class="action-icon">↗</span>
				<span class="action-label">Open on Audible</span>
			</a>

			{#if book.seriesAsin}
				<button class="action" class:active={inCollection} onclick={toggleCollection}>
					<span class="action-icon">{inCollection ? '★' : '+'}</span>
					<span class="action-label">{inCollection ? 'Series in collection' : 'Add series to collection'}</span>
				</button>
			{/if}

			<button class="action" class:active={read} onclick={() => prefs.toggleRead(book.asin)}>
				<span class="action-icon">{read ? '✓' : '○'}</span>
				<span class="action-label">{read ? 'Read' : 'Mark as read'}</span>
			</button>

			<button class="action danger" onclick={toggleHide}>
				<span class="action-icon">✕</span>
				<span class="action-label">{hidden ? (book.seriesAsin ? 'Unhide series' : 'Unhide book') : (book.seriesAsin ? 'Hide series' : 'Hide book')}</span>
			</button>
		</div>

		{#if prefs.watchedSeries.size > 0}
			<a class="collection-link" href="{base}/collection">Your collection ({prefs.watchedSeries.size}) &rarr;</a>
		{/if}
	</div>
</div>

<style>
	.sheet-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: color-mix(in srgb, var(--bg) 60%, transparent);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		animation: fadeIn 0.18s ease-out forwards;
	}

	.sheet-backdrop.closing {
		animation: fadeOut 0.18s ease-out forwards;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes fadeOut {
		from { opacity: 1; }
		to { opacity: 0; }
	}

	.sheet {
		width: 100%;
		max-width: 480px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-bottom: none;
		border-radius: 16px 16px 0 0;
		padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
		box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.4);
		animation: slideUp 0.18s ease-out forwards;
	}

	.sheet.closing {
		animation: slideDown 0.18s ease-out forwards;
	}

	@keyframes slideUp {
		from { transform: translateY(100%); }
		to { transform: translateY(0); }
	}

	@keyframes slideDown {
		from { transform: translateY(0); }
		to { transform: translateY(100%); }
	}

	.sheet-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.thumb {
		width: 44px;
		height: 44px;
		border-radius: 6px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.head-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.sheet-title {
		font-family: var(--font-serif);
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
		line-height: 1.25;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.sheet-sub {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sheet-close {
		background: none;
		border: none;
		font-size: 1.5rem;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0 0.25rem;
		line-height: 1;
		align-self: flex-start;
	}

	.sheet-close:hover {
		color: var(--text-primary);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.action {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.6rem;
		border: none;
		background: transparent;
		border-radius: 8px;
		cursor: pointer;
		text-decoration: none;
		text-align: left;
		transition: background 0.1s;
	}

	.action:hover {
		background: color-mix(in srgb, var(--border) 50%, transparent);
	}

	.action-icon {
		font-family: var(--font-mono);
		font-size: 0.85rem;
		color: var(--text-muted);
		width: 1.2rem;
		text-align: center;
		flex-shrink: 0;
	}

	.action-label {
		font-family: var(--font-serif);
		font-size: 0.85rem;
		color: var(--text-primary);
	}

	.action.active .action-icon,
	.action.active .action-label {
		color: var(--accent);
	}

	.action.danger:hover .action-icon,
	.action.danger:hover .action-label {
		color: var(--red-bright);
	}

	.collection-link {
		display: block;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--accent);
		text-decoration: none;
		text-align: center;
	}

	.collection-link:hover {
		text-decoration: underline;
	}

	@media (min-width: 601px) {
		.sheet-backdrop {
			align-items: center;
			padding: 1rem;
		}

		.sheet {
			border-radius: 16px;
			border-bottom: 1px solid var(--border);
			animation: popIn 0.18s ease-out forwards;
		}

		.sheet.closing {
			animation: fadeOut 0.15s ease-out forwards;
		}

		@keyframes popIn {
			from { transform: translateY(12px); opacity: 0; }
			to { transform: translateY(0); opacity: 1; }
		}
	}
</style>
