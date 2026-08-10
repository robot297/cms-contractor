<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { composeEmail, EMAIL_BODY_LENGTH_GUIDANCE, EMAIL_TEMPLATE_PLACEHOLDERS } from '$lib/crm';
	import { renderEmail } from '$lib/email';
	import type { EmailTemplatesData, EmailTemplatesForm } from '$lib/email-templates.types';

	let { data, form }: { data: EmailTemplatesData; form: EmailTemplatesForm } = $props();

	// Sample values used to preview how placeholders resolve. Contractor name comes
	// from the (live-editable) business-name field so the preview tracks edits.
	const SAMPLE = { customer: 'Jordan Rivera', project: 'Backyard Pergola' };

	// Signature / branding editor state, seeded once from saved settings (untrack:
	// we intentionally hold local edits rather than snap back when `data` reloads).
	let businessName = $state(untrack(() => data.businessName));
	let signature = $state(untrack(() => data.signature));

	// Accordion state: one template expanded (for editing) at a time, or the
	// create panel open. Both are mutually exclusive so the page stays compact.
	let openId = $state<string | null>(null);
	let creating = $state(false);
	let confirmingId = $state<string | null>(null);

	// Live edit buffers for whichever template is open — they drive the preview.
	let editName = $state('');
	let editSubject = $state('');
	let editBody = $state('');

	// New-template buffers.
	let newName = $state('');
	let newSubject = $state('');
	let newBody = $state('');

	function openEdit(t: { id: string; name: string; subject: string; body: string }) {
		openId = openId === t.id ? null : t.id;
		creating = false;
		confirmingId = null;
		editName = t.name;
		editSubject = t.subject;
		editBody = t.body;
	}

	/**
	 * Every field on this page is `bind:value`-bound to component state, so the
	 * form element is a view of that state rather than the source of truth.
	 * `update()` defaults to calling the native form.reset(), which rewrites the
	 * DOM inputs without firing `input` events — Svelte never hears about it, and
	 * the inputs silently drift out of sync with the state driving the preview and
	 * the dirty checks (it only looked right again after a reload). Opting out of
	 * the reset keeps the two in agreement; `invalidateAll` still refreshes `data`.
	 */
	const keepFields =
		() =>
		async ({ update }: { update: (o?: object) => Promise<void> }) =>
			await update({ reset: false });

	function openCreate() {
		creating = true;
		openId = null;
		confirmingId = null;
		newName = '';
		newSubject = '';
		newBody = '';
	}

	// Save buttons stay inert until their form actually differs from what's saved,
	// so an active button always means "there is a pending change".
	// Trim-compared because the action trims before saving — otherwise a stray
	// trailing space would leave the button armed forever after a successful save.
	const signatureDirty = $derived(
		businessName.trim() !== data.businessName || signature.trim() !== data.signature
	);
	const openTemplate = $derived(data.templates.find((t) => t.id === openId) ?? null);
	const editDirty = $derived(
		openTemplate != null &&
			editName.trim() !== '' &&
			(editName.trim() !== openTemplate.name ||
				editSubject.trim() !== openTemplate.subject ||
				editBody.trim() !== openTemplate.body)
	);
	const createDirty = $derived(newName.trim() !== '');

	const editPreview = $derived(
		composeEmail(
			{ subject: editSubject, body: editBody },
			{ ...SAMPLE, contractor: businessName },
			signature
		)
	);
	const createPreview = $derived(
		composeEmail(
			{ subject: newSubject, body: newBody },
			{ ...SAMPLE, contractor: businessName },
			signature
		)
	);

	// The formatted preview is the send path's own output — same renderer, same
	// branding — so what's on screen is what lands in the inbox rather than an
	// approximation of it. See docs/adr/0007-the-app-sends-email-mailto-is-the-fallback.md.
	const branding = $derived({ businessName, signature });
	const editHtml = $derived(
		renderEmail(
			{ subject: editSubject, body: editBody },
			{ ...SAMPLE, contractor: businessName },
			branding
		).html
	);
	const createHtml = $derived(
		renderEmail(
			{ subject: newSubject, body: newBody },
			{ ...SAMPLE, contractor: businessName },
			branding
		).html
	);
	// One toggle for the page: the accordion only ever has a single panel open.
	let previewMode = $state<'html' | 'text'>('html');
