<script lang="ts">
	/**
	 * A–Z jump rail with dock-style magnification, shared by the directory pages
	 * (customers, subcontractors). The pointed-at letter grows and its neighbours
	 * taper and spread so the target stays hittable; scrubbing (touch drag or a
	 * held mouse button) jumps live. Extracted from the customers page so both
	 * phone books ride one implementation.
	 */
	let {
		present,
		onjump,
		top = 84
	}: {
		/** Letters that have a section to jump to ('A'–'Z', '#' for everything else). */
		present: Set<string>;
		onjump: (letter: string) => void;
		/** Sticky offset in px, clearing the page's own sticky chrome. */
		top?: number;
	} = $props();

	const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
	let hover: number | null = $state(null);
	// The rail element, so touch/mouse position can be mapped to a letter index.
	let nav: HTMLElement | undefined = $state();

	// Map a pointer's Y onto a letter and magnify it. Child transforms don't
	// reflow, so the nav's own box stays stable — no feedback loop as letters
	// grow. `jump` is true while actively scrubbing (touch drag / mouse-down).
	function at(clientY: number, jump: boolean) {
		if (!nav) return;
		const r = nav.getBoundingClientRect();
		const frac = (clientY - r.top) / r.height;
		const i = Math.max(0, Math.min(ALPHABET.length - 1, Math.round(frac * (ALPHABET.length - 1))));
		hover = i;
		if (jump && present.has(ALPHABET[i])) onjump(ALPHABET[i]);
	}
	// Dock-style magnification: the hovered letter is largest, neighbours taper off.
	function scale(i: number): number {
		if (hover === null) return 1;
		const d = Math.abs(i - hover);
		if (d === 0) return 2;
		if (d === 1) return 1.6;
		if (d === 2) return 1.3;
		if (d === 3) return 1.12;
		return 1;
	}
	// Push neighbours away from the hovered letter so the enlarged glyphs don't
	// collide — the dock "spread" that makes the magnified letter easy to hit.
	function shift(i: number): number {
		if (hover === null) return 0;
		const d = Math.abs(i - hover);
		if (d === 0) return 0;
		const push = d === 1 ? 9 : d === 2 ? 15 : d === 3 ? 18 : 19;
		return Math.sign(i - hover) * push;
	}
</script>

<nav
	aria-label="Jump to letter"
	bind:this={nav}
	style="top: {top}px"
	onpointerdown={(e) => {
		nav?.setPointerCapture?.(e.pointerId);
		at(e.clientY, true);
	}}
	onpointermove={(e) => at(e.clientY, e.pointerType !== 'mouse' || e.buttons > 0)}
	onpointerup={() => (hover = null)}
	onpointercancel={() => (hover = null)}
	onpointerleave={() => (hover = null)}
>
	{#each ALPHABET as letter, i (letter)}
		<button
			type="button"
			tabindex="-1"
			aria-hidden="true"
			class:present={present.has(letter)}
			style="transform: translateY({shift(i)}px) scale({scale(i)});">{letter}</button
		>
	{/each}
</nav>

<style>
	nav {
		position: sticky;
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex-shrink: 0;
		padding: 0.25rem 0.35rem;
		/* The rail owns its touches: scrubbing must never scroll the page. */
		touch-action: none;
	}
	/* The letters are display only — the nav maps pointer position itself, so
	   pointer-events stays off and the buttons never trap a tap. */
	button {
		border: none;
		background: none;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		pointer-events: none;
		font-family: inherit;
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 1.05;
		color: #c9d1d9;
		transform-origin: center center;
		transition: transform 0.12s ease-out;
		will-change: transform;
	}
	button.present {
		color: #0969da;
	}
	:global(:root[data-theme='dark']) button {
		color: #3d4650;
	}
	:global(:root[data-theme='dark']) button.present {
		color: #58a6ff;
	}
</style>
