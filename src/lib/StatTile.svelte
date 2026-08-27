<script lang="ts">
	/**
	 * One headline number.
	 *
	 * The right form for a single current value — a one-bar bar chart says the
	 * same thing and spends a card doing it. Four of these across the top of the
	 * dashboard answer "how is the business doing" before any chart is read.
	 *
	 * A tile is a link when there is somewhere to go and a plain block when there
	 * isn't, rather than a link that lands on the page you are already on.
	 */
	let {
		label,
		value,
		/** Small line under the value: context, or a movement against a named period. */
		note,
		/** Direction of `note`, when it is a change. Drives its colour and arrow. */
		trend,
		/** Where the number came from, if it is somewhere the contractor can go. */
		href,
		/**
		 * A count that wants an answer, wearing the brand accent — the same rule
		 * the nav badge and the due list follow. Ignored when the value is zero:
		 * nothing waiting is not a state worth shouting about.
		 */
		urgent = false
	}: {
		label: string;
		value: string;
		note?: string;
		trend?: 'up' | 'down' | 'flat';
		href?: string;
		urgent?: boolean;
	} = $props();
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	{href}
	class="tile card"
	class:urgent
	class:linked={Boolean(href)}
	role={href ? undefined : 'group'}
	aria-label={href ? undefined : `${label}: ${value}`}
>
	<span class="label">{label}</span>
	<!-- Proportional figures, not tabular: at this size tabular-nums gives every
	     digit the width of a zero and a number like 121 reads loose. Columns of
	     numbers get tabular; a standalone headline doesn't. -->
	<span class="value">{value}</span>
	{#if note}
		<span class="note" class:up={trend === 'up'} class:down={trend === 'down'}>
			{#if trend === 'up'}<span aria-hidden="true">↑</span>{:else if trend === 'down'}<span
					aria-hidden="true">↓</span
				>{/if}{note}
		</span>
	{/if}
</svelte:element>

<style>
	.tile {
		/* Overrides the shared .card's roomier grid: a tile is three short lines. */
		display: grid;
		gap: 0.15rem;
		align-content: start;
		padding: 0.85rem 1rem;
		color: inherit;
		text-decoration: none;
		min-width: 0;
	}
	.linked {
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	.linked:hover {
		transform: translateY(-1px);
		box-shadow: var(--pop-shadow);
	}
	.linked:focus-visible {
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
	.label {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--fg-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.value {
		font-size: 1.65rem;
		font-weight: 800;
		line-height: 1.15;
		color: var(--fg);
	}
	.note {
		font-size: 0.74rem;
		color: var(--fg-muted);
	}
	/* Direction, not judgement: whether up is good depends on the measure, so the
	   colours here are the app's own ok/stop tones applied by the caller's choice
	   of `trend`, and a tile whose "up" is bad simply doesn't pass one. */
	.note.up {
		color: var(--ok-fg);
		font-weight: 700;
	}
	.note.down {
		color: var(--stop-fg);
		font-weight: 700;
	}
	/* The accent, not --danger: work waiting on you is the job, not a fault.
	   See docs/adr/0009-waiting-counts-use-the-accent-not-danger.md. */
	.tile.urgent {
		border-left: 4px solid var(--brand-deep);
	}
	.tile.urgent .value {
		color: var(--fg);
	}

	@media (prefers-reduced-motion: reduce) {
		.linked {
			transition: none;
		}
	}
</style>
