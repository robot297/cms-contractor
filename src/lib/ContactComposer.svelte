<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { composeEmail, normalizePreferredContact, renderTemplate } from '$lib/crm';
	import { toast } from '$lib/toast.svelte';

	let {
		customer,
		project,
		orderId,
		rows = 6,
		onsent,
		onclose
	}: {
		customer: { name: string; email: string; phone: string | null; preferredContact: string };
		/** Order project name, used to resolve `{{project}}`. Omitted off order surfaces. */
		project?: string | null;
		/**
		 * The order this composer was opened from. Its presence is what makes a
		 * successful send appear on that order's timeline; off order surfaces the
		 * message still sends, it just isn't recorded.
		 */
		orderId?: string | null;
		rows?: number;
		onsent?: () => void;
		/** When provided, the composer shows a header with a cancel (✕) button. */
		onclose?: () => void;
	} = $props();

	// Templates + branding are loaded once in contractor/+layout.server.ts, so they
	// are on page.data wherever this composer appears. Read defensively so the
	// component still renders if it's ever mounted outside that layout.
	type ComposerData = {
		emailTemplates?: { id: string; name: string; subject: string; body: string }[];
		contractorSettings?: { businessName: string; signature: string };
		emailSendingConfigured?: boolean;
		emailDevTools?: boolean;
		demoAccount?: boolean;
	};
	const data = $derived(page.data as unknown as ComposerData);
	const templates = $derived(data.emailTemplates ?? []);
	const settings = $derived(data.contractorSettings ?? { businessName: '', signature: '' });
	// With no provider configured the app can't send, so the composer hands off to
	// the contractor's mail client exactly as it always did — no round-trip, and
	// nothing that reads as broken. See ADR 0007.
	const sendingConfigured = $derived(data.emailSendingConfigured ?? false);
	// EMAIL_DEV_TOOLS. Lets the confirmation and failure states be checked without
	// spending a real email; off in every deployment that hasn't opted in.
	const devTools = $derived(data.emailDevTools ?? false);
	// The shared demo login. It never sends mail through the app — the server
	// refuses it outright — so the composer says so instead of offering a Send.
	const demoAccount = $derived(data.demoAccount ?? false);

	const preferred = $derived(normalizePreferredContact(customer.preferredContact));
	// One channel selector covers all three ways to reach a customer. Call has no
	// message to compose — its action is just a tel: link — but it lives in the same
	// picker so there's a single, non-redundant set of contact controls.
	let method = $state<'email' | 'text' | 'call'>('email');
	const tel = $derived((customer.phone ?? '').replace(/[^\d+]/g, ''));

	// Email channel: a chosen template fills subject + body, both still editable.
	let templateId = $state('');
	let subject = $state('');
	let body = $state('');
	// Text (SMS) channel: a single free-form message, unchanged from before.
	let text = $state('');

	/** The placeholder values available in this context. */
	const vars = $derived({
		customer: customer.name,
		contractor: settings.businessName,
		project: project ?? ''
	});

	// Set when a send fails, so the contractor sees why and can still get the
	// message out through their own mail client rather than retyping it.
	let sendError = $state('');
	let sending = $state(false);

	// Reset the composer whenever it's pointed at a different customer, defaulting
	// the channel to their preferred messaging channel.
	$effect(() => {
		void customer.email; // track the customer identity so the reset re-runs on change
		untrack(() => {
			// Default to the customer's preferred channel when it's reachable.
			method = preferred !== 'email' && customer.phone ? preferred : 'email';
			templateId = '';
			subject = '';
			body = '';
			text = '';
			sendError = '';
			sending = false;
		});
	});

	/** Fill subject + body from the picked template, placeholders resolved. */
	function applyTemplate(id: string) {
		templateId = id;
		const t = templates.find((x) => x.id === id);
		if (!t) return;
		subject = renderTemplate(t.subject, vars);
		body = renderTemplate(t.body, vars);
	}

	/** Text (SMS) keeps the client-side handoff — there's no server component to it. */
	function sendText() {
		if (!customer.phone || !text.trim()) return;
		const smsBody = encodeURIComponent(text.trim());
		window.location.href = `sms:${tel}?&body=${smsBody}`;
		onsent?.();
	}

	/**
	 * The fallback: hand the composed message to the contractor's own mail client.
	 * Taken when sending isn't configured, and offered after a provider failure so
	 * an outage costs a click rather than the message.
	 */
	function openInMailClient(composedSubject?: string, composedBody?: string) {
		const composed =
			composedSubject === undefined || composedBody === undefined
				? composeEmail({ subject, body }, vars, settings.signature)
				: { subject: composedSubject, body: composedBody };
		if (!composed.body.trim()) return;
		const q: string[] = [];
		if (composed.subject.trim()) q.push(`subject=${encodeURIComponent(composed.subject)}`);
		q.push(`body=${encodeURIComponent(composed.body)}`);
		window.location.href = `mailto:${customer.email}?${q.join('&')}`;
		onsent?.();
	}

	/**
	 * Which simulated outcome the next submit should ask for, set by the dev-tools
	 * buttons just before they submit.
	 *
	 * A plain variable rather than `$state`, and stamped onto the form data by hand
	 * in the submit handler rather than carried as a submit button's name/value.
	 * The first version relied on the submitter's value reaching the server, and
	 * when it didn't the request looked like an ordinary send — so pressing
	 * "Simulate sent" spent a real email. The failure mode is expensive enough that
	 * this path should not depend on anything implicit.
	 */
	let pendingSimulate: '' | 'success' | 'failure' = '';

	// What the failure hands back, so the fallback link carries the same message the
	// server tried to send rather than recomposing it here.
	let failedSubject = $state('');
	let failedBody = $state('');

	// The message channels have a compose step to guard; Call is a direct link.
	const canSend = $derived(method === 'text' ? !!text.trim() : !!body.trim());
