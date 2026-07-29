<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { Guide, GuideStep } from '$lib/server/guide.server';

	let { guide, onclose }: { guide: Guide; onclose?: () => void } = $props();

	const steps = $derived(
		guide.state === 'extended' ? [...guide.core, ...guide.extended] : guide.core
	);
	const doneCount = $derived(steps.filter((s) => s.done).length);

	function stepHref(step: GuideStep) {
		return resolve(step.href as '/contractor/customers');
	}
</script>

<section class="guide">
	<header>
		<span class="title">Getting started</span>
		<span class="count">{doneCount}/{steps.length}</span>
		<form method="POST" action="?/guideDismiss" use:enhance={() => () => onclose?.()}>
			<button type="submit" class="close" aria-label="Hide getting started" title="Hide">×</button>
		</form>
	</header>

	<ul>
		{#each steps as step (step.id)}
			<li class:done={step.done}>
				<span class="tick" aria-hidden="true">{step.done ? '✓' : ''}</span>
				{#if step.done || !step.href}
					<span class="label">{step.title}</span>
				{:else}
					<a class="label" href={stepHref(step)}>{step.title}</a>
				{/if}
				{#if !step.done && step.blockedBy}
					<span class="note">{step.blockedBy}</span>
				{:else if !step.done && step.id === 'followUp'}
					<form method="POST" action="?/guideAckFollowUp" use:enhance>
						<button type="submit" class="note-btn">got it</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>

	{#if guide.atFork}
		<footer>
			<form method="POST" action="?/guideContinue" use:enhance>
				<button type="submit" class="more">There’s more →</button>
			</form>
		</footer>
	{/if}
</section>

<style>
	.guide {
		display: grid;
		gap: 0.5rem;
		padding: 0.75rem 0.9rem;
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

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.3rem;
	}
	li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.85rem;
	}
	.tick {
		flex: none;
		width: 1rem;
		text-align: center;
		font-weight: 800;
		color: var(--yellow-deep);
	}
	.label {
		color: var(--fg);
		font-weight: 600;
	}
	a.label {
		text-decoration: underline;
		text-decoration-color: var(--yellow-deep);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}
	li.done .label {
		color: var(--fg-muted);
		text-decoration-line: line-through;
		text-decoration-color: var(--fg-muted);
		text-decoration-thickness: 1px;
	}
	.note,
	.note-btn {
		font-size: 0.72rem;
		color: var(--fg-muted);
	}
	.note-btn {
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		font-family: inherit;
		text-decoration: underline;
	}
	.note-btn:hover {
		color: var(--fg);
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
</style>
