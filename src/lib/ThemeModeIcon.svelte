<script lang="ts">
	import { theme } from '$lib/theme.svelte';

	/**
	 * The glyph for whichever theme mode is on: sun, moon, or a display.
	 *
	 * One component because there are three places that draw it — the fixed chip
	 * on the signed-out pages, the contractor bar, and that bar's collapsed menu —
	 * and each of them held its own copy of the same two inline SVGs. Adding a
	 * third mode to three copies is how two of them end up a mode behind.
	 *
	 * It draws the mode you are IN, not the one the button will move to. With two
	 * modes those are interchangeable and some of these sites drew the
	 * destination; with three they are not, because "the next one" is not a thing
	 * an icon can say. The action lives in the button's accessible name instead —
	 * the split `ThemeModeButton` already documents.
	 */
	let { size = 20 }: { size?: number } = $props();
</script>

{#if theme.choice === 'system'}
	<!-- A display, the platform convention for "whatever the machine says". -->
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="2.5" y="4" width="19" height="13" rx="2" />
		<path d="M8.5 21h7M12 17v4" />
	</svg>
{:else if theme.choice === 'dark'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
	</svg>
{:else}
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<circle cx="12" cy="12" r="4.5" />
		<path
			d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
		/>
	</svg>
{/if}

<style>
	svg {
		display: block;
	}
</style>
