<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { FEEDBACK_TYPES, type FeedbackType } from '$lib/crm';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let type = $state<FeedbackType>('bug');
	// Cleared to true after a successful submit so the "thanks" panel shows.
	let sent = $derived(form?.success === true);

	const fieldErr = (name: string) =>
		form && 'field' in form && form.field === name ? form.message : null;

	// Cloudflare Turnstile — a low-friction CAPTCHA. Rendered explicitly so it works
	// on client-side navigation, and only when a site key is configured. The widget
	// injects a `cf-turnstile-response` token into the form, which the server checks.
	type Turnstile = {
		render: (el: HTMLElement, opts: { sitekey: string }) => string;
		remove?: (id?: string) => void;
	};
	const getTurnstile = () =>
		(globalThis as unknown as { turnstile?: Turnstile }).turnstile ?? undefined;

	let captchaEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		const siteKey = data.captchaSiteKey;
		if (!siteKey) return;

		const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
		if (!document.querySelector('script[data-turnstile]')) {
			const script = document.createElement('script');
			script.src = SRC;
			script.async = true;
			script.defer = true;
			script.dataset.turnstile = 'true';
			document.head.appendChild(script);
		}

		let widgetId: string | undefined;
		const render = () => {
			const ts = getTurnstile();
			if (ts && captchaEl && widgetId === undefined) {
				widgetId = ts.render(captchaEl, { sitekey: siteKey });
				return true;
			}
			return false;
		};
		// The script loads async; poll briefly until the global is ready.
		const interval = setInterval(() => render() && clearInterval(interval), 200);
		render();

		return () => {
			clearInterval(interval);
			getTurnstile()?.remove?.(widgetId);
		};
	});
</script>

<svelte:head><title>Support · Contractor CRM</title></svelte:head>

