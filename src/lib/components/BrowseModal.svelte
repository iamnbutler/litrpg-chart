<script lang="ts">
	import type { Book, ActiveFilter } from '$lib/types';
	import BookCard from './BookCard.svelte';

	let {
		filter,
		books,
		onClose,
		onAuthorClick,
		onNarratorClick,
		onSeriesClick,
	}: {
		filter: ActiveFilter;
		books: Book[];
		onClose: () => void;
		onAuthorClick: (name: string) => void;
		onNarratorClick: (name: string) => void;
		onSeriesClick: (series: string) => void;
	} = $props();

	let closing = $state(false);

	function handleClose() {
		closing = true;
		setTimeout(onClose, 230);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') handleClose();
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" class:closing onclick={handleClose}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
		<div class="modal-header">
			<h2 class="modal-title">
				{#if filter.type === 'author'}
					Books by <strong>{filter.value}</strong>
				{:else if filter.type === 'narrator'}
					Narrated by <strong>{filter.value}</strong>
				{:else}
					<strong>{filter.value}</strong>
				{/if}
			</h2>
			<span class="modal-count">{books.length} title{books.length !== 1 ? 's' : ''}</span>
			<button class="modal-close" onclick={handleClose}>&times;</button>
		</div>

		<div class="modal-body">
			{#if books.length === 0}
				<p class="modal-empty">No books found.</p>
			{:else}
				<div class="modal-grid">
					{#each books as book (book.id)}
						<BookCard {book} {onAuthorClick} {onNarratorClick} {onSeriesClick} />
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	@property --ring-size {
		syntax: '<length>';
		inherits: false;
		initial-value: 40px;
	}

	@property --ring-gap {
		syntax: '<length>';
		inherits: false;
		initial-value: 80px;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background-color: color-mix(in srgb, var(--bg) 90%, transparent);
		background-image:
			radial-gradient(circle at center center, color-mix(in srgb, var(--border) 10%, transparent), transparent),
			repeating-radial-gradient(circle at center center, color-mix(in srgb, var(--border) 10%, transparent), color-mix(in srgb, var(--border) 10%, transparent) var(--ring-size), transparent var(--ring-gap), transparent var(--ring-size));
		background-blend-mode: multiply;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 3rem 1rem;
		overflow-y: auto;
		--ring-size: 40px;
		--ring-gap: 80px;
		animation: openBg 0.3s ease-out forwards;
	}

	.modal-backdrop.closing {
		animation: closeBg 0.23s ease-out forwards;
	}

	@keyframes openBg {
		0% {
			opacity: 0;
			--ring-size: 60px;
			--ring-gap: 120px;
		}
		100% {
			opacity: 1;
			--ring-size: 40px;
			--ring-gap: 80px;
		}
	}

	@keyframes closeBg {
		0% {
			opacity: 1;
			--ring-size: 40px;
			--ring-gap: 80px;
		}
		100% {
			opacity: 0;
			--ring-size: 24px;
			--ring-gap: 48px;
		}
	}

	.modal {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 16px;
		width: 100%;
		max-width: 900px;
		max-height: calc(100vh - 6rem);
		display: flex;
		flex-direction: column;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	.modal-title {
		font-family: var(--font-serif);
		font-size: 1rem;
		font-weight: 400;
		color: var(--text-primary);
		margin: 0;
		flex: 1;
	}

	.modal-count {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.modal-close {
		background: none;
		border: none;
		font-size: 1.5rem;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0 0.25rem;
		line-height: 1;
	}

	.modal-close:hover {
		color: var(--text-primary);
	}

	.modal-body {
		padding: 1.25rem;
		overflow-y: auto;
	}

	.modal-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.modal-empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}

	@media (max-width: 600px) {
		.modal-backdrop {
			padding: 1rem 0.5rem;
		}

		.modal {
			max-height: calc(100vh - 2rem);
			border-radius: 12px;
		}
	}
</style>
