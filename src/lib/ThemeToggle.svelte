<script lang="ts">
	import { onMount } from 'svelte';
	import { theme, THEME_LABELS, nextThemeLabel } from '$lib/theme.svelte';
	import ThemeModeIcon from '$lib/ThemeModeIcon.svelte';

	// The signed-out pages (landing, login) have no nav bar to host the toggle, so
	// it pins itself to the top-right of the viewport instead.
	onMount(() => {
		theme.sync();
	});

	// Where you are, and what pressing does. The icon carries the first; this
	// carries the second, because with three modes an icon cannot say "next".
	const label = $derived(
		`Theme: ${THEME_LABELS[theme.choice]}. Switch to ${nextThemeLabel(theme.choice)}.`
	);
</script>

<button
	type="button"
	class="theme-toggle"
	title={label}
	aria-label={label}
	onclick={() => theme.cycle()}
>
	<ThemeModeIcon />
</button>

<style>
	/* A translucent chip rather than a bare icon: it floats over whatever the page
	   scrolls underneath it (hero gradient, cards, artwork), and an unbacked icon
	   disappeared against the busier of those. The blur keeps it legible without
	   painting a hard box over the content. */
	.theme-toggle {
		position: fixed;
		top: 1rem;
		right: 1rem;
		z-index: 60;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface) 80%, transparent);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
		color: var(--fg-muted);
		cursor: pointer;
		transition:
			color 0.16s ease,
			background 0.16s ease,
			border-color 0.16s ease;
	}
	.theme-toggle:hover {
		color: var(--fg);
		background: var(--surface);
		border-color: var(--fg-muted);
	}
	.theme-toggle:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	@media (max-width: 480px) {
		.theme-toggle {
			top: 0.6rem;
			right: 0.6rem;
		}
	}
</style>
