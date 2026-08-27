<script lang="ts">
	/**
	 * A single measure over time, as columns.
	 *
	 * Built from divs rather than an `<svg viewBox>` on purpose. A scaled viewBox
	 * stretches its own text and strokes with the container, which on a card that
	 * spans one column on a tablet and a third of a row on a desktop means the axis
	 * labels change size between breakpoints. Laid out in CSS the marks scale and
	 * the type doesn't, hover targets are real elements, and keyboard focus comes
	 * free.
	 *
	 * ONE series, so one colour: the height of a column already carries its
	 * magnitude, and shading them darker-where-taller would spend the only free
	 * channel restating it. The exception is a period that isn't finished yet,
	 * which gets a lighter step of the same hue — see `partial` below.
	 */
	type Point = {
		/** Axis label, e.g. "Mar". */
		label: string;
		value: number;
		/** Longer form used by the tooltip and the table, e.g. "March 2026". */
		full?: string;
		/**
		 * A period still in progress. Drawn lighter and called out, because it is
		 * not comparable to the finished periods beside it — without that, every
		 * dashboard looks like the business fell off a cliff on the 1st.
		 */
		partial?: boolean;
	};

	let {
		data,
		title,
		subtitle,
		/** Turns a raw value into money/units for ticks, labels and the tooltip. */
		format = (n: number) => String(n),
		/** Column header for the values in the accessible table. */
		valueLabel = 'Value'
	}: {
		data: Point[];
		title: string;
		subtitle?: string;
		format?: (n: number) => string;
		valueLabel?: string;
	} = $props();

	/**
	 * Round the top of the scale up to something a person would read off an axis.
	 *
	 * An axis topped at the exact maximum puts the tallest column flush against the
	 * ceiling and gives its tick an unreadable number like 4,317. Snapping to 1/2/5
	 * × a power of ten leaves the tallest bar visible air above it and makes the
	 * two intermediate ticks land on round numbers too.
	 */
	function niceCeil(n: number): number {
		if (n <= 0) return 1;
		const magnitude = 10 ** Math.floor(Math.log10(n));
		const normalized = n / magnitude;
		const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
		return step * magnitude;
	}

	const max = $derived(niceCeil(Math.max(0, ...data.map((d) => d.value))));
	/** Bottom, middle, top. Three lines is a scale; five is a cage. */
	const ticks = $derived([max, max / 2, 0]);
	/** The one column worth a direct label. Everything else is on the axis. */
	const peakIndex = $derived(
		data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -Infinity) ? i : best), 0)
	);
	const allZero = $derived(data.every((d) => d.value === 0));

	/** Which column the pointer or keyboard is on; -1 for none. */
	let active = $state(-1);
</script>

