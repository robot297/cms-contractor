<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { composeEmail, normalizePreferredContact, renderTemplate } from '$lib/crm';

	let {
		customer,
		project,
		rows = 3,
		onsent,
		onclose
	}: {
		customer: { name: string; email: string; phone: string | null; preferredContact: string };
		/** Order project name, used to resolve `{{project}}`. Omitted off order surfaces. */
		project?: string | null;
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
	};
	const data = $derived(page.data as unknown as ComposerData);
	const templates = $derived(data.emailTemplates ?? []);
	const settings = $derived(data.contractorSettings ?? { businessName: '', signature: '' });

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

	function send() {
		if (method === 'text' && customer.phone) {
			if (!text.trim()) return;
			const smsBody = encodeURIComponent(text.trim());
			window.location.href = `sms:${tel}?&body=${smsBody}`;
			onsent?.();
			return;
		}
		// Email: resolve any remaining placeholders and append the signature.
		if (!body.trim()) return;
		const composed = composeEmail({ subject, body }, vars, settings.signature);
		const q: string[] = [];
		if (composed.subject.trim()) q.push(`subject=${encodeURIComponent(composed.subject)}`);
		q.push(`body=${encodeURIComponent(composed.body)}`);
		window.location.href = `mailto:${customer.email}?${q.join('&')}`;
		onsent?.();
	}

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

	<!-- Channel selector first: the customer's preferred channel is pre-selected. -->
	<div class="methods">
		<span class="via">Contact via</span>
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
		<!-- Call has nothing to compose: just the number + a dial action. -->
		<p class="call-note">Call {customer.name} at <strong>{customer.phone}</strong>.</p>
		<div class="foot">
			<a class="send call-btn" href={`tel:${tel}`} onclick={() => onsent?.()}>📞 Call now</a>
		</div>
	{:else}
		<!-- Shaded compose area so the message box reads as its own block, with the
		     Send button sitting right beneath the input. -->
		<div class="compose-box">
			{#if method === 'email'}
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
					class="composer-subject"
					placeholder="Subject"
					aria-label="Email subject"
				/>
				<textarea
					bind:value={body}
					{rows}
					placeholder="Write a message to {customer.name}…"
					class="composer-text"></textarea>
				{#if settings.signature.trim()}
					<span class="sig-note">Your signature is added automatically.</span>
				{/if}
			{:else}
				<textarea
					bind:value={text}
					{rows}
					placeholder="Write a message to {customer.name}…"
					class="composer-text"></textarea>
			{/if}
			<div class="foot">
				<button type="button" class="send" onclick={send} disabled={!canSend}>
					Send {method === 'text' ? 'text' : 'email'}
				</button>
			</div>
		</div>
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
	   card/popover the composer sits inside. */
	.compose-box {
		display: grid;
		gap: 0.5rem;
		padding: 0.6rem;
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
	.picker select {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.6rem;
		border: 1.5px solid #d9dde3;
		border-radius: 10px;
		font-size: 0.9rem;
		font-family: inherit;
		color: #1f2328;
		background: #fff;
	}
	.picker select:focus {
		outline: none;
		border-color: #a98be2;
		box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
	}
	.composer-subject {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.65rem;
		border: 1.5px solid #d9dde3;
		border-radius: 10px;
		font-size: 0.92rem;
		font-family: inherit;
		font-weight: 600;
		color: #1f2328;
	}
	.composer-subject:focus {
		outline: none;
		border-color: #a98be2;
		box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
	}
	.composer-text {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		padding: 0.55rem 0.65rem;
		border: 1.5px solid #d9dde3;
		border-radius: 10px;
		font-size: 0.92rem;
		font-family: inherit;
		color: #1f2328;
	}
	.composer-text:focus {
		outline: none;
		border-color: #a98be2;
		box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
	}
	.sig-note {
		font-size: 0.74rem;
		color: #8b949e;
	}
	.call-note {
		margin: 0;
		padding: 0.6rem 0.65rem;
		border: 1.5px solid #d9dde3;
		border-radius: 10px;
		background: #f9fafb;
		font-size: 0.9rem;
		color: #1f2328;
	}
	.methods {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.via {
		font-size: 0.78rem;
		color: #57606a;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.35rem 0.7rem;
		border: 1.5px solid #d9dde3;
		border-radius: 999px;
		background: #fff;
		color: #1f2328;
		font-weight: 600;
		font-size: 0.82rem;
		cursor: pointer;
		transition:
			border-color 0.12s ease,
			background 0.12s ease;
	}
	.chip:hover {
		background: #f6f8fa;
	}
	/* The chosen channel: shaded + ringed so the selection is obvious. */
	.chip.sel {
		background: #ede7fb;
		border-color: #a98be2;
		color: #4b2fa8;
	}
	.star {
		margin-left: 0.15rem;
		color: #b78900;
		font-size: 0.78rem;
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
		border: 2px solid #14171c;
		border-radius: 10px;
		background: var(--yellow);
		color: #14171c;
		font-weight: 800;
		font-size: 0.88rem;
		cursor: pointer;
		text-decoration: none;
	}
	.send:hover:not(:disabled) {
		background: var(--yellow-deep);
	}
	.send:disabled {
		opacity: 0.45;
		cursor: default;
	}
	/* Call is a positive, one-tap action — green sets it apart from Send. */
	.call-btn {
		background: #1f883d;
		border-color: #146c2e;
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
	:global(:root[data-theme='dark']) .picker select {
		background: var(--field-bg);
		border-color: var(--field-border);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .composer-subject {
		background: var(--field-bg);
		border-color: var(--field-border);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .composer-text {
		background: var(--field-bg);
		border-color: var(--field-border);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .sig-note {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .call-note {
		background: var(--surface-sunken);
		border-color: var(--line);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .via {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .chip {
		background: var(--surface-sunken);
		border-color: var(--line-strong);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .chip:hover {
		background: #2c333d;
	}
	/* Selected channel: a clearly brighter purple so the choice is obvious. */
	:global(:root[data-theme='dark']) .chip.sel {
		background: #4a3f7a;
		border-color: #8271c8;
		color: #ece7fb;
	}
</style>
