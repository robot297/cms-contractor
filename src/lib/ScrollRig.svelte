<script lang="ts">
	/**
	 * The landing page's scroll-driven backdrop: a hammer driving a nail into a
	 * beam, one blow per band of the page.
	 *
	 * Purely decorative — `aria-hidden`, `pointer-events: none`, and absent
	 * entirely under `prefers-reduced-motion` and on narrow screens.
	 *
	 * ## Why a custom property and not `animation-timeline: scroll()`
	 *
	 * CSS scroll-driven animations advance off the main thread from the browser's
	 * REAL scroll position, while Lenis eases scroll on the main thread. The two
	 * disagree by a frame or more, which for a backdrop meant to feel welded to
	 * the page is exactly the wrong failure. Driving it from `lenis.on('scroll')`
	 * makes the rig share the easing by construction. (It also sidesteps
	 * scroll-timeline still being behind a flag in stable Firefox.)
	 *
	 * ## Why four properties rather than one
	 *
	 * Page progress alone is monotonic, and a hammer that creeps down once over
	 * the whole page is not a hammer. The strike is a sawtooth — `swing` resets
	 * each band — while `depth` accumulates, so the nail only ever goes further
	 * in. CSS has no `fract()`, so the derivation happens here and the stylesheet
	 * stays a set of transforms keyed off numbers.
	 */

	let {
		/** How many blows across the whole page. */
		blows = 4
	}: { blows?: number } = $props();

	let host = $state<HTMLElement | null>(null);

	/**
	 * Set the rig's four numbers from overall page progress (0–1).
	 *
	 * Exported so the page's existing Lenis loop can drive it — this component
	 * deliberately does not start a second RAF loop or a second scroll listener.
	 */
	export function update(progress: number): void {
		if (!host) return;
		const p = Math.min(1, Math.max(0, progress));

		// Where we are within the current blow, 0 → 1.
		const swing = (p * blows) % 1;

		// The strike itself. The hammer spends most of a band lifting and a short
		// snap coming down, which is what makes it read as a blow rather than a
		// pendulum: ease out over the first 70%, then fall fast.
		const lift = swing < 0.7 ? swing / 0.7 : 1 - (swing - 0.7) / 0.3;
		const angle = -8 + easeOutCubic(lift) * 62;

		// Impact: a brief spike as the head lands, decaying over the next fifth of
		// the band. Zero everywhere else, so nothing is painted between blows.
		const sinceHit = swing < 0.7 ? 1 : (swing - 0.7) / 0.3;
		const hit = swing < 0.7 ? 0 : Math.max(0, 1 - Math.abs(sinceHit - 0.55) * 4);

		// The nail only ever sinks. Stepped per completed blow plus the fraction of
		// the current one that has already landed, so it moves WITH the strike
		// rather than drifting between them.
		const landed = Math.floor(p * blows) + (swing < 0.7 ? 0 : (swing - 0.7) / 0.3);
		const depth = Math.min(1, landed / blows);

		const s = host.style;
		s.setProperty('--angle', `${angle.toFixed(2)}deg`);
		s.setProperty('--hit', hit.toFixed(3));
		s.setProperty('--depth', depth.toFixed(3));
		s.setProperty('--p', p.toFixed(4));
	}

	function easeOutCubic(t: number): number {
		return 1 - Math.pow(1 - t, 3);
	}
</script>

