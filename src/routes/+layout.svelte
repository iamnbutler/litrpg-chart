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

	:global(html) {
		overscroll-behavior: none;
	}

	:global(body) {
		font-family: 'Lora', Georgia, 'Times New Roman', serif;
		-webkit-font-smoothing: antialiased;

		/* Gruvbox Dark (default) */
		background: #282828;
		color: #ebdbb2;

		--bg: #282828;
		--bg-soft: #1d2021;
		--surface: #3c3836;
		--card-bg: #32302f;
		--border: #504945;
		--border-soft: #3c3836;
		--text-primary: #ebdbb2;
		--text-secondary: #d5c4a1;
		--text-muted: #928374;
		--accent: #d79921;
		--accent-hover: #fabd2f;

		/* Gruvbox semantic colors */
		--red: #cc241d;
		--green: #98971a;
		--yellow: #d79921;
		--blue: #458588;
		--purple: #b16286;
		--aqua: #689d6a;
		--orange: #d65d0e;

		--red-bright: #fb4934;
		--green-bright: #b8bb26;
		--yellow-bright: #fabd2f;
		--blue-bright: #83a598;
		--purple-bright: #d3869b;
		--aqua-bright: #8ec07c;
		--orange-bright: #fe8019;

		/* Font stacks */
		--font-serif: 'Lora', Georgia, 'Times New Roman', serif;
		--font-mono: 'Lilex', 'JetBrains Mono', 'Fira Code', monospace;
	}

	@media (prefers-color-scheme: light) {
		:global(body) {
			background: #fbf1c7;
			color: #3c3836;

			--bg: #fbf1c7;
			--bg-soft: #f9f5d7;
			--surface: #f2e5bc;
			--card-bg: #f9f5d7;
			--border: #d5c4a1;
			--border-soft: #ebdbb2;
			--text-primary: #3c3836;
			--text-secondary: #504945;
			--text-muted: #928374;
			--accent: #b57614;
			--accent-hover: #d79921;

			--red: #cc241d;
			--green: #98971a;
			--yellow: #b57614;
			--blue: #076678;
			--purple: #8f3f71;
			--aqua: #427b58;
			--orange: #af3a03;

			--red-bright: #9d0006;
			--green-bright: #79740e;
			--yellow-bright: #b57614;
			--blue-bright: #076678;
			--purple-bright: #8f3f71;
			--aqua-bright: #427b58;
			--orange-bright: #af3a03;
		}
	}

	:global(button) {
		font-family: var(--font-mono);
	}
</style>
