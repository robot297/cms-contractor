<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * The whole app's error page. There wasn't one, so every failure fell through
	 * to SvelteKit's built-in text-on-white default.
	 *
	 * Two rules here. It never shows a stack trace or a raw exception string —
	 * those leak internals and mean nothing to a contractor on a job site. And
	 * every state offers a way onward, because a dead end with no button is how a
	 * transient blip turns into a support email.
	 */

	const status = $derived(page.status);
	const raw = $derived(page.error?.message ?? '');

	// Copy per status. `detail` is deliberately plain — what happened and what to
	// do — rather than an apology or an error code dressed up as a sentence.
	const copy = $derived.by(() => {
		if (status === 404)
			return {
				badge: '404',
				title: 'That page has moved on',
				detail:
					'The link you followed points somewhere that no longer exists. It may have been renamed, or the record it pointed at was archived.',
				hint: null
			};
		if (status === 403)
			return {
				badge: '403',
				title: 'Not yours to open',
				detail:
					'This belongs to a different account. If you think you should have access, whoever owns the record can share it with you.',
				hint: null
			};
		if (status === 402)
			return {
				badge: '402',
				title: 'Your subscription needs attention',
				detail:
					'Everything you have built is safe and still readable — new changes are paused until billing is sorted.',
				hint: null
			};
		if (status === 429)
			return {
				badge: '429',
				title: 'Slow down a moment',
				detail: 'That came through faster than we can serve it. Wait a few seconds and try again.',
				hint: null
			};
		return {
			badge: String(status),
			title: 'Something broke on our end',
			detail:
				'This one is our fault, not yours. Nothing you had saved is affected — it is only this page that failed to load.',
			hint: 'If it keeps happening, send us the time it occurred and what you were doing.'
		};
	});

	// A server error may carry a useful one-liner (SvelteKit's generic "Internal
	// Error" is not one). Shown small, under the copy, never in place of it.
	const GENERIC = ['Internal Error', 'Not Found', 'Forbidden', ''];
	const technical = $derived(GENERIC.includes(raw) ? null : raw);

	const isBilling = $derived(status === 402);
</script>

<svelte:head><title>{copy.badge} · {copy.title}</title></svelte:head>

<div class="wrap">
	<section class="panel">
		<span class="badge" aria-hidden="true">{copy.badge}</span>

		<h1>{copy.title}</h1>
		<p class="detail">{copy.detail}</p>

		{#if technical}
			<p class="technical"><span>Details</span> {technical}</p>
		{/if}

		<div class="actions">
			{#if isBilling}
				<a class="go" href={resolve('/contractor/billing')}>Go to billing</a>
			{:else}
				<button type="button" class="go" onclick={() => history.back()}>← Go back</button>
			{/if}
			<a class="alt" href={resolve('/contractor')}>Dashboard</a>
			{#if status >= 500}
				<button type="button" class="alt" onclick={() => location.reload()}>Try again</button>
			{/if}
		</div>

		{#if copy.hint}
			<p class="hint">
				{copy.hint}
				<a href={resolve('/contractor/support')}>Contact support</a>.
			</p>
		{/if}
	</section>
</div>

<style>
	.wrap {
		min-height: 70vh;
		display: grid;
		place-items: center;
		padding: 2rem 1rem;
	}

	/* Clean elevated panel, same language as the app's cards. */
	.panel {
		width: min(34rem, 100%);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 18px;
		box-shadow: var(--pop-shadow-lg);
		padding: 2rem 1.6rem 1.6rem;
		display: grid;
		gap: 0.7rem;
		text-align: center;
		justify-items: center;
	}

	/* The status as the graphic element — it carries the page, so nothing else
	   has to shout. Yellow on ink, tilted just enough to look deliberate. */
	.badge {
		display: inline-grid;
		place-items: center;
		min-width: 5.5rem;
		padding: 0.35rem 1rem;
		background: var(--brand);
		color: var(--on-brand);
		border: none;
		border-radius: 999px;
		box-shadow: var(--pop-shadow-sm);
		font-size: 2rem;
		font-weight: 900;
		letter-spacing: 0.02em;
		line-height: 1.15;
		transform: rotate(-2deg);
		margin-bottom: 0.35rem;
	}

	h1 {
		margin: 0;
		font-size: 1.45rem;
		font-weight: 800;
		color: var(--fg);
		line-height: 1.25;
	}

	.detail {
		margin: 0;
		max-width: 30rem;
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--fg-muted);
	}

	.technical {
		margin: 0.2rem 0 0;
		max-width: 30rem;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--fg-muted);
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 0.5rem 0.7rem;
		word-break: break-word;
	}
	.technical span {
		font-weight: 700;
		color: var(--fg);
		margin-right: 0.35rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		margin-top: 0.55rem;
	}

	.go,
	.alt {
		display: inline-block;
		padding: 0.55rem 1.1rem;
		border-radius: 999px;
		border: 1px solid var(--line-strong);
		font: inherit;
		font-weight: 700;
		font-size: 0.9rem;
		cursor: pointer;
		text-decoration: none;
		box-shadow: var(--pop-shadow-sm);
		transition:
			transform 0.06s ease,
			box-shadow 0.06s ease;
	}
	.go {
		background: var(--brand);
		color: var(--on-brand);
		border-color: transparent;
	}
	.alt {
		background: var(--surface);
		color: var(--fg);
	}
	/* Settle on press. */
	.go:active,
	.alt:active {
		transform: translateY(1px);
		box-shadow: none;
	}
	.go:focus-visible,
	.alt:focus-visible {
		outline: 3px solid var(--brand-deep);
		outline-offset: 2px;
	}

	.hint {
		margin: 0.5rem 0 0;
		max-width: 28rem;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.hint a {
		color: var(--fg);
		font-weight: 700;
		text-decoration: underline;
		text-decoration-color: var(--brand-deep);
		text-decoration-thickness: 2px;
		text-underline-offset: 2px;
	}

	@media (max-width: 30rem) {
		.panel {
			padding: 1.5rem 1.1rem 1.2rem;
		}
		.badge {
			font-size: 1.7rem;
		}
	}
</style>
