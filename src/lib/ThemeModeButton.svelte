<script lang="ts">
	import { onMount } from 'svelte';
	import { theme, THEME_LABELS, nextThemeLabel } from '$lib/theme.svelte';
	import ThemeModeIcon from '$lib/ThemeModeIcon.svelte';

	/**
	 * Light, dark or system, as one button.
	 *
	 * This replaced a two-radio segmented control. The objection to a toggle was
	 * always that it "only says what it will do next", so the current theme had to
	 * be read off the page itself — which is true of a bare icon, and the reason
	 * the radios existed. It is not true here: the FACE states where you are
	 * ("Light"), and the accessible name states the action ("Switch to dark
	 * theme"). Sighted and screen-reader users each get the half they need, and it
	 * costs one control instead of two.
	 *
	 * Sized to match `PaletteSwitcher`'s non-compact trigger, because the two sit
	 * beside each other on both settings surfaces and a mismatched pair reads as
	 * one control with something bolted on.
	 */
	onMount(() => {
		theme.sync();
	});

	const action = $derived(`Switch to ${nextThemeLabel(theme.choice)}`);
</script>

<button type="button" class="mode" title={action} aria-label={action} onclick={() => theme.cycle()}>
	<span class="mark"><ThemeModeIcon size={16} /></span>
	<span class="now">{THEME_LABELS[theme.choice]}</span>
</button>

<style>
	.mode {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface-sunken);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.mode:hover {
		border-color: var(--brand);
		box-shadow: 0 0 0 1px var(--brand-glow);
	}
	.mode:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	/* The mark was an emoji; it is an inline SVG now, so it needs a box rather
	   than a font size to sit on the label's baseline. */
	.mark {
		display: inline-flex;
		align-items: center;
		line-height: 1;
	}
</style>
