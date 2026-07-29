<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { Guide, GuideStep } from '$lib/server/guide.server';

	// `variant` only changes the framing copy: on the dashboard the Guide stands in
	// for the empty state and greets a new contractor; on the support page it's a
	// reference they came looking for.
	let { guide, variant = 'dashboard' }: { guide: Guide; variant?: 'dashboard' | 'support' } =
		$props();

	// Extended steps are shown once they opt in — and always on the support page,
	// where the whole point is to see the full walkthrough.
	const showExtended = $derived(variant === 'support' || guide.state === 'extended');
	const steps = $derived(showExtended ? [...guide.core, ...guide.extended] : guide.core);
	const doneCount = $derived(steps.filter((s) => s.done).length);

	// Actions live on whichever page mounts this, under the same names.
	const action = (name: string) => `?/${name}`;

	function stepHref(step: GuideStep) {
		// resolve() wants a known route; every href here is one.
		return resolve(step.href as '/contractor/customers');
	}
</script>

<section class="guide card">
	<header>
		<div>
			<h2>
				{#if variant === 'support'}
					Getting started
				{:else if guide.allDone}
					You’re all set up
				{:else if guide.coreDone}
					Nice work — that’s the hard part
				{:else}
					Welcome — let’s get you going
				{/if}
			</h2>
			<p class="lede">
				{#if variant === 'support'}
					The five things worth knowing, and where each one lives.
				{:else if guide.coreDone}
					You’ve got a customer and a job on the books. Want to see what else this thing does?
				{:else}
					Two steps and the app starts working for you.
				{/if}
			</p>
		</div>
		<span class="count">{doneCount}/{steps.length}</span>
	</header>

	<ol>
		{#each steps as step, i (step.id)}
			<li class:done={step.done}>
				<span class="marker" aria-hidden="true">{step.done ? '✓' : i + 1}</span>
				<div class="step-body">
					<h3>{step.title}</h3>
					<p>{step.body}</p>

					{#if !step.done}
						{#if step.blockedBy}
							<span class="blocked">{step.blockedBy}</span>
						{:else if step.href && step.cta}
							<a class="go" href={stepHref(step)}>{step.cta} →</a>
						{:else if step.id === 'followUp'}
							<form method="POST" action={action('guideAckFollowUp')} use:enhance>
								<button type="submit" class="go as-button">Got it</button>
							</form>
						{/if}
					{/if}
				</div>
			</li>
		{/each}
	</ol>

	<!-- The fork. It waits here until answered rather than vanishing the moment the
	     second step completes — orders are created on another page, so the moment of
	     completion almost never happens while looking at this card. -->
	{#if variant === 'support' && guide.state === 'dismissed'}
		<footer>
			<form method="POST" action={action('guideRestore')} use:enhance>
				<button type="submit" class="primary">Put this back on my dashboard</button>
			</form>
		</footer>
	{:else if variant === 'dashboard'}
		<footer>
			{#if guide.atFork}
				<form method="POST" action={action('guideContinue')} use:enhance>
					<button type="submit" class="primary">Show me more</button>
				</form>
				<form method="POST" action={action('guideDismiss')} use:enhance>
					<button type="submit" class="quiet">I’m all set</button>
				</form>
			{:else}
				<form method="POST" action={action('guideDismiss')} use:enhance>
					<button type="submit" class="quiet">
						{guide.allDone ? 'Close this' : 'Hide this — I’ll explore on my own'}
					</button>
				</form>
				<span class="hint">You can reopen it from Support.</span>
			{/if}
		</footer>
	{/if}
</section>

<style>
	.guide {
		gap: 1rem;
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		text-transform: none;
		color: var(--fg);
	}
	.lede {
		margin: 0.3rem 0 0;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.count {
		flex: none;
		padding: 0.2rem 0.55rem;
		border: 1.5px solid var(--pop-line);
		border-radius: 999px;
		background: var(--surface-sunken);
		font-size: 0.72rem;
		font-weight: 800;
		color: var(--fg-muted);
	}

	ol {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.6rem;
	}
	li {
		display: flex;
		gap: 0.75rem;
		padding: 0.8rem 0.9rem;
		border: 2px solid var(--line);
		border-radius: 12px;
		background: var(--surface-sunken);
	}
	/* Completed steps recede: the eye should land on what's left to do. */
	li.done {
		opacity: 0.62;
		background: transparent;
	}
	.marker {
		flex: none;
		width: 1.6rem;
		height: 1.6rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: 2px solid var(--pop-line);
		background: var(--surface);
		font-size: 0.8rem;
		font-weight: 800;
		color: var(--fg);
	}
	li.done .marker {
		background: var(--yellow);
		border-color: #14171c;
		color: #14171c;
	}
	.step-body {
		display: grid;
		gap: 0.25rem;
	}
	h3 {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 800;
		letter-spacing: 0;
		text-transform: none;
		color: var(--fg);
	}
	.step-body p {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.go {
		justify-self: start;
		margin-top: 0.35rem;
		font-size: 0.8rem;
		font-weight: 800;
		color: var(--fg);
		text-decoration: underline;
		text-decoration-color: var(--yellow-deep);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}
	.as-button {
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		font-family: inherit;
	}
	.blocked {
		margin-top: 0.35rem;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--fg-muted);
		font-style: italic;
	}

	footer {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.primary {
		padding: 0.5rem 1rem;
		border: 2px solid #14171c;
		border-radius: 10px;
		background: var(--yellow);
		color: #14171c;
		font-weight: 800;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
		transition:
			transform 0.06s ease,
			box-shadow 0.06s ease;
	}
	.primary:hover {
		transform: translate(-1px, -1px);
		box-shadow: var(--pop-shadow);
	}
	.primary:active {
		transform: translate(2px, 2px);
		box-shadow: none;
	}
	.quiet {
		padding: 0.5rem 0.7rem;
		border: none;
		border-radius: 10px;
		background: none;
		color: var(--fg-muted);
		font-weight: 700;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.quiet:hover {
		color: var(--fg);
		text-decoration: underline;
	}
	.hint {
		font-size: 0.75rem;
		color: var(--fg-muted);
	}
</style>
