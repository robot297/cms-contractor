<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { Guide } from '$lib/server/guide.server';

	/**
	 * The getting-started card.
	 *
	 * One thing to do at a time, and the thing itself happens here — the primary
	 * step opens a dialog on this page rather than sending anyone to another
	 * screen. What this replaced was a numbered list of five links with a progress
	 * bar over it: it looked like a form to fill in, it read as a list of chores,
	 * and every item was a redirect somewhere else.
	 *
	 * The remaining step is shown; the ones behind it are a row of dots. A
	 * contractor does not need to read what they have already done, and five
	 * equally-weighted rows gave no sense of what to do NEXT, which is the entire
	 * job of a card like this.
	 */
	let {
		guide,
		onclose,
		onstart
	}: {
		guide: Guide;
		onclose?: () => void;
		/** Opens the first-job dialog, which lives on the page that mounts this. */
		onstart?: () => void;
	} = $props();

	const settled = (s: Guide['steps'][number]) => s.done || s.skipped === true;
	/** The one step being asked for: the first unsettled one. */
	const current = $derived(guide.steps.find((s) => !settled(s)) ?? null);
	const doneCount = $derived(guide.steps.filter(settled).length);
</script>

{#if current}
	<section class="guide">
		<div class="head">
			<span class="eyebrow">Getting started</span>
			<!-- Progress as dots, not a bar with a percentage. There are two steps;
			     a percentage of two is a statistic nobody asked for. -->
			<span class="dots" aria-label="Step {doneCount + 1} of {guide.steps.length}">
				{#each guide.steps as step (step.id)}
					<span class="dot" class:on={settled(step)} aria-hidden="true"></span>
				{/each}
			</span>
			<form method="POST" action="?/guideDismiss" use:enhance={() => () => onclose?.()}>
				<button type="submit" class="close" aria-label="Hide getting started" title="Hide">×</button
				>
			</form>
		</div>

		<h2 class="title">{current.title}</h2>
		<p class="desc">{current.description}</p>

		<div class="actions">
			{#if current.id === 'job'}
				<!-- Not a link. The whole point of this rewrite is that the first job is
				     created without leaving the dashboard. -->
				<button type="button" class="go" onclick={() => onstart?.()}>Add your first job</button>
			{:else}
				<!-- The one step that does leave the page, because sending an invite is
				     a thing you do TO a customer and the directory is where they are.
				     It is also the optional one, so the trip is opt-in by definition. -->
				<a class="go" href={resolve('/contractor/people')}>Invite a customer →</a>
			{/if}
			{#if current.skippable}
				<form method="POST" action="?/guideSkipStep" use:enhance>
					<input type="hidden" name="stepId" value={current.id} />
					<button type="submit" class="skip">No thanks</button>
				</form>
			{/if}
		</div>
	</section>
{/if}

<style>
	.guide {
		display: grid;
		gap: 0.4rem;
		padding: 1rem 1.15rem 1.15rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-card);
		background: var(--surface);
		/* The accent as an edge and a wash, not a filled slab: this is a nudge on a
		   working page, and a card that shouts is a card people dismiss. */
		border-left: 3px solid var(--brand);
		background-image: linear-gradient(
			110deg,
			color-mix(in srgb, var(--brand) 9%, transparent),
			transparent 55%
		);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.eyebrow {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--brand);
	}
	.dots {
		display: inline-flex;
		gap: 0.25rem;
		margin-right: auto;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--line-strong);
	}
	.dot.on {
		background: var(--brand);
		/* Empty and decorative, so this never renders. Declared anyway because the
		   fill and its foreground must not be separable — the rule
		   theme.contrast.test.ts enforces, and the one `.rail-glide` follows. */
		color: var(--on-brand);
	}
	.close {
		border: none;
		background: none;
		color: var(--fg-muted);
		font-size: 1.2rem;
		line-height: 1;
		padding: 0.1rem 0.25rem;
		cursor: pointer;
	}
	.close:hover {
		color: var(--fg);
	}
	.title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 800;
	}
	.desc {
		margin: 0;
		max-width: 60ch;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-top: 0.35rem;
	}
	.go {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: var(--radius-control);
		background: var(--brand-sweep);
		color: var(--on-brand);
		box-shadow: 0 0 16px var(--brand-glow);
		font-family: inherit;
		font-size: 0.88rem;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}
	.go:hover {
		filter: brightness(1.08);
	}
	.skip {
		border: none;
		background: none;
		padding: 0.35rem 0.2rem;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.skip:hover {
		color: var(--fg);
	}
</style>
