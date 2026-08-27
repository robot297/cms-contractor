<script lang="ts">
	/**
	 * Part-to-whole across a few named categories, as one stacked bar.
	 *
	 * A bar rather than a pie or a donut: the segments here are often close in
	 * size, and comparing two arcs of similar length is something people are
	 * measurably bad at. Horizontal because the category names are words.
	 *
	 * Nothing is labelled inside a segment. An interior segment has no free end to
	 * push an overflowing label to, and the smallest slice here can be a single
	 * job — so identity lives in the legend below, where it always fits, and the
	 * two are wired together by hover and focus so matching a segment to its name
	 * doesn't come down to colour-matching.
	 */
	type Slice = {
		label: string;
		count: number;
		/** Palette slot 1-5; 0 is the folded grey tail. */
		slot: number;
	};

	let {
		slices,
		title,
		subtitle,
		empty = 'Nothing to show yet.'
	}: {
		slices: Slice[];
		title: string;
		subtitle?: string;
		empty?: string;
	} = $props();

	const total = $derived(slices.reduce((sum, s) => sum + s.count, 0));

	/**
	 * The colour for a slot, by its FIXED position in the palette — never by the
	 * slice's current rank. Rank changes as jobs move; if colour followed it, a
	 * contractor who learned "decks are blue" would find them orange next week.
	 */
	const colorFor = (slot: number) => (slot === 0 ? 'var(--viz-other)' : `var(--viz-${slot})`);

	const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

	/** The slice the pointer or keyboard is on, tying the bar to the legend. */
	let active = $state(-1);
</script>

<figure class="viz">
	<figcaption>
		<span class="viz-title">{title}</span>
		{#if subtitle}<span class="viz-sub">{subtitle}</span>{/if}
	</figcaption>

	{#if slices.length === 0}
		<p class="viz-empty">{empty}</p>
	{:else}
		<!-- The gap between segments is the card's own surface showing through, not
		     a stroke around each one: a border would add ink that isn't data. -->
		<div class="bar" aria-hidden="true">
			{#each slices as s, i (s.label)}
				<!-- A button so the pointer has something real to hover, but out of the
				     tab order: the legend below already gives every slice a keyboard
				     stop, and a second set here would double the tab cost of the card
				     to reach the same names. -->
				<button
					type="button"
					class="seg"
					class:on={active === i}
					class:dim={active >= 0 && active !== i}
					tabindex="-1"
					aria-hidden="true"
					style="flex-grow: {s.count}; background: {colorFor(s.slot)}"
					onpointerenter={() => (active = i)}
					onpointerleave={() => (active = -1)}
				></button>
			{/each}
		</div>

		<ul class="legend">
			{#each slices as s, i (s.label)}
				<li>
					<button
						type="button"
						class="key"
						class:on={active === i}
						onpointerenter={() => (active = i)}
						onpointerleave={() => (active = -1)}
						onfocus={() => (active = i)}
						onblur={() => (active = -1)}
					>
						<!-- Rect, matching the mark it identifies. -->
						<span class="swatch" style="background: {colorFor(s.slot)}" aria-hidden="true"></span>
						<span class="key-label">{s.label}</span>
						<!-- Text stays in ink; the swatch beside it carries the identity. -->
						<span class="key-count">{s.count}<span class="key-pct">· {pct(s.count)}%</span></span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</figure>

<style>
	.viz {
		margin: 0;
		display: grid;
		gap: 0.7rem;
		min-width: 0;
	}
	figcaption {
		display: grid;
		gap: 0.1rem;
	}
	.viz-title {
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--viz-ink-muted);
	}
	.viz-sub {
		font-size: 0.8rem;
		color: var(--viz-ink-muted);
	}
	.viz-empty {
		margin: 0;
		font-size: 0.85rem;
		color: var(--viz-ink-muted);
	}

	.bar {
		display: flex;
		/* The one spacer. Same width between every pair, so neighbouring hues read
		   as distinct because of the air rather than because of an outline. */
		gap: 2px;
		height: 14px;
		border-radius: 999px;
		/* Rounds the outer ends of the first and last segments; the interior ones
		   stay square, which is what a stack should look like. */
		overflow: hidden;
	}
	.seg {
		min-width: 4px;
		/* A hit target, not a control: the fill is set inline per slice. */
		border: none;
		padding: 0;
		cursor: default;
		transition: opacity 0.12s ease;
	}
	/* Hovering one segment quiets the others rather than brightening it — the
	   highlighted slice keeps its true colour, so the picture stays honest. */
	.seg.dim {
		opacity: 0.35;
	}

	.legend {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.9rem;
	}
	.key {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.15rem 0.25rem;
		border: none;
		border-radius: 6px;
		background: none;
		font-family: inherit;
		font-size: 0.78rem;
		color: var(--viz-ink);
		cursor: default;
		text-align: left;
	}
	.key.on {
		background: var(--surface-sunken);
	}
	.key:focus-visible {
		outline: 2px solid var(--viz-ink);
		outline-offset: 1px;
	}
	.swatch {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 3px;
	}
	.key-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.key-count {
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.key-pct {
		margin-left: 0.3rem;
		font-weight: 600;
		color: var(--viz-ink-muted);
	}

	@media (prefers-reduced-motion: reduce) {
		.seg {
			transition: none;
		}
	}
</style>