<figure class="viz">
	<figcaption>
		<span class="viz-title">{title}</span>
		{#if subtitle}<span class="viz-sub">{subtitle}</span>{/if}
	</figcaption>

	<div class="plot">
		<!-- Gridlines and their ticks are one element per line, so a tick can never
		     drift away from the rule it labels. -->
		<div class="grid" aria-hidden="true">
			{#each ticks as t (t)}
				<div class="gridline"><span class="tick">{format(t)}</span></div>
			{/each}
		</div>

		<ol class="cols">
			{#each data as d, i (d.label)}
				{@const height = max > 0 ? (d.value / max) * 100 : 0}
				<li class="col">
					<!-- The whole slot is the hit target, not just the painted bar: a
					     near-empty month is a few pixels tall and would otherwise be
					     unhoverable exactly when you most want to ask what happened. -->
					<button
						type="button"
						class="slot"
						class:on={active === i}
						aria-label="{d.full ?? d.label}: {format(d.value)}{d.partial ? ', month to date' : ''}"
						onpointerenter={() => (active = i)}
						onpointerleave={() => (active = -1)}
						onfocus={() => (active = i)}
						onblur={() => (active = -1)}
					>
						{#if i === peakIndex && !allZero}
							<span class="cap">{format(d.value)}</span>
						{/if}
						<span class="bar" class:partial={d.partial} style="height: {height}%" aria-hidden="true"
						></span>
					</button>
					<span class="xlabel" class:partial={d.partial}>{d.label}</span>
				</li>
			{/each}
		</ol>

		{#if active >= 0}
			{@const d = data[active]}
			<!-- Positioned on the column's centre, and pinned inside the plot at the
			     ends so the first and last never hang off the card. -->
			<div
				class="tip"
				style="--pos: {(active + 0.5) / data.length}"
				class:flip-left={active >= data.length - 1 && data.length > 2}
				class:flip-right={active === 0 && data.length > 2}
				aria-hidden="true"
			>
				<span class="tip-value">{format(d.value)}</span>
				<span class="tip-label">{d.full ?? d.label}{d.partial ? ' · so far' : ''}</span>
			</div>
		{/if}
	</div>

	<!-- The same numbers without the picture. Several of the palette's light-mode
	     steps sit under 3:1 on a white card, and the rule for that is that no value
	     may depend on seeing the colour. -->
	<table class="viz-table">
		<caption>{title}</caption>
		<thead><tr><th scope="col">Period</th><th scope="col">{valueLabel}</th></tr></thead>
		<tbody>
			{#each data as d (d.label)}
				<tr>
					<th scope="row">{d.full ?? d.label}{d.partial ? ' (so far)' : ''}</th>
					<td>{format(d.value)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	.viz {
		margin: 0;
		display: grid;
		gap: 0.85rem;
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

	.plot {
		position: relative;
		/* Sized to hold the plot AND the x-axis band. A fixed height that only fits
		   the plot is how a chart card ends up with its own tiny scrollbar. */
		height: 11rem;
		/* Room on the left for the tick labels, which sit outside the plot area, and
		   the height of the x-axis band under it. Both are named because three
		   separate rules — the gridlines, the columns and the tooltip — have to
		   agree on them, and a copy that drifted put the tooltip a column and a half
		   away from the bar it was describing. */
		--gutter: 2.8rem;
		--xband: 1.4rem;
		padding-left: var(--gutter);
		box-sizing: border-box;
	}

	/* ------------------------------------------------------------- Gridlines */
	.grid {
		position: absolute;
		inset: 0 0 var(--xband) var(--gutter);
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		pointer-events: none;
	}
	.gridline {
		position: relative;
		/* Solid hairline, never dashed: a dashed rule reads as a threshold or a
		   projection, and this is just a grid. */
		border-top: 1px solid var(--viz-grid);
	}
	/* The baseline is the axis proper, so it reads one step stronger. */
	.gridline:last-child {
		border-top-color: var(--viz-axis);
	}
	.tick {
		position: absolute;
		right: calc(100% + 0.5rem);
		top: -0.55em;
		font-size: 0.68rem;
		color: var(--viz-ink-muted);
		/* Ticks are a column of numbers that has to line up vertically. */
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	/* ----------------------------------------------------------------- Marks */
	.cols {
		position: absolute;
		inset: 0 0 0 var(--gutter);
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		align-items: stretch;
	}
	.col {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.slot {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: center;
		/* The slot is a hit target, not a surface: no fill, no frame. */
		border: none;
		background: none;
		padding: 0;
		cursor: default;
		font-family: inherit;
	}
	.bar {
		width: 100%;
		/* Capped rather than filling the slot — the leftover band is the air that
		   keeps a bar chart from reading as a stack of blocks. */
		max-width: 24px;
		background: var(--viz-accent);
		/* Rounded at the data end, square where it meets the baseline. */
		border-radius: 4px 4px 0 0;
		/* A zero-height bar still shows a hairline of itself, so an empty month
		   reads as "nothing here" rather than as missing data. */
		min-height: 2px;
		transition:
			background 0.12s ease,
			opacity 0.12s ease;
	}
	/* The month still being earned. Same hue, stepped back — a different hue would
	   claim it is a different KIND of revenue. */
	.bar.partial {
		background: var(--viz-accent-soft);
	}
	.slot.on .bar {
		opacity: 0.82;
	}
	.slot:focus-visible {
		outline: 2px solid var(--viz-ink);
		outline-offset: 2px;
		border-radius: 6px;
	}
	/* The one direct label: the tallest column. A number on every bar is chaos and
	   goes unread — the axis and the tooltip carry the rest. */
	.cap {
		font-size: 0.68rem;
		font-weight: 800;
		/* Text never wears the series colour; the bar underneath carries identity. */
		color: var(--viz-ink);
		margin-bottom: 0.2rem;
		white-space: nowrap;
	}
	.xlabel {
		flex: none;
		height: var(--xband);
		display: grid;
		place-items: center;
		font-size: 0.68rem;
		color: var(--viz-ink-muted);
	}
	.xlabel.partial {
		font-weight: 800;
		color: var(--viz-ink);
	}

	/* --------------------------------------------------------------- Tooltip */
	.tip {
		position: absolute;
		bottom: 1.8rem;
		/* `--pos` is the column's centre as a fraction of the PLOTTED width, so the
		   axis gutter has to be added back: an absolutely positioned child measures
		   its percentages from the padding box, gutter included, which put every
		   tooltip left of the bar it belonged to. */
		left: calc(var(--gutter) + var(--pos) * (100% - var(--gutter)));
		transform: translateX(-50%);
		display: grid;
		gap: 0.05rem;
		padding: 0.35rem 0.55rem;
		border-radius: 8px;
		border: 1px solid var(--line-strong);
		background: var(--surface);
		box-shadow: var(--pop-shadow-sm);
		pointer-events: none;
		white-space: nowrap;
		z-index: 2;
	}
	/* At the ends the tooltip anchors to its own edge instead of its centre. */
	.tip.flip-left {
		transform: translateX(-100%);
	}
	.tip.flip-right {
		transform: translateX(0);
	}
	/* The reader already knows which column they are on and wants the number, so
	   the value leads and the label follows — the legend's hierarchy inverted. */
	.tip-value {
		font-size: 0.85rem;
		font-weight: 800;
		color: var(--viz-ink);
	}
	.tip-label {
		font-size: 0.7rem;
		color: var(--viz-ink-muted);
	}

	@media (prefers-reduced-motion: reduce) {
		.bar {
			transition: none;
		}
	}
</style>
