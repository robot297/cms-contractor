<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		palette,
		PALETTES,
		PALETTE_BLURBS,
		PALETTE_LABELS,
		PALETTE_SWATCHES
	} from '$lib/theme.svelte';

	/**
	 * Flip the whole app between the candidate themes, live.
	 *
	 * TEMPORARY — this exists to choose one, not to ship one. A real product does
	 * not offer its own brand as a setting: the moment a theme is picked, this
	 * component, the `PaletteStore` beside the theme store, and the losing blocks
	 * in app.css all come out together, and the winner collapses into the base
	 * `:root`. Grep for `data-palette` to find every piece.
	 *
	 * A menu rather than a row of buttons: a dozen swatches in the nav is a band
	 * of colour wider than the nav links, and it would sit there on every screen
	 * competing with the app it is meant to be showing off.
	 */
	let open = $state(false);

	/**
	 * Narrow screens get a real modal instead of an anchored menu.
	 *
	 * A media query rather than a prop, precisely because it is a property of the
	 * SCREEN rather than of the surface that mounted the control: the trigger
	 * turns up in the contractor bar, the portal bar and mid-page on both settings
	 * surfaces, and all four want the same answer at the same width.
	 *
	 * The dropdown is positioned against the trigger, and the trigger turns up in
	 * three different places — the contractor bar, the portal bar, and mid-page on
	 * both settings surfaces. On a phone that meant a list of thirteen options
	 * hanging off whatever corner it happened to be launched from, clipped by an
	 * ancestor here and running off the bottom there, and the answer differed per
	 * surface. A dialog has no anchor to be wrong about: `showModal()` puts it in
	 * the browser's top layer, which no ancestor's overflow, stacking context,
	 * transform or filter can reach into.
	 *
	 * Kept as a MEDIA QUERY rather than always-modal because on a desktop the
	 * point of this control is judging a palette against the app behind it, and a
	 * dimmed backdrop over the thing you are judging defeats it.
	 */
	const PHONE = '(max-width: 720px)';
	let phone = $state(false);
	let sheet: HTMLDialogElement | undefined = $state();

	onMount(() => {
		palette.sync();
		const mq = window.matchMedia(PHONE);
		phone = mq.matches;
		const onChange = (event: MediaQueryListEvent) => {
			phone = event.matches;
			// Rotating the phone with it open would otherwise leave a modal dialog
			// standing while the anchored menu renders too.
			close();
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	function toggle() {
		if (open) close();
		else openIt();
	}

	function openIt() {
		open = true;
		// The dialog is only in the DOM once `open` is true, so it cannot be shown
		// until Svelte has rendered it.
		if (phone) tick().then(() => sheet?.showModal());
	}

	function close() {
		open = false;
		sheet?.close();
	}

	function choose(next: (typeof PALETTES)[number]) {
		palette.set(next);
		close();
	}

	/**
	 * Escape closes, matching every other menu in the app.
	 *
	 * The dialog handles its own Escape natively — and fires `cancel`/`close`
	 * rather than bubbling a keydown — so this is only ever the anchored menu's.
	 */
	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && !phone) close();
	}
</script>

<svelte:window {onkeydown} />

{#snippet options()}
	{#each PALETTES as p (p)}
		<button
			type="button"
			class="opt"
			class:on={palette.current === p}
			role="menuitemradio"
			aria-checked={palette.current === p}
			onclick={() => choose(p)}
		>
			<!-- Both accents, because the second one is half of what tells these
			     apart — Voltage and Abyss read alike at one swatch. -->
			<span class="swatch" aria-hidden="true">
				<i style="background: {PALETTE_SWATCHES[p][0]}"></i>
				<i style="background: {PALETTE_SWATCHES[p][1]}"></i>
			</span>
			<span class="text">
				<span class="name">{PALETTE_LABELS[p]}</span>
				<span class="blurb">{PALETTE_BLURBS[p]}</span>
			</span>
			{#if palette.current === p}<span class="tick" aria-hidden="true">✓</span>{/if}
		</button>
	{/each}
{/snippet}

<div class="wrap">
	<button
		type="button"
		class="trigger"
		aria-haspopup={phone ? 'dialog' : 'menu'}
		aria-expanded={open}
		title="Theme: {PALETTE_LABELS[palette.current]}"
		onclick={toggle}
	>
		<span class="swatch" aria-hidden="true">
			<i style="background: {PALETTE_SWATCHES[palette.current][0]}"></i>
			<i style="background: {PALETTE_SWATCHES[palette.current][1]}"></i>
		</span>
		<span class="current">{PALETTE_LABELS[palette.current]}</span>
		<span class="caret" aria-hidden="true">▾</span>
	</button>

	{#if open && !phone}
		<button type="button" class="scrim" aria-label="Close theme menu" onclick={close}></button>
		<div class="menu" role="menu" aria-label="Theme">
			<p class="menu-head">Theme · evaluation</p>
			{@render options()}
		</div>
	{/if}
</div>

{#if open && phone}
	<!-- The phone's version: a sheet in the browser's top layer, so no ancestor's
	     overflow or stacking can clip it and there is no anchor to be wrong about.
	     `close` on the dialog itself catches Escape and the backdrop press, which
	     both bypass every handler of ours. -->
	<!-- `onclick` on the dialog is the backdrop press: a modal dialog's ::backdrop
	     is not an element, so a press on it lands on the dialog itself, and
	     anything inside stops at its own handler. Dialogs close on Escape for free
	     but not on a tap outside, and a sheet you can only dismiss by finding the
	     ✕ is a sheet people close by picking a theme they did not want. -->
	<dialog
		bind:this={sheet}
		class="sheet"
		aria-label="Theme"
		onclose={() => (open = false)}
		onclick={(event) => {
			if (event.target === sheet) close();
		}}
	>
		<div class="sheet-head">
			<h2 class="sheet-title">Theme</h2>
			<button type="button" class="sheet-x" aria-label="Close" onclick={close}>✕</button>
		</div>
		<p class="sheet-note">Pick one to try it. Every screen changes as you choose.</p>
		<div class="sheet-list" role="menu" aria-label="Theme">{@render options()}</div>
	</dialog>
{/if}

<style>
	.wrap {
		position: relative;
		flex: none;
	}
	/* Pill-shaped and form-control sized, because that is what it stands beside:
	   the light/dark button on both settings surfaces. In the bar it is one chip
	   among several, which the same shape suits. */
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--bar-edge, var(--line-strong));
		border-radius: 999px;
		background: var(--bar-wash, var(--surface-sunken));
		color: var(--bar-fg, var(--fg));
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.trigger:hover {
		border-color: var(--brand);
		box-shadow: 0 0 0 1px var(--brand-glow);
	}
	.trigger:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.caret {
		font-size: 0.6rem;
		opacity: 0.7;
	}

	/* Two accents, split diagonally — a single dot cannot tell Voltage from
	   Abyss, and the pairing IS the theme's signature. */
	.swatch {
		display: inline-flex;
		flex: none;
		width: 18px;
		height: 12px;
		border-radius: 2px;
		overflow: hidden;
		border: 1px solid rgba(128, 128, 128, 0.4);
	}
	.swatch i {
		flex: 1;
		display: block;
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		border: none;
		background: transparent;
		cursor: default;
	}
	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		z-index: 100;
		box-sizing: border-box;
		width: 17rem;
		max-width: calc(100vw - 2rem);
		/* The list outgrew the viewport once the second round of candidates landed:
		   thirteen rows is taller than a laptop's remaining screen below the bar,
		   so the menu scrolls rather than running off the bottom. */
		max-height: min(30rem, calc(100vh - 6rem));
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.35rem;
		display: grid;
		gap: 1px;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-card);
		box-shadow:
			0 0 0 1px var(--brand-glow),
			0 16px 40px rgba(0, 0, 0, 0.4);
	}
	.menu-head {
		/* Sticky so the heading survives the scroll the list now needs. */
		position: sticky;
		top: -0.35rem;
		background: var(--surface);
		margin: 0;
		padding: 0.4rem 0.55rem 0.5rem;
		border-bottom: 1px solid var(--line);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--fg-muted);
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		box-sizing: border-box;
		padding: 0.45rem 0.55rem;
		border: none;
		border-radius: var(--radius-control);
		background: none;
		color: var(--fg);
		font-family: inherit;
		text-align: left;
		cursor: pointer;
	}
	.opt:hover {
		background: var(--surface-sunken);
	}
	.opt.on {
		background: color-mix(in srgb, var(--brand) 16%, var(--surface));
	}
	.opt:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
	.text {
		flex: 1;
		min-width: 0;
		display: grid;
	}
	.name {
		font-size: 0.82rem;
		font-weight: 700;
	}
	.blurb {
		font-size: 0.68rem;
		color: var(--fg-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tick {
		flex: none;
		color: var(--brand);
		font-weight: 800;
	}

	/* ------------------------------------------------------------- Sheet
	   The phone's presentation. A dialog rather than a positioned panel because
	   `showModal()` renders in the browser's top layer: nothing an ancestor does —
	   overflow, stacking context, transform, filter — can clip or cover it, which
	   is exactly what was happening when the same menu was launched from a nav bar
	   on one screen and from the middle of a settings card on another.

	   Anchored to the BOTTOM. The control that opens it is at the top of the
	   screen, but the hand that opened it is at the bottom, and thirteen options
	   is a list you scroll rather than glance at. */
	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		width: 100%;
		max-width: 100%;
		max-height: 82dvh;
		box-sizing: border-box;
		margin: 0;
		padding: 0.6rem 0.6rem calc(0.6rem + env(safe-area-inset-bottom, 0px));
		display: grid;
		gap: 0.35rem;
		align-content: start;
		overflow-y: auto;
		overscroll-behavior: contain;
		border: none;
		border-top: 1px solid var(--line-strong);
		border-radius: var(--radius-card) var(--radius-card) 0 0;
		background: var(--surface);
		color: var(--fg);
		box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.35);
	}
	.sheet-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.15rem 0.15rem 0;
	}
	.sheet-title {
		margin: 0;
		font-size: 1rem;
		/* Opts out of the app-wide h1/h2 slab the way every other in-page heading
		   does — an accent block on a sheet title fights the swatches below it. */
		background: none;
		border: none;
		box-shadow: none;
		padding: 0;
		color: var(--fg);
		text-transform: none;
	}
	.sheet-x {
		flex: none;
		width: 2.25rem;
		height: 2.25rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-round);
		background: var(--surface-sunken);
		color: var(--fg-muted);
		font-size: 1rem;
		cursor: pointer;
	}
	.sheet-x:hover {
		color: var(--fg);
		border-color: var(--fg-muted);
	}
	.sheet-note {
		margin: 0;
		padding: 0 0.15rem 0.25rem;
		font-size: 0.76rem;
		color: var(--fg-muted);
	}
	/* TWO UP. Thirteen palettes one-per-line is a list you scroll past rather than
	   compare, and comparing is the whole job — the swatches want to be near each
	   other. Two columns puts most of the set on screen at once and halves the
	   scroll. `minmax(0, …)` so a long name shrinks its cell instead of widening
	   the column and pushing the grid sideways. */
	.sheet-list {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.35rem;
	}
	/* Roomier than the desktop menu's rows: this is a thumb target, and the
	   swatch is the thing being judged, so it gets to be bigger too. */
	.sheet-list .opt {
		padding: 0.55rem 0.5rem;
		gap: 0.45rem;
	}
	/* Below about 360px a two-up cell is ~147px, and every blurb ellipsises — at
	   which point it is not a description, it is three words and a "…". The
	   swatch and the name still answer "which one is this", so the blurb is the
	   thing that goes rather than the second column. */
	@media (max-width: 22.5rem) {
		.sheet-list .blurb {
			display: none;
		}
	}
	.sheet-list .swatch {
		width: 30px;
		height: 20px;
	}
	.sheet-list .name {
		font-size: 0.92rem;
	}
	.sheet-list .blurb {
		font-size: 0.74rem;
	}
</style>
