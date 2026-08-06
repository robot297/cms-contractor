<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import {
		composeEmail,
		EMAIL_BODY_LENGTH_GUIDANCE,
		EMAIL_TEMPLATE_PLACEHOLDERS,
		FOLLOWUP_DAY_CHOICES,
		followUpDaysLabel
	} from '$lib/crm';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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

	// Which tag is awaiting delete confirmation.
	let confirmingTag = $state<string | null>(null);

	// Default follow-up interval, seeded once like the signature fields above.
	let followUpDays = $state(untrack(() => data.followUpDays));
	const followUpDirty = $derived(followUpDays !== data.followUpDays);
</script>

<svelte:head><title>Email templates · Settings</title></svelte:head>

<div class="wrap">
	<h1 class="page-title">Email templates</h1>

	<!-- Placeholder reference -->
	<section class="card">
		<h2>Placeholders</h2>
		<ul class="chips">
			{#each EMAIL_TEMPLATE_PLACEHOLDERS as p (p.token)}
				<li><code>{`{{${p.token}}}`}</code> <span>{p.label}</span></li>
			{/each}
		</ul>
	</section>

	<!-- Tags. The vocabulary is derived from what's actually in use, so retiring one
	     means stripping it off every record that carries it — which is why it asks. -->
	<section class="card">
		<h2>Tags</h2>
		{#if data.contractorTags.length === 0}
			<p class="tags-none">
				No tags yet. Add them on an order or subcontractor and they'll collect here.
			</p>
		{:else}
			<p class="tags-hint">
				Used across your orders and subcontractors. Deleting one removes it from every record that
				uses it.
			</p>
			<ul class="tag-list">
				{#each data.contractorTags as tag (tag)}
					<li>
						<span class="tag-name">{tag}</span>
						{#if confirmingTag === tag}
							<form
								method="POST"
								action="?/deleteTag"
								use:enhance={() =>
									async ({ update }) => {
										confirmingTag = null;
										await update();
									}}
							>
								<input type="hidden" name="tag" value={tag} />
								<button type="submit" class="tag-yes">Delete everywhere</button>
							</form>
							<button type="button" class="tag-no" onclick={() => (confirmingTag = null)}
								>Cancel</button
							>
						{:else}
							<button
								type="button"
								class="tag-del"
								aria-label={`Delete tag ${tag}`}
								onclick={() => (confirmingTag = tag)}>Delete</button
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Default follow-up interval. Applies to orders created from here on: the
	     follow-ups already on the dashboard may have been moved by hand. -->
	<section class="card">
		<h2>Follow-up reminders</h2>
		<p class="tags-hint">
			Every new order schedules a reminder this far out. When one comes due it appears at the top of
			your dashboard. You can always snooze or re-date a single order from the order itself.
		</p>
		<form method="POST" action="?/saveFollowUpDays" use:enhance={keepFields} class="grid">
			<label class="field">
				<span>Remind me after</span>
				<select name="followUpDays" bind:value={followUpDays}>
					{#each FOLLOWUP_DAY_CHOICES as days (days)}
						<option value={days}>{followUpDaysLabel(days)}</option>
					{/each}
				</select>
			</label>
			<div class="row-actions">
				<button
					type="submit"
					class="btn primary"
					disabled={!followUpDirty}
					title={followUpDirty ? 'Save interval' : 'No changes to save'}>Save interval</button
				>
				{#if form?.saved === 'followUp' && !followUpDirty}<span class="ok">Saved ✓</span>{/if}
			</div>
			<p class="followup-note">
				Changing this leaves follow-ups already scheduled where they are — only new orders use the
				new interval.
			</p>
		</form>
	</section>

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
						<span class="preview-label">Preview</span>
						{#if createPreview.subject}<div class="preview-subject">
								{createPreview.subject}
							</div>{/if}
						<pre>{createPreview.body || '—'}</pre>
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
									<span class="preview-label">Preview</span>
									{#if editPreview.subject}<div class="preview-subject">
											{editPreview.subject}
										</div>{/if}
									<pre>{editPreview.body || '—'}</pre>
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
										<button type="button" class="btn" onclick={() => (confirmingId = null)}
											>No</button
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
</div>

<style>
	.wrap {
		max-width: 760px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
		display: grid;
		gap: 1.1rem;
	}
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
	.field input,
	.field select,
	.field textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.65rem;
		border: 1.5px solid #d9dde3;
		border-radius: 10px;
		font-size: 0.92rem;
		font-family: inherit;
		color: #1f2328;
	}
	.field textarea {
		resize: vertical;
	}
	.field input:focus,
	.field select:focus,
	.field textarea:focus {
		outline: none;
		border-color: #a98be2;
		box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
	}
	.preview {
		background: #f9fafb;
		border: 1px dashed #d9dde3;
		border-radius: 10px;
		padding: 0.7rem 0.8rem;
		display: grid;
		gap: 0.3rem;
	}
	.preview-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #8b949e;
		font-weight: 700;
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
		border-color: #14171c;
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
	:global(:root[data-theme='dark']) .field input,
	:global(:root[data-theme='dark']) .field select,
	:global(:root[data-theme='dark']) .field textarea {
		background: var(--field-bg);
		border-color: var(--field-border);
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
	.tags-hint,
	.tags-none {
		margin: 0;
		font-size: 0.85rem;
		color: var(--fg-muted);
		line-height: 1.5;
	}
	/* Quieter than the hint above the control: it answers "what happens to the
	   follow-ups I already have", which only matters once you've changed it. */
	.followup-note {
		margin: 0;
		font-size: 0.78rem;
		color: var(--fg-muted);
		line-height: 1.45;
	}
	.tag-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
	}
	.tag-list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-sunken);
	}
	.tag-name {
		flex: 1;
		min-width: 0;
		font-size: 0.85rem;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.tag-del,
	.tag-no {
		border: none;
		background: none;
		padding: 0.2rem 0.4rem;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
	}
	.tag-del:hover {
		color: var(--danger);
	}
	.tag-no:hover {
		color: var(--fg);
	}
	.tag-yes {
		border: 1px solid var(--danger);
		background: var(--danger);
		color: #fff;
		border-radius: 999px;
		padding: 0.25rem 0.7rem;
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
	}
</style>
