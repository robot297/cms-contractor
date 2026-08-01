<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { Guide, GuideStep } from '$lib/server/guide.server';

	let { guide, onclose }: { guide: Guide; onclose?: () => void } = $props();

	const steps = $derived(
		guide.state === 'extended' ? [...guide.core, ...guide.extended] : guide.core
	);
	const doneCount = $derived(steps.filter((s) => s.done).length);
	const pct = $derived(steps.length ? Math.round((doneCount / steps.length) * 100) : 0);

	/**
	 * The one step the contractor is actually on: the first that isn't done. Only
	 * this step shows its description and action — five equally-weighted links gave
	 * no sense of what to do next, which is the entire job of a getting-started card.
	 * Steps blocked by an earlier one can't be "current"; the blocker is.
	 */
	const currentId = $derived(steps.find((s) => !s.done && !s.blockedBy)?.id ?? null);

	function stepHref(step: GuideStep) {
		return resolve(step.href as '/contractor/customers');
	}
</script>

<section class="guide">
	<header>
		<span class="title">Getting started</span>
		<span class="count">{doneCount} of {steps.length}</span>
		<form method="POST" action="?/guideDismiss" use:enhance={() => () => onclose?.()}>
			<button type="submit" class="close" aria-label="Hide getting started" title="Hide">×</button>
		</form>
	</header>

	<div
		class="progress"
		role="progressbar"
		aria-valuenow={doneCount}
		aria-valuemin={0}
		aria-valuemax={steps.length}
		aria-label="Getting started progress"
	>
		<span class="progress-fill" style="width: {pct}%"></span>
	</div>

	<ol>
		{#each steps as step, i (step.id)}
			{@const current = step.id === currentId}
			<li class:done={step.done} class:current class:blocked={!step.done && !!step.blockedBy}>
				<span class="marker" aria-hidden="true">{step.done ? '✓' : i + 1}</span>

				<div class="body">
					<span class="label">{step.title}</span>

					{#if current}
						<p class="desc">{step.description}</p>
						<div class="action">
							{#if step.href && step.cta}
								<a class="go" href={stepHref(step)}>{step.cta} →</a>
							{:else if step.id === 'followUp'}
								<!-- Teaches rather than asks: every order is born with a follow-up,
								     so this step is completed by acknowledgement. -->
								<form method="POST" action="?/guideAckFollowUp" use:enhance>
									<button type="submit" class="go">Got it</button>
								</form>
							{/if}
						</div>
					{:else if !step.done && step.blockedBy}
						<span class="note">{step.blockedBy}</span>
					{/if}
				</div>
			</li>
		{/each}
	</ol>

	{#if guide.atFork}
		<footer>
			<form method="POST" action="?/guideContinue" use:enhance>
				<button type="submit" class="more">There’s more to set up →</button>
			</form>
		</footer>
	{/if}
</section>

<style>
	.guide {
		display: grid;
		gap: 0.6rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--surface-sunken);
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.title {
		font-size: 0.75rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}
	.count {
		margin-right: auto;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--fg-muted);
		opacity: 0.8;
		font-variant-numeric: tabular-nums;
	}
	.close {
		border: none;
		background: none;
		padding: 0 0.2rem;
		font-size: 1.1rem;
		line-height: 1;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.close:hover {
		color: var(--fg);
	}

	.progress {
		height: 4px;
		border-radius: 999px;
		background: var(--line);
		overflow: hidden;
	}
	.progress-fill {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, var(--yellow), var(--yellow-deep));
		transition: width 0.35s cubic-bezier(0.22, 1, 0.36, 1);
	}

	ol {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.15rem;
	}
	li {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.35rem 0.4rem;
		border-radius: 9px;
		font-size: 0.85rem;
	}
	/* Only the step you're on gets weight — everything else stays a quiet line. */
	li.current {
		background: var(--surface);
		border: 1px solid var(--line);
		padding: 0.6rem;
	}

	.marker {
		flex: none;
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 0.7rem;
		font-weight: 800;
		background: var(--line);
		color: var(--fg-muted);
		line-height: 1;
	}
	li.done .marker {
		background: var(--yellow);
		color: #14171c;
	}
	li.current .marker {
		background: #14171c;
		color: #fff;
	}

	.body {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
	}
	.label {
		color: var(--fg);
		font-weight: 600;
		line-height: 1.35;
	}
	li.current .label {
		font-weight: 800;
	}
	li.done .label {
		color: var(--fg-muted);
	}
	li.blocked .label {
		color: var(--fg-muted);
	}

	.desc {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.note {
		font-size: 0.72rem;
		color: var(--fg-muted);
		opacity: 0.85;
	}

	.action {
		margin-top: 0.15rem;
	}
	.go {
		display: inline-block;
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		border: 1.5px solid #14171c;
		background: #14171c;
		color: #fff;
		text-decoration: none;
		font-size: 0.78rem;
		font-weight: 800;
		font-family: inherit;
		cursor: pointer;
	}
	.go:hover {
		background: #000;
	}
	.go:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}

	footer {
		display: flex;
	}
	.more {
		border: none;
		background: none;
		padding: 0;
		font-size: 0.75rem;
		font-weight: 800;
		color: var(--fg);
		cursor: pointer;
		font-family: inherit;
		text-decoration: underline;
		text-decoration-color: var(--yellow-deep);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}

	/* ---- Dark theme ----
	   The step button is ink-on-white in light; invert it so it doesn't disappear
	   against the dark card. Scoped to `.go` so it can't outrank other button rules. */
	:global(:root[data-theme='dark']) .go {
		background: var(--fg);
		border-color: var(--fg);
		color: #14171c;
	}
	:global(:root[data-theme='dark']) .go:hover {
		background: #fff;
		border-color: #fff;
	}
	:global(:root[data-theme='dark']) li.current .marker {
		background: var(--fg);
		color: #14171c;
	}
</style>