</script>

<!-- Preview header, shared by the create and edit panels: a label plus the
     formatted/plain-text switch. Both parts are sent, so both are viewable. -->
{#snippet previewHead()}
	<div class="preview-head">
		<span class="preview-label">Preview</span>
		<div class="preview-switch">
			<button
				type="button"
				class:on={previewMode === 'html'}
				aria-pressed={previewMode === 'html'}
				onclick={() => (previewMode = 'html')}>Formatted</button
			>
			<button
				type="button"
				class:on={previewMode === 'text'}
				aria-pressed={previewMode === 'text'}
				onclick={() => (previewMode = 'text')}>Plain text</button
			>
		</div>
	</div>
{/snippet}

<!-- Signature / branding -->
<section class="card">
	<h2>Signature &amp; branding</h2>
	<form method="POST" action="?/saveSignature" use:enhance={keepFields} class="grid">
		<label class="field">
			<span>Business name</span>
			<input
				name="businessName"
				bind:value={businessName}
				placeholder="e.g. Oak &amp; Iron Builds"
			/>
		</label>
		<label class="field">
			<span>Signature</span>
			<textarea
				name="signature"
				bind:value={signature}
				rows="3"
				placeholder="Thanks so much,&#10;{`{{contractor}}`}"></textarea>
		</label>
		<div class="preview">
			<span class="preview-label">Signature preview</span>
			<pre>{composeEmail(
					{ subject: '', body: '' },
					{ ...SAMPLE, contractor: businessName },
					signature
				).body || '—'}</pre>
		</div>
		<div class="row-actions">
			<button
				type="submit"
				class="btn primary"
				disabled={!signatureDirty}
				title={signatureDirty ? 'Save signature' : 'No changes to save'}>Save signature</button
			>
			{#if form?.saved === 'signature' && !signatureDirty}<span class="ok">Saved ✓</span>{/if}
		</div>
	</form>
</section>

<!-- Templates: an accordion — pick one to expand + edit -->
<section class="card">
	<div class="card-head">
		<h2>Templates</h2>
		<button type="button" class="btn primary" onclick={openCreate}>＋ New</button>
	</div>

	{#if creating}
		<div class="editor">
			<form
				method="POST"
				action="?/createTemplate"
				use:enhance={() =>
					async ({ update, result }) => {
						await update({ reset: false });
						if (result.type === 'success') creating = false;
					}}
				class="grid"
			>
				<label class="field">
					<span>Name</span>
					<input name="name" bind:value={newName} placeholder="e.g. Follow-up" required />
				</label>
				<label class="field">
					<span>Subject</span>
					<input
						name="subject"
						bind:value={newSubject}
						placeholder="Following on {`{{project}}`}"
					/>
				</label>
				<label class="field">
					<span>Body</span>
					<textarea
						name="body"
						bind:value={newBody}
						rows="5"
						placeholder="Hi {`{{customer}}`},&#10;&#10;…"></textarea>
					<small class="muted"
						>Keep under ~{EMAIL_BODY_LENGTH_GUIDANCE.toLocaleString()} characters — some mail apps trim
						long <code>mailto:</code> messages.</small
					>
				</label>
				<div class="preview">
					{@render previewHead()}
					{#if createPreview.subject}<div class="preview-subject">
							{createPreview.subject}
						</div>{/if}
					{#if previewMode === 'html'}
						<iframe
							class="preview-frame"
							title="Formatted email preview"
							sandbox=""
							srcdoc={createHtml}
						></iframe>
					{:else}
						<pre>{createPreview.body || '—'}</pre>
					{/if}
				</div>
				{#if form?.action === 'create' && form?.message}
					<p class="err">{form.message}</p>
				{/if}
				<div class="row-actions">
					<button
						type="submit"
						class="btn primary"
						disabled={!createDirty}
						title={createDirty ? 'Add template' : 'Give the template a name first'}
						>Add template</button
					>
					<button type="button" class="btn" onclick={() => (creating = false)}>Cancel</button>
				</div>
			</form>
		</div>
	{/if}

	{#if data.templates.length === 0 && !creating}
		<p class="muted">No templates yet.</p>
	{/if}

	<ul class="tlist">
		{#each data.templates as t, i (t.id)}
			<li class="titem" class:open={openId === t.id}>
				<div class="titem-head">
					<button type="button" class="titem-toggle" onclick={() => openEdit(t)}>
						<span class="chev">▸</span>
						<span class="titem-labels">
							<span class="tname">{t.name}</span>
							<span class="tsubject">{t.subject || 'No subject'}</span>
						</span>
					</button>
					<div class="titem-reorder">
						<form method="POST" action="?/reorderTemplate" use:enhance>
							<input type="hidden" name="id" value={t.id} />
							<input type="hidden" name="direction" value="up" />
							<button
								class="icon-btn"
								style="width: 1.9rem; height: 1.9rem; font-size: 0.9rem;"
								title="Move up"
								disabled={i === 0}>↑</button
							>
						</form>
						<form method="POST" action="?/reorderTemplate" use:enhance>
							<input type="hidden" name="id" value={t.id} />
							<input type="hidden" name="direction" value="down" />
							<button
								class="icon-btn"
								style="width: 1.9rem; height: 1.9rem; font-size: 0.9rem;"
								title="Move down"
								disabled={i === data.templates.length - 1}>↓</button
							>
						</form>
					</div>
				</div>

				{#if openId === t.id}
					<div class="editor">
						<form
							method="POST"
							action="?/updateTemplate"
							use:enhance={() =>
								async ({ update, result }) => {
									await update({ reset: false });
									// Re-seed the buffers from the freshly-loaded row so a
									// still-open editor (e.g. after a failed save) shows what
									// is actually stored, not what was typed.
									const saved = data.templates.find((x) => x.id === t.id);
									if (saved) {
										editName = saved.name;
										editSubject = saved.subject;
										editBody = saved.body;
									}
									if (result.type === 'success') openId = null;
								}}
							class="grid"
						>
							<input type="hidden" name="id" value={t.id} />
							<label class="field">
								<span>Name</span>
								<input name="name" bind:value={editName} required />
							</label>
							<label class="field">
								<span>Subject</span>
								<input name="subject" bind:value={editSubject} placeholder="Subject" />
							</label>
							<label class="field">
								<span>Body</span>
								<textarea name="body" bind:value={editBody} rows="5"></textarea>
							</label>
							<div class="preview">
								{@render previewHead()}
								{#if editPreview.subject}<div class="preview-subject">
										{editPreview.subject}
									</div>{/if}
								{#if previewMode === 'html'}
									<iframe
										class="preview-frame"
										title="Formatted email preview"
										sandbox=""
										srcdoc={editHtml}
									></iframe>
								{:else}
									<pre>{editPreview.body || '—'}</pre>
								{/if}
							</div>
							<div class="row-actions">
								<button
									type="submit"
									class="btn primary"
									disabled={!editDirty}
									title={editDirty ? 'Save changes' : 'No changes to save'}>Save</button
								>
								<button type="button" class="btn" onclick={() => (openId = null)}>Cancel</button>
								<span class="spacer"></span>
								{#if confirmingId === t.id}
									<span class="confirm">Delete?</span>
									<button
										class="btn danger"
										type="submit"
										formaction="?/deleteTemplate"
										formnovalidate>Yes</button
									>
									<button type="button" class="btn" onclick={() => (confirmingId = null)}>No</button
									>
								{:else}
									<button
										type="button"
										class="btn danger-ghost"
										onclick={() => (confirmingId = t.id)}>Delete</button
									>
								{/if}
							</div>
						</form>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<!-- Placeholder reference. Last, not first: it's a lookup table you glance at
     while writing a template, not the headline of the page. -->
<section class="card">
	<h2>Placeholders</h2>
	<ul class="chips">
		{#each EMAIL_TEMPLATE_PLACEHOLDERS as p (p.token)}
			<li><code>{`{{${p.token}}}`}</code> <span>{p.label}</span></li>
		{/each}
	</ul>
</section>

<style>
	.card h2 {
		margin: 0 0 0.6rem;
		font-size: 1.05rem;
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.6rem;
	}
	.card-head h2 {
		margin: 0;
	}
	.muted {
		color: #8b949e;
		font-size: 0.82rem;
	}
	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.chips li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: #f6f8fa;
		border: 1px solid #e4e8ee;
		border-radius: 999px;
		padding: 0.25rem 0.6rem;
		font-size: 0.82rem;
	}
	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		background: #eef1f5;
		border-radius: 5px;
		padding: 0.05rem 0.3rem;
		font-size: 0.82em;
	}
	.grid {
		display: grid;
		gap: 0.75rem;
	}
	.field {
		display: grid;
		gap: 0.3rem;
	}
	.field > span {
		font-size: 0.8rem;
		font-weight: 600;
		color: #57606a;
	}
	/* App-wide field recipe: hairline border, sunken well that lifts on focus,
	   yellow ring. Token-driven so dark needs no border/background override. */
	.field input,
	.field textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--field-border);
		border-radius: 10px;
		font-size: 0.92rem;
		font-family: inherit;
		color: #1f2328;
		background: var(--field-bg);
	}
	.field textarea {
		resize: vertical;
	}
	.field input:focus,
	.field textarea:focus {
		outline: none;
		border-color: var(--yellow-deep);
		box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.22);
		background: var(--field-bg-focus);
	}
	.preview {
		background: #f9fafb;
		border: 1px dashed #d9dde3;
		border-radius: 10px;
		padding: 0.7rem 0.8rem;
		display: grid;
		gap: 0.3rem;
	}
	.preview-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.preview-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #8b949e;
		font-weight: 700;
	}
	/* Segmented switch between the two parts of the same message. */
	.preview-switch {
		display: flex;
		gap: 0.15rem;
		padding: 0.1rem;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--surface);
	}
	.preview-switch button {
		border: none;
		background: none;
		border-radius: 999px;
		padding: 0.18rem 0.6rem;
		font-family: inherit;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.preview-switch button.on {
		background: var(--yellow);
		/* Pinned dark: yellow stays light in both themes. */
		color: #14171c;
	}
	/* The email renders in its own document, so app.css can't leak into it and the
	   preview is the real thing rather than a styled approximation. */
	.preview-frame {
		width: 100%;
		height: 340px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #f6f8fa;
	}
	.preview-subject {
		font-weight: 700;
		font-size: 0.9rem;
	}
	.preview pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: inherit;
		font-size: 0.9rem;
		color: #1f2328;
		line-height: 1.45;
	}
	/* Template accordion */
	.tlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.titem {
		border: 1.5px solid #e4e8ee;
		border-radius: 12px;
		overflow: hidden;
	}
	.titem.open {
		border-color: #cdbff0;
	}
	.titem-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem 0.35rem 0.2rem;
	}
	.titem-toggle {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: none;
		background: none;
		cursor: pointer;
		padding: 0.4rem 0.4rem;
		text-align: left;
		border-radius: 8px;
	}
	.titem-toggle:hover {
		background: #f6f8fa;
	}
	.chev {
		color: #8b949e;
		font-size: 0.8rem;
		transition: transform 0.15s ease;
		flex-shrink: 0;
	}
	.titem.open .chev {
		transform: rotate(90deg);
	}
	.titem-labels {
		min-width: 0;
		display: grid;
		gap: 0.1rem;
	}
	.tname {
		font-weight: 700;
		font-size: 0.95rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tsubject {
		color: #57606a;
		font-size: 0.82rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.titem-reorder {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}
	.editor {
		border-top: 1.5px solid #eef1f4;
		padding: 0.85rem 0.9rem;
	}
	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.spacer {
		flex: 1;
	}
	.confirm {
		font-weight: 700;
		font-size: 0.85rem;
		color: #cf222e;
	}
	/* Token-driven in both themes on purpose. A `[data-theme='dark'] .btn` override
	   would carry higher specificity than `.btn.primary` / `.btn:disabled` and quietly
	   repaint them in dark mode — which is exactly how the primary lost its colour and
	   the disabled state lost its fade. Tokens keep one rule per state. */
	.btn {
		padding: 0.4rem 0.75rem;
		border: 1.5px solid var(--field-border);
		border-radius: 9px;
		background: var(--surface);
		color: var(--fg);
		font-weight: 600;
		font-size: 0.82rem;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease;
	}
	.btn:hover:not(:disabled) {
		background: var(--surface-sunken);
	}
	/* Primary carries the app's safety-yellow accent in both themes rather than an
	   inverted near-white slab, which read as "lit up" against the dark UI. Yellow
	   is light in either theme, so its text/border stay pinned dark. */
	.btn.primary {
		background: var(--yellow);
		color: #14171c;
		/* Transparent, not none: keeps the box the same size as its siblings. */
		border-color: transparent;
		box-shadow: var(--pop-shadow-sm);
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--yellow-deep);
	}
	/* Nothing to commit → the accent drains away and the button goes flat, faded
	   and dashed-outlined, so "inert" is obvious at a glance rather than something
	   you discover by hovering. Listed per-variant so it outranks .btn.primary /
	   .btn.danger instead of losing on specificity. */
	.btn:disabled,
	.btn.primary:disabled,
	.btn.danger:disabled,
	.btn.danger-ghost:disabled {
		cursor: not-allowed;
		background: transparent;
		color: var(--fg-muted);
		border-color: var(--line);
		border-style: dashed;
		opacity: 0.7;
		box-shadow: none;
	}
	.btn.danger {
		background: #cf222e;
		color: #fff;
		border-color: #cf222e;
	}
	.btn.danger-ghost {
		color: #cf222e;
		border-color: #f0c0c4;
	}
	.btn.danger-ghost:hover:not(:disabled) {
		background: #fdeff0;
	}
	.ok {
		color: #1a7f37;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.err {
		color: #cf222e;
		font-size: 0.85rem;
		margin: 0;
	}

	/* Dark theme */
	:global(:root[data-theme='dark']) .muted {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .chips li {
		background: var(--surface-sunken);
		border-color: var(--line);
	}
	:global(:root[data-theme='dark']) code {
		background: var(--surface-sunken);
	}
	:global(:root[data-theme='dark']) .field > span {
		color: var(--fg-muted);
	}
	/* Border/background are token-driven above; only text color needs dark, and
	   keeping the rest out means the focus rules can't be outranked. */
	:global(:root[data-theme='dark']) .field input,
	:global(:root[data-theme='dark']) .field textarea {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .preview {
		background: var(--surface-inset);
		border-color: var(--line);
	}
	:global(:root[data-theme='dark']) .preview-label {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .preview pre {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .titem {
		border-color: var(--line);
	}
	:global(:root[data-theme='dark']) .titem.open {
		border-color: #4a3f6b;
	}
	:global(:root[data-theme='dark']) .titem-toggle:hover {
		background: var(--surface-sunken);
	}
	:global(:root[data-theme='dark']) .chev {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .tsubject {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .editor {
		border-top-color: var(--line);
	}
	/* Base .btn, .btn.primary and :disabled need no dark override — they're already
	   token-driven. The danger variants do, and they carve out :disabled so the
	   higher-specificity dark rule can't repaint a disabled button. */
	:global(:root[data-theme='dark']) .btn.danger:not(:disabled) {
		background: #b8323c;
		border-color: #b8323c;
	}
	:global(:root[data-theme='dark']) .btn.danger-ghost:not(:disabled) {
		color: #ff8f8a;
		border-color: #6b2f33;
		background: var(--surface);
	}
	:global(:root[data-theme='dark']) .btn.danger-ghost:hover:not(:disabled) {
		background: #3a1f22;
	}
	:global(:root[data-theme='dark']) .confirm {
		color: #ff8f8a;
	}
	:global(:root[data-theme='dark']) .err {
		color: #ff8f8a;
	}
	:global(:root[data-theme='dark']) .ok {
		color: #4ac26b;
	}
</style>
