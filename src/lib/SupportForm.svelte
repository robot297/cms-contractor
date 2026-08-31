<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { FEEDBACK_TYPES, type FeedbackType } from '$lib/crm';

	/**
	 * The feedback form, as both places that file an issue render it.
	 *
	 * Extracted when Support folded into the contractor's Settings tabs: the same
	 * form now has two hosts with two different form actions, and a second copy of
	 * a CAPTCHA, an upload pre-check and a honeypot is exactly the kind of thing
	 * that gets fixed in one place and not the other.
	 *
	 * The result shape is whatever the host route's action returns, so it is typed
	 * structurally rather than imported from one of them.
	 */
	type SupportResult = {
		success?: boolean;
		issueUrl?: string;
		issueNumber?: number;
		field?: string;
		message?: string;
	} | null;

	let {
		configured,
		captchaSiteKey = null,
		form = null,
		/** The host route's action — the two hosts name theirs differently. */
		action,
		/**
		 * Show the form but refuse the send, with `readOnlyNote` saying why.
		 *
		 * The portal's copy is read-only under development view-as: the session
		 * being borrowed is the contractor's, so a report filed from it would be
		 * signed with the wrong person's name. The server refuses it too — this
		 * only stops the round trip.
		 */
		readOnly = false,
		readOnlyNote = ''
	}: {
		configured: boolean;
		captchaSiteKey?: string | null;
		form?: SupportResult;
		action: string;
		readOnly?: boolean;
		readOnlyNote?: string;
	} = $props();

	let type = $state<FeedbackType>('bug');
	// Cleared to true after a successful submit so the "thanks" panel shows.
	let sent = $derived(form?.success === true);

	// Send only arms once there's actually something to send.
	let title = $state('');
	let detail = $state('');
	const canSend = $derived(title.trim() !== '' && detail.trim() !== '' && !readOnly);

	// Optional screenshot: pre-checked here (type + size) so a doomed upload never
	// leaves the browser; the server re-checks and parks it in the support repo.
	const SHOT_LIMIT = 5 * 1024 * 1024; // matches MAX_SCREENSHOT_BYTES server-side
	const SHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
	let shotInput: HTMLInputElement | undefined = $state();
	let shotName = $state('');
	let shotPreview = $state<string | null>(null);
	let shotError = $state('');
	function pickShot() {
		const file = shotInput?.files?.[0] ?? null;
		shotError = '';
		if (shotPreview) URL.revokeObjectURL(shotPreview);
		shotPreview = null;
		shotName = '';
		if (!file) return;
		if (!SHOT_TYPES.includes(file.type)) {
			shotError = 'Screenshots must be a PNG, JPEG, WebP or GIF image.';
			if (shotInput) shotInput.value = '';
			return;
		}
		if (file.size > SHOT_LIMIT) {
			shotError = 'Keep screenshots under 5 MB.';
			if (shotInput) shotInput.value = '';
			return;
		}
		shotName = file.name;
		shotPreview = URL.createObjectURL(file);
	}
	function clearShot() {
		if (shotInput) shotInput.value = '';
		pickShot();
	}

	const fieldErr = (name: string) => (form?.field === name ? (form.message ?? null) : null);

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
		const siteKey = captchaSiteKey;
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