<div class="wrap">
	<header>
		<h1 class="page-title">Support</h1>
		<p class="sub">Report a bug or ask for a feature. It goes straight to our team.</p>
	</header>

	{#if !data.configured}
		<div class="notice">
			<strong>Support isn’t set up yet.</strong>
			<p>
				This form needs <code>GITHUB_REPO</code> and <code>GITHUB_TOKEN</code> configured. Ask your administrator
				to add them.
			</p>
		</div>
	{:else if sent && form?.success}
		<div class="notice success">
			<strong>Thanks — that’s in. 🎉</strong>
			<p>
				Filed as
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external GitHub issue URL -->
				<a href={form.issueUrl} target="_blank" rel="noopener">issue #{form.issueNumber}</a> — follow
				along there.
			</p>
			<button class="btn" type="button" onclick={() => location.reload()}>Send another</button>
		</div>
	{:else}
		<form
			method="POST"
			action="?/submit"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="card"
		>
			<fieldset class="type">
				<legend>What’s this about?</legend>
				<div class="segmented">
					{#each FEEDBACK_TYPES as t (t)}
						<label class:selected={type === t}>
							<input type="radio" name="type" value={t} bind:group={type} />
							<span class="emoji">{t === 'bug' ? '🐞' : '💡'}</span>
							{t === 'bug' ? 'Bug' : 'Feature'}
						</label>
					{/each}
				</div>
			</fieldset>

			<label class="field">
				Summary
				<input name="title" maxlength="140" placeholder="Short summary" required />
				{#if fieldErr('title')}<span class="err">{fieldErr('title')}</span>{/if}
			</label>

			<label class="field">
				Details
				<textarea name="detail" rows="6" required></textarea>
				{#if fieldErr('detail')}<span class="err">{fieldErr('detail')}</span>{/if}
			</label>

			<!-- Honeypot ("bot candy"): hidden from humans; bots that fill it are rejected. -->
			<div class="hp" aria-hidden="true">
				<label>
					Website
					<input type="text" name="website" tabindex="-1" autocomplete="off" />
				</label>
			</div>

			{#if data.captchaSiteKey}
				<div class="captcha" bind:this={captchaEl}></div>
			{/if}

			{#if form && 'message' in form && !('field' in form)}
				<p class="err block">{form.message}</p>
			{/if}

			<div class="actions">
				<button class="btn primary" type="submit">Send</button>
				<span class="hint">Goes to our team as a tracked issue.</span>
			</div>
		</form>
	{/if}
</div>

<style>
	.wrap {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}
	/* Honeypot: taken out of the layout and hidden from AT, but still submitted. */
	.hp {
		position: absolute;
		left: -9999px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
	.captcha {
		min-height: 65px;
	}
	header h1 {
		margin: 0 0 0.3rem;
		font-size: 1.6rem;
	}
	.sub {
		margin: 0 0 1.25rem;
		color: #555;
		font-weight: 600;
	}
	.type {
		border: none;
		padding: 0;
		margin: 0;
	}
	.type legend {
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #444;
		margin-bottom: 0.5rem;
		padding: 0;
	}
	.segmented {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.segmented label {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.7rem;
		border: 2px solid #111;
		border-radius: 10px;
		font-weight: 700;
		cursor: pointer;
		background: #fff;
		user-select: none;
	}
	.segmented label.selected {
		background: #ffcc00;
		box-shadow: 2px 2px 0 #111;
	}
	.segmented input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.emoji {
		font-size: 1.1rem;
	}
	.field {
		display: grid;
		gap: 0.3rem;
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: #444;
	}
	.field input,
	.field textarea {
		padding: 0.6rem;
		border: 2px solid #111;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 500;
		text-transform: none;
		letter-spacing: normal;
		color: #111;
	}
	.field textarea {
		resize: vertical;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-wrap: wrap;
	}
	.hint {
		font-size: 0.8rem;
		color: #777;
		font-weight: 600;
	}
	.btn {
		padding: 0.6rem 1.1rem;
		border: 2px solid #111;
		border-radius: 8px;
		background: #fff;
		font-weight: 800;
		cursor: pointer;
		font-size: 0.95rem;
	}
	.btn.primary {
		background: #0969da;
		color: #fff;
	}
	.err {
		color: #cf222e;
		font-weight: 600;
		text-transform: none;
		letter-spacing: normal;
		font-size: 0.82rem;
	}
	.err.block {
		margin: 0;
	}
	.notice {
		border: 2px solid #111;
		border-radius: 12px;
		padding: 1rem 1.1rem;
		background: #fffbe6;
	}
	.notice.success {
		background: #eefbf0;
		border-color: #1a7f37;
	}
	.notice p {
		margin: 0.4rem 0 0.8rem;
	}
	.notice code {
		background: #fff;
		border: 1px solid #d0d7de;
		border-radius: 5px;
		padding: 0.05rem 0.35rem;
		font-size: 0.85em;
	}
	.notice a {
		color: #0969da;
		font-weight: 700;
	}

	/* Dark theme */
	:global(:root[data-theme='dark']) .sub {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .type legend {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .segmented label {
		background: var(--field-bg);
		border-color: var(--field-border);
		color: var(--fg);
	}
	/* Keep the brand-yellow selected state; pin dark text for contrast on yellow. */
	:global(:root[data-theme='dark']) .segmented label.selected {
		background: #ffcc00;
		color: #14171c;
	}
	:global(:root[data-theme='dark']) .field {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .field input,
	:global(:root[data-theme='dark']) .field textarea {
		background: var(--field-bg);
		border-color: var(--field-border);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .hint {
		color: var(--fg-muted);
	}
	/* Secondary button surface (incl. "Send more feedback" white card in the success panel). */
	:global(:root[data-theme='dark']) .btn {
		background: var(--surface);
		color: var(--fg);
	}
	/* Primary keeps its semantic brand blue (not a #1f2328-dark button). */
	:global(:root[data-theme='dark']) .btn.primary {
		background: #0969da;
		color: #fff;
	}
	/* Notice panels keep their semantic warning/success hues; pin dark text so the
	   pale panels stay readable against the dark page. */
	:global(:root[data-theme='dark']) .notice {
		color: #1f2328;
	}
</style>
