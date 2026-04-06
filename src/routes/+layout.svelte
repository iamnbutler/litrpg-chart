<script lang="ts">
	let { children } = $props();
</script>

{@render children()}

<style>
	:global(*) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
		background: #0f1117;
		color: #e2e8f0;
		-webkit-font-smoothing: antialiased;

		--bg: #0f1117;
		--surface: #1a1d2e;
		--card-bg: #161927;
		--border: #2a2d3e;
		--text-primary: #f1f5f9;
		--text-secondary: #94a3b8;
		--text-muted: #64748b;
		--accent: #6366f1;
	}

	:global(button) {
		font-family: inherit;
	}
</style>
