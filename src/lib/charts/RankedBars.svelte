<script lang="ts">
	/**
	 * Magnitude across a handful of named categories, biggest first.
	 *
	 * Horizontal rather than vertical because the categories here are phrases
	 * ("Final Payment Pending"), and a column chart would either rotate those
	 * labels to 45° or truncate them. A row gives every name a full line.
	 *
	 * There is no tooltip, and that is deliberate rather than an omission: every
	 * row already carries its name and its value as text, so a hover readout would
	 * do nothing but repeat what is on screen. The rows still respond to the
	 * pointer, so the chart doesn't feel dead.
	 */
	type Row = {
		label: string;
		value: number;
		/** Optional short note shown after the value, e.g. "2 overdue". */
		note?: string;
	};

	let {
		rows,
		title,
		subtitle,
		empty = 'Nothing to show yet.'
	}: {
		rows: Row[];
		title: string;
		subtitle?: string;
		empty?: string;
	} = $props();

	/**
	 * Bars are scaled against the largest row, not against the total.
	 *
	 * Against the total, a healthy spread of eight states would render as eight
	 * near-invisible slivers — the question this chart answers is "which stage is
	 * the work piling up in", which is a comparison between the rows.
	 */
	const max = $derived(Math.max(1, ...rows.map((r) => r.value)));
</script>

<figure class="viz">
	<figcaption>
		<span class="viz-title">{title}</span>
		{#if subtitle}<span class="viz-sub">{subtitle}</span>{/if}
	</figcaption>

	{#if rows.length === 0}
		<p class="viz-empty">{empty}</p>
	{:else}
		<ol class="rows">
			{#each rows as r (r.label)}
				<li class="row">
					<span class="rlabel" title={r.label}>{r.label}</span>
					<span class="track">
						<span class="bar" style="width: {(r.value / max) * 100}%" aria-hidden="true"></span>
					</span>
					<!-- Outside the bar, always. A value set inside a mark has to be
					     measured against it first, and the shortest row here is one job. -->
					<span class="rvalue">
						{r.value}{#if r.note}<span class="rnote">{r.note}</span>{/if}
					</span>
				</li>
			{/each}
		</ol>
	{/if}
</figure>

<style>
	.viz {
		margin: 0;
		display: grid;
		gap: 0.75rem;
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

	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.45rem;
	}
	.row {
		display: grid;
		/* Name · bar · value. The name column is capped so a long state can't
		   squeeze the bars into nothing, and the value column sizes to its digits. */
		grid-template-columns: minmax(5.5rem, 9rem) 1fr auto;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}
	.rlabel {
		font-size: 0.8rem;
		color: var(--viz-ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The unfilled remainder, a step off the surface so the full width of the
	   scale is visible even where a bar is short. */
	.track {
		position: relative;
		height: 12px;
		border-radius: 999px;
		background: var(--surface-sunken);
		overflow: hidden;
		min-width: 0;
	}
	.bar {
		display: block;
		height: 100%;
		background: var(--viz-accent);
		/* Rounded at the data end, square at the baseline it grows from. */
		border-radius: 0 4px 4px 0;
		/* A single job still paints something rounded rather than a sliver. */
		min-width: 6px;
		transition: opacity 0.12s ease;
	}
	.row:hover .bar {
		opacity: 0.82;
	}
	.rvalue {
		font-size: 0.82rem;
		font-weight: 800;
		color: var(--viz-ink);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.rnote {
		margin-left: 0.35rem;
		font-weight: 600;
		font-size: 0.72rem;
		color: var(--viz-ink-muted);
	}

	@media (prefers-reduced-motion: reduce) {
		.bar {
			transition: none;
		}
	}
</style>