<div class="rig" bind:this={host} aria-hidden="true">
	<svg viewBox="0 0 320 420" fill="none" xmlns="http://www.w3.org/2000/svg">
		<!-- The beam. Drawn first so everything else lands on top of it. -->
		<g class="beam">
			<rect x="20" y="300" width="280" height="64" rx="6" />
			<!-- Grain. Three strokes is enough to read as timber and cheap to paint. -->
			<path d="M40 318 H286 M34 334 H272 M46 350 H290" class="grain" />
		</g>

		<!-- The nail. Sinks with --depth; the head stays proud until the last blow. -->
		<g class="nail">
			<rect x="154" y="252" width="12" height="58" rx="2" />
			<rect x="142" y="246" width="36" height="10" rx="3" class="nail-head" />
		</g>

		<!-- Impact. Two rings and a spark burst, all scaled by --hit, so between
		     blows they are not merely invisible but zero-sized. -->
		<g class="impact">
			<circle cx="160" cy="252" r="26" class="ring" />
			<circle cx="160" cy="252" r="42" class="ring ring-2" />
			<path
				class="sparks"
				d="M160 252 L136 228 M160 252 L184 228 M160 252 L124 250 M160 252 L196 250"
			/>
		</g>

		<!-- The hammer, rotating about the end of its handle. -->
		<g class="hammer">
			<rect x="150" y="120" width="14" height="118" rx="7" class="handle" />
			<path
				class="head"
				d="M112 92 h96 a6 6 0 0 1 6 6 v34 a6 6 0 0 1 -6 6 h-30 q-12 10 -24 0 h-42 a6 6 0 0 1 -6 -6 v-34 a6 6 0 0 1 6 -6 Z"
			/>
			<!-- Claw, so the silhouette is a claw hammer rather than a mallet. -->
			<path class="claw" d="M112 98 q-26 6 -30 22 q16 -8 30 -4 Z" />
		</g>
	</svg>
</div>

<style>
	.rig {
		/* Fixed, so the rig stays put while the page travels past it — the motion
		   should come from the animation, not from the element scrolling away. */
		position: fixed;
		right: clamp(1rem, 6vw, 6rem);
		top: 50%;
		translate: 0 -50%;
		z-index: 0;
		width: clamp(15rem, 24vw, 24rem);
		pointer-events: none;
		/* Faint. It is scenery behind a sales page; anything louder competes with
		   the words it is meant to sit behind. */
		opacity: 0.16;
		/* Seeded so the rig is drawn correctly on first paint, before a single
		   scroll event has arrived. */
		--angle: -8deg;
		--hit: 0;
		--depth: 0;
		--p: 0;
	}
	/* Below this the page is one column of text and there is no room beside it. */
	@media (max-width: 900px) {
		.rig {
			display: none;
		}
	}
	/* Belt and braces. The page already declines to start Lenis under reduced
	   motion, so the rig would sit frozen at its seed values — but a frozen
	   hammer mid-swing is still a strange thing to leave on screen. */
	@media (prefers-reduced-motion: reduce) {
		.rig {
			display: none;
		}
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}

	.beam rect {
		fill: var(--fg);
		opacity: 0.5;
	}
	.grain {
		stroke: var(--surface);
		stroke-width: 3;
		stroke-linecap: round;
		opacity: 0.35;
	}

	.nail rect {
		fill: var(--fg);
	}
	.nail {
		/* Sinks by the height of the shank, never further — the head seats flush
		   with the beam at --depth: 1 rather than disappearing into it. */
		translate: 0 calc(var(--depth) * 46px);
	}
	.nail-head {
		fill: var(--brand);
	}

	.hammer {
		/* Rotates about the butt of the handle, which is where a hand would be. */
		transform-box: fill-box;
		transform-origin: 50% 100%;
		rotate: var(--angle);
	}
	.handle {
		fill: var(--fg);
		opacity: 0.75;
	}
	.head,
	.claw {
		fill: var(--fg);
	}

	.impact {
		transform-box: fill-box;
		transform-origin: center;
		opacity: var(--hit);
	}
	.ring {
		fill: none;
		stroke: var(--brand);
		stroke-width: 3;
		/* Grows out of the strike point as it fades. */
		transform-box: fill-box;
		transform-origin: center;
		scale: calc(0.4 + var(--hit) * 0.8);
	}
	.ring-2 {
		stroke-width: 2;
		opacity: 0.5;
	}
	.sparks {
		stroke: var(--brand);
		stroke-width: 3;
		stroke-linecap: round;
		transform-box: fill-box;
		transform-origin: center;
		scale: calc(0.5 + var(--hit) * 0.7);
	}
</style>