</script>

<div class="composer">
	{#if onclose}
		<div class="composer-head">
			<span class="composer-title">Message {customer.name}</span>
			<button type="button" class="close" aria-label="Cancel" onclick={() => onclose?.()}>✕</button>
		</div>
	{/if}

	<!-- Channel selector first: the customer's preferred channel is pre-selected.
	     A segmented control — equal-width segments on one row — rather than a
	     label + loose chips, which wrapped to two ragged rows on phones. -->
	<div class="methods" role="group" aria-label="Contact method">
		<button
			type="button"
			class="chip"
			class:sel={method === 'email'}
			onclick={() => (method = 'email')}
		>
			✉️ Email{#if preferred === 'email'}<span class="star" title="Preferred">★</span>{/if}
		</button>
		{#if customer.phone}
			<button
				type="button"
				class="chip"
				class:sel={method === 'text'}
				onclick={() => (method = 'text')}
			>
				💬 Text{#if preferred === 'text'}<span class="star" title="Preferred">★</span>{/if}
			</button>
			<button
				type="button"
				class="chip"
				class:sel={method === 'call'}
				onclick={() => (method = 'call')}
			>
				📞 Call{#if preferred === 'call'}<span class="star" title="Preferred">★</span>{/if}
			</button>
		{/if}
	</div>

	{#if method === 'call'}
		<!-- Call has nothing to compose, but the pane keeps the composer's footprint
		     so switching channels doesn't bounce the card's size around. -->
		<div class="compose-box call-pane">
			<span class="call-glyph" aria-hidden="true">📞</span>
			<span class="call-number">{customer.phone}</span>
			<p class="call-hint">Dials {customer.name} from your phone app.</p>
			<a class="send call-btn" href={`tel:${tel}`} onclick={() => onsent?.()}>Call now</a>
		</div>
	{:else}
		<!-- Shaded compose area so the message box reads as its own block, with the
		     Send button sitting right beneath the input. Email posts to the shared
		     send action; Text has no server component and stays a plain div. -->
		<form
			class="compose-box"
			method="POST"
			action="?/sendEmail"
			use:enhance={({ cancel, formData }) => {
				// The demo never posts to the send action — real or simulated. The
				// server refuses it anyway; this just spares the round-trip when a
				// stale page still has a submit path.
				if (demoAccount && method === 'email') {
					cancel();
					sendError = 'Email sending is disabled in the demo';
					return;
				}
				// Read and clear together: the flag must never survive into a later
				// submit, or a real send would quietly become a simulated one.
				const simulate = pendingSimulate;
				pendingSimulate = '';
				const simulating = simulate !== '';
				// Stamped on explicitly rather than inherited from the submit button, so
				// the field's presence is decided here and not by form-submission
				// mechanics. A simulated run posts even where no provider is configured
				// — exercising this path without one is the point of it.
				if (simulating) formData.set('simulate', simulate);
				else formData.delete('simulate');
				// Text is handled client-side, and an unconfigured install has nothing
				// to post to — both take the handoff instead of a round-trip.
				if (method !== 'email') {
					cancel();
					sendText();
					return;
				}
				if (!sendingConfigured && !simulating) {
					cancel();
					openInMailClient();
					return;
				}
				sending = true;
				sendError = '';
				return async ({ result, update }) => {
					sending = false;
					if (result.type === 'success') {
						const d = result.data as { recorded?: boolean } | undefined;
						subject = '';
						body = '';
						templateId = '';
						// Close first, then confirm. The confirmation used to render inside
						// this card, which meant it appeared under the channel picker of
						// the widget that had just finished its job. The toast outlives the
						// composer, so the card can go away the moment the send lands.
						onsent?.();
						toast.success(`Email sent to ${customer.name}`, {
							detail: d?.recorded ? "Added to this order's timeline." : undefined
						});
						return;
					}
					if (result.type === 'failure') {
						const d = result.data as
							{ message?: string; subject?: string; body?: string } | undefined;
						sendError = d?.message ?? 'That did not send';
						// Keep the composed message so the fallback needs no retyping.
						failedSubject = d?.subject ?? '';
						failedBody = d?.body ?? '';
						return;
					}
					await update();
				};
			}}
		>
			{#if method === 'email'}
				<input type="hidden" name="customerEmail" value={customer.email} />
				<input type="hidden" name="customerName" value={customer.name} />
				<input type="hidden" name="project" value={project ?? ''} />
				{#if orderId}<input type="hidden" name="orderId" value={orderId} />{/if}
				{#if templates.length > 0}
					<label class="picker">
						<span class="picker-label">Template</span>
						<select
							value={templateId}
							onchange={(e) => applyTemplate((e.currentTarget as HTMLSelectElement).value)}
						>
							<option value="">Start from scratch…</option>
							{#each templates as t (t.id)}
								<option value={t.id}>{t.name}</option>
							{/each}
						</select>
					</label>
				{/if}
				<input
					bind:value={subject}
					name="subject"
					class="composer-subject"
					placeholder="Subject"
					aria-label="Email subject"
				/>
				<textarea
					bind:value={body}
					name="body"
					{rows}
					placeholder="Write a message to {customer.name}…"
					class="composer-text"></textarea>
				{#if settings.signature.trim()}
					<span class="sig-note">Your signature is added automatically.</span>
				{/if}
				{#if sendError}
					<!-- The message is still in the fields above; the fallback carries the
					     version the server composed, so nothing has to be retyped. -->
					<p class="send-error" role="alert">
						{sendError}.
						<button
							type="button"
							class="fallback-link"
							onclick={() => openInMailClient(failedSubject, failedBody)}
						>
							Open in your mail client instead
						</button>
					</p>
				{/if}
			{:else}
				<textarea
					bind:value={text}
					{rows}
					placeholder="Write a message to {customer.name}…"
					class="composer-text"></textarea>
				<span class="sig-note">Opens in your messaging app and sends as a normal text.</span>
			{/if}
			<div class="foot">
				{#if method === 'email' && demoAccount}
					<!-- The demo showcases the composer, not the send pipeline: only real,
					     verified accounts send mail from the app. -->
					<span class="demo-note">Email sending is off in the demo</span>
				{:else if method === 'email' && devTools}
					<!-- EMAIL_DEV_TOOLS only. Simulation and real sending are mutually
					     exclusive — a server in this mode refuses real sends outright —
					     so the mock pair stands where the real Send would be, instead of
					     a disabled Send with the real controls exiled to a strip below. -->
					<div class="sim-group" role="group" aria-label="Simulated send (dev tools)">
						<span class="sim-label">Simulation</span>
						<button
							type="submit"
							class="devsend ok"
							onclick={() => (pendingSimulate = 'success')}
							disabled={!canSend || sending}
							>{#if sending}Sending…{:else}Send · mock success{/if}</button
						>
						<button
							type="submit"
							class="devsend fail"
							onclick={() => (pendingSimulate = 'failure')}
							disabled={!canSend || sending}>Send · mock fail</button
						>
					</div>
				{:else}
					<button type="submit" class="send" disabled={!canSend || sending}>
						{#if sending}Sending…{:else}Send {method === 'text' ? 'text' : 'email'}{/if}
					</button>
				{/if}
			</div>
		</form>
	{/if}
</div>

<style>
	.composer {
		display: grid;
		gap: 0.55rem;
	}
	.composer-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.composer-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: #1f2328;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Red cancel affordance so it reads clearly as "close / discard". */
	.close {
		flex-shrink: 0;
		width: 1.7rem;
		height: 1.7rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #f0c0c4;
		border-radius: 999px;
		background: #fdeff0;
		color: #cf222e;
		font-size: 0.85rem;
		line-height: 1;
		cursor: pointer;
	}
	.close:hover {
		background: #cf222e;
		border-color: #cf222e;
		color: #fff;
	}
	/* Shaded, inset panel so the message box is visually distinct from whatever
	   card/popover the composer sits inside.

	   Every channel renders inside the same box at the same minimum height: the
	   body textarea flex-grows to soak up whatever the other rows don't use, so
	   the message is readable without scrolling, and switching email → text →
	   call doesn't drastically resize the card. */
	.compose-box {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem;
		box-sizing: border-box;
		min-height: 19rem;
		background: #f6f8fa;
		border: 1px solid #e4e8ee;
		border-radius: 10px;
		box-shadow: inset 0 1px 2px rgba(27, 31, 36, 0.05);
	}
	.picker {
		display: grid;
		gap: 0.25rem;
	}
	.picker-label {
		font-size: 0.78rem;
		color: #57606a;
		font-weight: 600;
	}
	/* Fields share the app recipe: hairline border, softly sunken well that lifts
	   on focus, yellow focus ring (the transition comes from app.css). */
	.picker select {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--field-border);
		border-radius: 10px;
		font-size: 0.9rem;
		font-family: inherit;
		color: #1f2328;
		background: var(--field-bg);
	}
	.composer-subject {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--field-border);
		border-radius: 10px;
		font-size: 0.92rem;
		font-family: inherit;
		font-weight: 600;
		color: #1f2328;
		background: var(--field-bg);
	}
	.composer-text {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		/* The stretchy row: fills the pane's fixed footprint in every channel. */
		flex: 1 1 auto;
		min-height: 7.5rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--field-border);
		border-radius: 10px;
		font-size: 0.92rem;
		font-family: inherit;
		line-height: 1.5;
		color: #1f2328;
		background: var(--field-bg);
	}
	.picker select:focus,
	.composer-subject:focus,
	.composer-text:focus {
		outline: none;
		border-color: var(--yellow-deep);
		box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.22);
		background: var(--field-bg-focus);
	}
	.sig-note {
		font-size: 0.74rem;
		color: #8b949e;
	}
	/* The simulated-send pair, standing in for the real Send when EMAIL_DEV_TOOLS
	   is on. Dashed amber wrapper on purpose — it should never be mistaken for
	   part of the product by someone who left the flag on. */
	.sim-group {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.4rem;
		flex-wrap: wrap;
		padding: 0.35rem 0.45rem;
		border: 1px dashed #d4a72c;
		border-radius: 12px;
		background: #fffbe9;
	}
	.sim-label {
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #8a5a00;
		margin-right: 0.15rem;
	}
	.devsend {
		padding: 0.45rem 0.8rem;
		border: 1px solid transparent;
		border-radius: 10px;
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
	}
	.devsend.ok {
		background: var(--yellow);
		color: #14171c;
		box-shadow: var(--pop-shadow-sm);
	}
	.devsend.ok:hover:not(:disabled) {
		background: var(--yellow-deep);
	}
	.devsend.fail {
		background: none;
		border-color: #e5a3a3;
		color: #a40e26;
	}
	.devsend.fail:hover:not(:disabled) {
		background: #fdeff0;
	}
	.devsend:disabled {
		opacity: 0.45;
		cursor: default;
		box-shadow: none;
	}
	/* The demo's stand-in for Send: a statement, not a control. */
	.demo-note {
		font-size: 0.8rem;
		font-weight: 600;
		color: #8b949e;
	}
	/* A failed send, with the escape hatch inline. Red enough to notice, not so
	   loud that it reads as data loss — the message is still sitting right above. */
	.send-error {
		margin: 0;
		padding: 0.5rem 0.6rem;
		border: 1px solid #f0c0c4;
		border-radius: 8px;
		background: #fdeff0;
		color: #a40e26;
		font-size: 0.8rem;
		line-height: 1.45;
	}
	.fallback-link {
		padding: 0;
		border: 0;
		background: none;
		color: #a40e26;
		font: inherit;
		font-weight: 700;
		text-decoration: underline;
		cursor: pointer;
	}
	/* Call: same box, same footprint, content centred — a dial card rather than
	   one orphaned sentence. */
	.call-pane {
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 0.45rem;
	}
	.call-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		border-radius: 999px;
		background: #e6f4ea;
		border: 1px solid #b7e0c4;
		font-size: 1.3rem;
	}
	.call-number {
		font-size: 1.35rem;
		font-weight: 800;
		letter-spacing: 0.01em;
		font-variant-numeric: tabular-nums;
		color: #1f2328;
		overflow-wrap: anywhere;
	}
	.call-hint {
		margin: 0 0 0.4rem;
		font-size: 0.82rem;
		color: #8b949e;
	}
	/* One pill track, segments share the row equally — never wraps. */
	.methods {
		display: flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1px solid #e4e8ee;
		border-radius: 999px;
		background: #f0f2f5;
	}
	.chip {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-width: 0;
		padding: 0.42rem 0.4rem;
		border: none;
		border-radius: 999px;
		background: none;
		color: #57606a;
		font-family: inherit;
		font-weight: 700;
		font-size: 0.82rem;
		white-space: nowrap;
		cursor: pointer;
		transition:
			color 0.12s ease,
			background 0.12s ease,
			box-shadow 0.12s ease;
	}
	.chip:hover {
		color: #1f2328;
		background: rgba(17, 17, 17, 0.05);
	}
	/* The chosen channel takes the app's yellow accent. Pinned dark text: yellow
	   stays light in both themes. */
	.chip.sel,
	.chip.sel:hover {
		background: var(--yellow);
		color: #14171c;
		box-shadow: 0 1px 3px rgba(27, 31, 36, 0.18);
	}
	.star {
		margin-left: 0.1rem;
		color: #b78900;
		font-size: 0.75rem;
	}
	.chip.sel .star {
		color: #14171c;
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.9rem;
		flex-wrap: wrap;
	}
	/* The primary action button — the app's safety-yellow so it clearly reads as the
	   send CTA in both themes. (Call reuses the base but is green.) */
	.send {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.5rem 1.1rem;
		border: none;
		border-radius: 10px;
		background: var(--yellow);
		color: #14171c;
		font-weight: 700;
		font-size: 0.88rem;
		cursor: pointer;
		text-decoration: none;
		box-shadow: var(--pop-shadow-sm);
	}
	.send:hover:not(:disabled) {
		background: var(--yellow-deep);
	}
	.send:disabled {
		opacity: 0.45;
		cursor: default;
		box-shadow: none;
	}
	/* Call is a positive, one-tap action — green sets it apart from Send. */
	.call-btn {
		background: #1f883d;
		color: #fff;
	}
	.call-btn:hover {
		background: #1a7f37;
	}

	/* Dark theme */
	:global(:root[data-theme='dark']) .composer-title {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .compose-box {
		background: var(--surface-sunken);
		border-color: var(--line);
	}
	:global(:root[data-theme='dark']) .picker-label {
		color: var(--fg-muted);
	}
	/* Fields are token-driven above; dark only needs the text color. Kept off the
	   border/background so the focus rules can't be outranked. */
	:global(:root[data-theme='dark']) .picker select,
	:global(:root[data-theme='dark']) .composer-subject,
	:global(:root[data-theme='dark']) .composer-text {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .sig-note {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .sim-group {
		background: var(--surface-inset);
		border-color: #7a6a2a;
	}
	:global(:root[data-theme='dark']) .sim-label {
		color: #f3dfa0;
	}
	:global(:root[data-theme='dark']) .devsend.fail {
		border-color: #6b2f33;
		color: #ff8f8a;
	}
	:global(:root[data-theme='dark']) .devsend.fail:hover:not(:disabled) {
		background: #3a1f22;
	}
	:global(:root[data-theme='dark']) .demo-note {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .send-error {
		background: #3a1f24;
		border-color: #7a3540;
		color: #ffbcc4;
	}
	:global(:root[data-theme='dark']) .fallback-link {
		color: #ffbcc4;
	}
	:global(:root[data-theme='dark']) .call-glyph {
		background: #14301f;
		border-color: #2f6b45;
	}
	:global(:root[data-theme='dark']) .call-number {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .call-hint {
		color: var(--fg-muted);
	}
	/* Dark rules carve out .sel so they can't outrank the yellow selected state
	   on specificity — the selected segment is token-driven in both themes. */
	:global(:root[data-theme='dark']) .methods {
		background: var(--surface-inset);
		border-color: var(--line);
	}
	:global(:root[data-theme='dark']) .chip:not(.sel) {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .chip:not(.sel):hover {
		color: var(--fg);
		background: rgba(255, 255, 255, 0.07);
	}
</style>
