<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { LimitedRecord, LimitStatusEntry } from '$lib/crm';

	/**
	 * The welcome a contractor gets on their dashboard while the trial runs.
	 *
	 * One compact line until asked, and dismissable for good once they've read it —
	 * the running countdown lives in the nav badge, which is always there, so this
	 * card doesn't need to repeat it or outstay its welcome.
	 */
	let {
		limits
	}: {
		limits: Record<LimitedRecord, LimitStatusEntry> | null;
	} = $props();

	let open = $state(false);

	const rows = $derived(
		limits
			? [
					{ label: 'customers', entry: limits.customer },
					{ label: 'orders', entry: limits.order },
					{ label: 'subcontractors', entry: limits.subcontractor }
				]
			: []
	);
	const anyAtLimit = $derived(rows.some((r) => r.entry.atLimit));
</script>

<section class="trial-notice">
	<div class="row">
		<span class="spark" aria-hidden="true">🎉</span>
		<p class="headline">Welcome to your free trial</p>
		<button type="button" class="toggle" aria-expanded={open} onclick={() => (open = !open)}>
			{open ? 'Hide details' : "What's included"}
		</button>
		<form method="POST" action="?/dismissTrialNotice" use:enhance>
			<button type="submit" class="dismiss">Dismiss</button>
		</form>
	</div>

	{#if open}
		<div class="details">
			<p class="cap-intro">Every feature. Capped only by:</p>
			<ul class="caps">
				{#each rows as row (row.label)}
					<li class:at={row.entry.atLimit}>
						<strong>{row.entry.used} / {row.entry.limit}</strong>
						{row.label}
					</li>
				{/each}
			</ul>
			<p class="fine">
				{anyAtLimit ? 'Archive something to free a space.' : 'Archiving frees a space.'} Nothing is lost
				when the trial ends — only changes pause.
				<a class="link" href={resolve('/contractor/billing')}>See plans →</a>
			</p>
		</div>
	{/if}
</section>

<style>
	.trial-notice {
		border: 2px solid var(--yellow-deep);
		border-radius: 12px;
		background: color-mix(in srgb, var(--yellow) 14%, var(--surface));
		padding: 0.7rem 0.9rem;
		color: var(--fg);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.spark {
		font-size: 1.05rem;
		line-height: 1;
	}
	.headline {
		margin: 0;
		font-weight: 800;
		font-size: 0.95rem;
		letter-spacing: -0.01em;
	}
	.toggle {
		margin-left: auto;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg);
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.toggle:hover {
		border-color: var(--fg-muted);
	}
	.toggle:focus-visible,
	.dismiss:focus-visible {
		outline: 2px solid var(--yellow-deep);
		outline-offset: 2px;
	}
	/* A worded button, not a bare ×: dismissing this hides it permanently, and an
	   unlabelled glyph gives no clue that the choice sticks. */
	.dismiss {
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1.5px solid transparent;
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.dismiss:hover {
		color: var(--fg);
		border-color: var(--line-strong);
	}

	.details {
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid color-mix(in srgb, var(--yellow-deep) 45%, transparent);
		display: grid;
		gap: 0.45rem;
	}
	.cap-intro,
	.fine {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.cap-intro {
		font-weight: 700;
		color: var(--fg);
	}

	.caps {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.caps li {
		flex: 1 1 7rem;
		padding: 0.5rem 0.6rem;
		border-radius: 9px;
		background: var(--surface);
		border: 1px solid var(--line);
		font-size: 0.75rem;
		color: var(--fg-muted);
		text-align: center;
		line-height: 1.3;
	}
	.caps li.at {
		border-color: var(--danger);
	}
	.caps strong {
		display: block;
		font-size: 1.05rem;
		font-weight: 800;
		color: var(--fg);
		font-variant-numeric: tabular-nums;
	}
	.caps li.at strong {
		color: var(--danger);
	}

	.link {
		white-space: nowrap;
		font-weight: 700;
		color: var(--fg);
		text-decoration-color: var(--yellow-deep);
		text-decoration-thickness: 2px;
		text-underline-offset: 2px;
	}
</style>