{#if !configured}
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
		<!-- The issue number only comes back to the contractor. The tracker is ours,
		     so a customer gets the acknowledgement without a link into it — which is
		     why this reads off the payload rather than off which host rendered it. -->
		{#if form.issueUrl}
			<p>
				Filed as
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external GitHub issue URL -->
				<a href={form.issueUrl} target="_blank" rel="noopener">issue #{form.issueNumber}</a> — follow
				along there.
			</p>
		{:else}
			<p>We read everything that comes through here.</p>
		{/if}
		<button class="btn" type="button" onclick={() => location.reload()}>Send another</button>
	</div>
{:else}
	<form
		method="POST"
		{action}
		enctype="multipart/form-data"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
		class="card"
	>
		<!-- No legend. The two segments say "Issue" and "Feature", which is the
		     whole question — a heading above them restated it in more words. The
		     group still carries a name for a screen reader, where the segments are
		     read one at a time and the pair is not visible as a pair. -->
		<fieldset class="type" aria-label="What this is about">
			<div class="segmented">
				{#each FEEDBACK_TYPES as t (t)}
					<!-- "Issue", not "Bug". Someone who is not sure whether what they hit
						     is a defect or a gap should not have to decide before they can
						     type. The stored value is still `bug` — it maps to a GitHub label
						     (see `support.server.ts`) and renaming that would orphan every
						     issue already filed under it. -->
					<label class:selected={type === t}>
						<input type="radio" name="type" value={t} bind:group={type} />
						{t === 'bug' ? 'Issue' : 'Feature'}
					</label>
				{/each}
			</div>
		</fieldset>

		<label class="field">
			Summary
			<input name="title" maxlength="140" required bind:value={title} />
			{#if fieldErr('title')}<span class="err">{fieldErr('title')}</span>{/if}
		</label>

		<label class="field">
			Details
			<textarea name="detail" rows="6" required bind:value={detail}></textarea>
			{#if fieldErr('detail')}<span class="err">{fieldErr('detail')}</span>{/if}
		</label>

		<!-- Optional screenshot. Ends up committed to the support repo and linked
			     from the issue — the Issues API has no native attachment upload. -->
		<div class="shot">
			<span class="shot-label">Screenshot <span class="opt">optional</span></span>
			{#if shotPreview}
				<div class="shot-preview">
					<img src={shotPreview} alt="Screenshot to attach" />
					<div class="shot-meta">
						<span class="shot-name">{shotName}</span>
						<button type="button" class="shot-remove" onclick={clearShot}>Remove</button>
					</div>
				</div>
			{/if}
			<label class="shot-pick">
				<span aria-hidden="true">📎</span>
				{shotPreview ? 'Replace screenshot' : 'Attach a screenshot'}
				<input
					bind:this={shotInput}
					type="file"
					name="screenshot"
					accept="image/png,image/jpeg,image/webp,image/gif"
					onchange={pickShot}
				/>
			</label>
			{#if shotError}
				<span class="err">{shotError}</span>
			{:else if fieldErr('screenshot')}
				<span class="err">{fieldErr('screenshot')}</span>
			{/if}
		</div>

		<!-- Honeypot ("bot candy"): hidden from humans; bots that fill it are rejected. -->
		<div class="hp" aria-hidden="true">
			<label>
				Website
				<input type="text" name="website" tabindex="-1" autocomplete="off" />
			</label>
		</div>

		{#if captchaSiteKey}
			<div class="captcha" bind:this={captchaEl}></div>
		{/if}

		{#if form?.message && !form.field}
			<p class="err block">{form.message}</p>
		{/if}

		{#if readOnly && readOnlyNote}
			<p class="err block">{readOnlyNote}</p>
		{/if}

		<div class="actions">
			<button
				class="btn primary"
				type="submit"
				disabled={!canSend}
				title={readOnly ? readOnlyNote : canSend ? 'Send' : 'Fill in the summary and details first'}
				>Send</button
			>
		</div>
	</form>
{/if}

<style>
	/* The card's own frame, tightened. The shared `.card` is sized for a dashboard
	   tile that holds a handful of facts; this one holds five full-width controls,
	   and its default 1.2rem inset was being spent on the same air the page gutter
	   already provides. */
	.card {
		gap: 0.7rem;
	}

	/* PHONE. This form was paying for its frame twice: the page gutter, and then
	   the card's own border and padding inside it — about 4.5rem of a 360px screen
	   spent drawing two boxes around a column of inputs, so every field was typed
	   into a slot narrower than it needed to be.
	   
	   On a phone the viewport edge IS the frame. The card flattens to bare content
	   and the fields run the full width; from 561px up it is a card again, because
	   there the border is what stops the form from dissolving into the page. */
	@media (max-width: 560px) {
		.card {
			border: none;
			box-shadow: none;
			background: none;
			padding: 0;
		}
		/* The two choices are short words now that the glyphs are gone; they do not
		   need a 0.7rem cushion on every side to be a comfortable target. */
		.segmented label {
			padding: 0.6rem 0.5rem;
		}
		/* The preview confirms the right file is attached; it is not a viewer.
		   Half the size still says that, and leaves the filename room to sit
		   beside it instead of wrapping under it. */
		.shot-preview img {
			width: 3.5rem;
			height: 3.5rem;
		}
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
	.type {
		border: none;
		padding: 0;
		margin: 0;
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
		border: 1px solid var(--line-strong);
		border-radius: 10px;
		font-weight: 700;
		cursor: pointer;
		background: var(--surface);
		user-select: none;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.segmented label.selected {
		background: var(--brand);
		border-color: transparent;
		color: var(--on-brand);
		box-shadow: var(--pop-shadow-sm);
	}
	.segmented input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
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
	/* App-wide field recipe: hairline border, sunken well, yellow focus ring (the
	   focus treatment comes from the global input rules). */
	.field input,
	.field textarea {
		/* Roomy across, snug down: the height is what a line of type needs, the
		   width is the whole card. */
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--field-border);
		border-radius: 10px;
		font-size: 1rem;
		font-weight: 500;
		text-transform: none;
		letter-spacing: normal;
		color: #111;
		background: var(--field-bg);
	}
	.field textarea {
		resize: vertical;
	}
	/* Send sits at the end of the form, on the right — where every other modal
	   and card in the app puts its commit. */
	.actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.8rem;
		flex-wrap: wrap;
	}

	/* Screenshot picker: a dashed attach chip; preview swaps in beside it. */
	/* Centred. One optional chip — and, once picked, a thumbnail — sitting under
	   five full-width controls: left-aligned against a column this wide it read
	   as something that had come loose from the edge. */
	.shot {
		display: grid;
		gap: 0.4rem;
		justify-items: center;
		text-align: center;
	}
	.shot-label {
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: #444;
	}
	.opt {
		font-weight: 600;
		text-transform: none;
		letter-spacing: normal;
		color: #8b949e;
	}
	.shot-pick {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		justify-self: center;
		padding: 0.45rem 0.8rem;
		border: 1px dashed var(--line-strong);
		border-radius: 10px;
		background: var(--field-bg);
		color: var(--fg-muted);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			color 0.12s ease,
			border-color 0.12s ease;
	}
	.shot-pick:hover {
		color: var(--fg);
		border-color: var(--fg-muted);
	}
	/* Hidden but still a live form control — display:none inputs submit fine. */
	.shot-pick input {
		display: none;
	}
	.shot-preview {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
	}
	.shot-preview img {
		width: 5.5rem;
		height: 5.5rem;
		object-fit: cover;
		border-radius: 10px;
		border: 1px solid var(--line-strong);
	}
	.shot-meta {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}
	.shot-name {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--fg);
		overflow-wrap: anywhere;
	}
	.shot-remove {
		justify-self: center;
		border: none;
		background: none;
		padding: 0.1rem 0;
		color: #cf222e;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
	}
	.btn {
		padding: 0.6rem 1.1rem;
		border: 1px solid var(--line-strong);
		border-radius: 10px;
		background: var(--surface);
		color: var(--fg);
		font-weight: 700;
		cursor: pointer;
		font-size: 0.95rem;
		box-shadow: var(--pop-shadow-sm);
	}
	/* The app's yellow primary, replacing this page's leftover brand-blue. */
	.btn.primary {
		background: var(--brand);
		color: var(--on-brand);
		border-color: transparent;
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--brand-deep);
	}
	/* Nothing to send yet → the accent drains and the button goes flat and
	   dashed, the app-wide "inert" treatment. */
	.btn.primary:disabled {
		background: transparent;
		color: var(--fg-muted);
		border: 1px dashed var(--line-strong);
		cursor: not-allowed;
		box-shadow: none;
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
		border: 1px solid var(--line-strong);
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
	/* Segments and buttons are token-driven above, so dark needs no override for
	   them — and a bare dark rule here would outrank the .selected / .primary
	   states on specificity. Only non-token text colors are mapped. */
	:global(:root[data-theme='dark']) .segmented label:not(.selected) {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .field {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .field input,
	:global(:root[data-theme='dark']) .field textarea {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .shot-label {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .shot-remove {
		color: #ff8f8a;
	}
	/* Notice panels keep their semantic warning/success hues; pin dark text so the
	   pale panels stay readable against the dark page. */
	:global(:root[data-theme='dark']) .notice {
		color: #1f2328;
	}
</style>
