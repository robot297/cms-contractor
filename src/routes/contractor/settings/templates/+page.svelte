<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { composeEmail, EMAIL_BODY_LENGTH_GUIDANCE, EMAIL_TEMPLATE_PLACEHOLDERS } from '$lib/crm';
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

	function openCreate() {
		creating = true;
		openId = null;
		confirmingId = null;
		newName = '';
		newSubject = '';
		newBody = '';
	}

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

	<!-- Signature / branding -->
	<section class="card">
		<h2>Signature &amp; branding</h2>
		<form method="POST" action="?/saveSignature" use:enhance class="grid">
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
				<button type="submit" class="btn primary">Save signature</button>
				{#if form?.saved === 'signature'}<span class="ok">Saved ✓</span>{/if}
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
							await update();
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
						<button type="submit" class="btn primary">Add template</button>
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
										await update();
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
									<button type="submit" class="btn primary">Save</button>
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
	.btn {
		padding: 0.4rem 0.75rem;
		border: 1.5px solid #d9dde3;
		border-radius: 9px;
		background: #fff;
		color: #1f2328;
		font-weight: 600;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.btn:hover {
		background: #f6f8fa;
	}
	.btn.primary {
		background: #1f2328;
		color: #fff;
		border-color: #1f2328;
	}
	.btn.primary:hover {
		background: #000;
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
	.btn.danger-ghost:hover {
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
	:global(:root[data-theme='dark']) .btn {
		background: var(--surface);
		border-color: var(--line-strong);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .btn:hover {
		background: var(--surface-sunken);
	}
	:global(:root[data-theme='dark']) .btn.primary {
		background: #e8ebf0;
		border-color: #e8ebf0;
		color: #14171c;
	}
	:global(:root[data-theme='dark']) .btn.primary:hover {
		background: #f4f6fa;
	}
</style>
