<script lang="ts">
	import { enhance } from '$app/forms';
	import ThemeToggle from '$lib/ThemeToggle.svelte';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
	let mode = $state<'signIn' | 'signUp'>('signIn');
	let demoLoading = $state(false);
</script>

<svelte:head>
	<title>{mode === 'signIn' ? 'Sign in' : 'Create account'}</title>
</svelte:head>

<ThemeToggle />

<div class="wrap">
	<div class="card">
		<h1 class="brand">Contractor&nbsp;CRM</h1>

		{#if data.demoEnabled}
			<form
				method="POST"
				action="?/demo"
				use:enhance={() => {
					demoLoading = true;
					return async ({ update }) => {
						await update();
						demoLoading = false;
					};
				}}
			>
				<button type="submit" class="demo" disabled={demoLoading}>
					{demoLoading ? 'Setting up…' : 'Live demo'}
				</button>
			</form>

			<div class="divider"><span>or</span></div>
		{/if}

		<div class="tabs">
			<button type="button" class:active={mode === 'signIn'} onclick={() => (mode = 'signIn')}
				>Sign in</button
			>
			<button type="button" class:active={mode === 'signUp'} onclick={() => (mode = 'signUp')}
				>Sign up</button
			>
		</div>

		{#if form?.message}
			<p class="error">{form.message}</p>
		{/if}
		{#if form?.verificationSent}
			<p class="verify-note" role="status">
				Check your inbox — a verification link is on its way to <strong>{form.email}</strong>. The
				account stays locked until it's clicked.
			</p>
		{/if}
		<!-- The unverified-sign-in refusal is the one failure that carries the email
		     back (so the resend form knows who to mail); keyed on that rather than
		     its own flag, which the generated ActionData union fails to carry. -->
		{#if form?.email && !form.verificationSent}
			<form method="POST" action="?/resendVerification" use:enhance>
				<input type="hidden" name="email" value={form.email} />
				<button type="submit" class="resend">Resend the verification email</button>
			</form>
		{/if}

		{#if mode === 'signIn'}
			<form method="POST" action="?/signIn" use:enhance class="fields">
				<label>Email<input name="email" type="email" required autocomplete="email" /></label>
				<label
					>Password<input
						name="password"
						type="password"
						required
						autocomplete="current-password"
					/></label
				>
				<button type="submit" class="primary">Sign in</button>
			</form>
		{:else}
			<form method="POST" action="?/signUp" use:enhance class="fields">
				<label>Name<input name="name" type="text" required /></label>
				<label>Email<input name="email" type="email" required autocomplete="email" /></label>
				<label
					>Password<input
						name="password"
						type="password"
						required
						minlength="8"
						autocomplete="new-password"
					/></label
				>
				<button type="submit" class="primary">Create account</button>
			</form>
		{/if}

		<form method="POST" action="?/signInGithub" use:enhance>
			<button type="submit" class="github">
				<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path
						d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
					/>
				</svg>
				Login with GitHub
			</button>
		</form>
	</div>
</div>

<style>
	.wrap {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem 1rem;
	}
	.card {
		/* Field colours, kept local so the dark values live in one place instead of
		   re-stating every input rule under a [data-theme='dark'] selector (which
		   would out-specify the :hover / :focus rules above it).
		   Light: sunken grey inside a hard black outline, like every other bordered
		   thing in the app. Dark: a raised fill a step above the card, with a border
		   light enough to actually draw the box. */
		--field-fill: var(--surface-sunken);
		--field-fill-lift: #ffffff;
		--field-line: #14171c;
		--field-line-focus: #14171c;

		width: 100%;
		max-width: 380px;
		display: grid;
		gap: 1rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 18px;
		padding: 1.75rem 1.5rem;
		box-shadow: var(--card-shadow);
	}
	/* Clean wordmark — opt out of the global chunky-yellow h1 treatment. */
	.brand {
		margin: 0 0 0.25rem;
		text-align: center;
		font-family: 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif;
		font-size: 1.4rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		text-transform: none;
		color: var(--fg);
		background: none;
		border: none;
		border-radius: 0;
		box-shadow: none;
		padding: 0;
		display: block;
	}
	/* Every button on the card shares the app's pop-art sticker press: a hard offset
	   shadow that lifts on hover and collapses under the button on click. The shadow
	   comes from --pop-shadow*, which already softens to a blur in dark mode. */
	.demo,
	.primary,
	.github {
		font-weight: 800;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition:
			transform 0.06s ease,
			box-shadow 0.06s ease,
			background 0.12s ease;
	}
	.demo:hover:not(:disabled),
	.primary:hover,
	.github:hover {
		transform: translate(-1px, -1px);
	}
	.demo:focus-visible,
	.primary:focus-visible,
	.github:focus-visible {
		outline: 3px solid var(--brand);
		outline-offset: 3px;
	}

	/* A secondary way in, not the headline action — so it's a compact centred pill
	   rather than a full-width block competing with the sign-in button below. */
	.demo {
		display: block;
		margin: 0 auto;
		padding: 0.45rem 1.1rem;
		border-radius: 999px;
		background: var(--brand);
		color: var(--on-brand);
		border: none;
		box-shadow: var(--pop-shadow-sm);
		font-size: 0.75rem;
	}
	.demo:hover:not(:disabled) {
		background: #f0be00;
		box-shadow: var(--pop-shadow);
	}
	.demo:disabled {
		opacity: 0.7;
		cursor: default;
		transform: none;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--fg-muted);
		font-size: 0.8rem;
	}
	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line);
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 0.3rem;
	}
	/* Transparent border on the inactive tabs so selecting one doesn't resize it. */
	.tabs button {
		flex: 1;
		padding: 0.5rem;
		border: 2px solid transparent;
		border-radius: 9px;
		background: none;
		color: var(--fg-muted);
		font-weight: 700;
		font-size: 0.9rem;
		cursor: pointer;
		transition:
			color 0.12s ease,
			background 0.12s ease;
	}
	.tabs button:hover:not(.active) {
		color: var(--fg);
	}
	/* Selected tab takes the app's brand-yellow pill — same active-state language
	   as the nav. Label pinned dark: yellow is light in both themes. */
	.tabs button.active {
		background: var(--brand);
		color: var(--on-brand);
		box-shadow: 0 1px 3px rgba(27, 31, 36, 0.18);
	}
	.tabs button:focus-visible {
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
	.fields {
		display: grid;
		gap: 0.75rem;
	}
	/* Micro-label, same uppercase voice as the buttons. Brightens while its field
	   has focus so the active row of the form is obvious at a glance. */
	.fields label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--fg-muted);
		transition: color 0.12s ease;
	}
	.fields label:focus-within {
		color: var(--fg);
	}
	/* Hairline field, matching the app's field recipe — the sunken fill and the
	   focus ring do the work rather than a heavy outline. */
	.fields input {
		padding: 0.7rem 0.75rem;
		border: 1px solid var(--field-line);
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 600;
		background: var(--field-fill);
		color: var(--fg);
		transition:
			border-color 0.12s ease,
			background 0.12s ease,
			box-shadow 0.12s ease;
	}
	.fields input:hover:not(:focus) {
		background: var(--field-fill-lift);
	}
	/* Focus is the app's yellow ring, not a one-off violet — same signal the
	   buttons and the global input rule already use. */
	.fields input:focus {
		outline: none;
		background: var(--field-fill-lift);
		border-color: var(--field-line-focus);
		box-shadow: 0 0 0 3px var(--brand-glow);
	}
	/* The submit action wears the brand: safety yellow with the pinned dark border
	   and label, same as every other primary action in the app. --pop-shadow keeps
	   the hard offset in light and softens to a blur in dark. */
	.primary {
		padding: 0.6rem;
		border: none;
		border-radius: 10px;
		background: var(--brand);
		color: var(--on-brand);
		font-size: 0.85rem;
		box-shadow: var(--pop-shadow-sm);
	}
	.primary:hover {
		background: #f0be00;
		box-shadow: var(--pop-shadow);
	}
	.error {
		margin: 0;
		color: #cf222e;
		font-size: 0.88rem;
	}
	/* "Check your inbox" — good news, so green rather than the error red above. */
	.verify-note {
		margin: 0;
		padding: 0.6rem 0.7rem;
		border: 1px solid #b7e0c4;
		border-radius: 10px;
		background: #eaf6ee;
		color: #14532d;
		font-size: 0.85rem;
		line-height: 1.5;
	}
	:global(:root[data-theme='dark']) .verify-note {
		background: #14301f;
		border-color: #2f6b45;
		color: #b7ecc6;
	}
	/* The way through an unverified refusal: a quiet link-shaped action. */
	.resend {
		width: 100%;
		padding: 0.4rem;
		border: none;
		background: none;
		color: var(--fg);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		text-decoration: underline;
		text-decoration-color: var(--brand-deep);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	/* Secondary sticker: outlined rather than filled, so it stays below the submit
	   button in the hierarchy while still looking like the same family of control. */
	.github {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.5rem;
		border: 1px solid var(--line-strong);
		border-radius: 10px;
		background: var(--surface);
		color: var(--fg);
		box-shadow: var(--pop-shadow-sm);
	}
	.github:hover {
		background: var(--surface-sunken);
		box-shadow: var(--pop-shadow);
	}
	.github svg {
		flex: none;
	}

	/* The press. Declared after every :hover rule above: a click is also a hover, so
	   at equal specificity the later rule is the one that gets to drop the shadow. */
	.demo:active:not(:disabled),
	.primary:active,
	.github:active {
		transform: translate(2px, 2px);
		box-shadow: none;
	}

	/* ---- Dark theme ----------------------------------------------------------
	   Everything above is token-driven, so dark mode only needs the handful of
	   cases where flipping a token isn't the right answer. */

	/* Fields sit a step ABOVE the dark card rather than inset — an inset near-black
	   field on a dark card is three shades of the same thing. The border lightens
	   to a grey that's clearly visible against both, since #14171c would vanish. */
	:global(:root[data-theme='dark']) .card {
		--field-fill: var(--surface-sunken);
		--field-fill-lift: #2c333d;
		--field-line: #59636f;
		--field-line-focus: #aab4c0;
	}
	/* The tab track sinks below the card so the yellow pill has something to sit on. */
	:global(:root[data-theme='dark']) .tabs {
		background: var(--surface-inset);
	}
	/* .primary needs no dark variant now that it's yellow — the fill and its pinned
	   dark label read the same in both themes. */

	/* GitHub's #cf222e fails contrast on the dark card. */
	:global(:root[data-theme='dark']) .error {
		color: #ff8b82;
	}
	/* Chrome paints autofilled fields with its own near-white wash; repaint them
	   with the field tokens so they don't flash white inside the dark card. */
	.fields input:-webkit-autofill,
	.fields input:-webkit-autofill:hover,
	.fields input:-webkit-autofill:focus {
		-webkit-text-fill-color: var(--fg);
		box-shadow: 0 0 0 1000px var(--field-fill) inset;
	}
</style>
