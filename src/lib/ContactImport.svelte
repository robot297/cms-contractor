<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import {
		contactIssue,
		contactsPicker,
		dedupeContacts,
		fromPickedContact,
		issueLabel,
		parseVCards,
		type ContactIssue,
		type ImportedContact,
		type ImportSummary
	} from '$lib/contact-import';

	/**
	 * Import customers from the contractor's own contacts.
	 *
	 * Two ways in, because no single one covers the devices this app is used on:
	 * the OS contact picker where the browser has one (Chromium on Android), and a
	 * vCard file everywhere else — which is what iOS, macOS, Google Contacts and
	 * Outlook all export to. Both end in the same review list.
	 *
	 * Nothing is read without the contractor choosing it, and nothing is saved
	 * without them ticking it. The OS picker hands back only the entries they
	 * selected in its own sheet; the file path only sees a file they picked. The
	 * review list in between exists so an address book of four hundred people
	 * doesn't become four hundred customers.
	 *
	 * The parsing lives in $lib/contact-import, where it is tested. This file is
	 * the choosing and the reviewing.
	 */

	let {
		existingEmails = [],
		remaining = null,
		onclose,
		onimported
	}: {
		/** Emails already in the directory, so repeats can be flagged, not created. */
		existingEmails?: string[];
		/** Customers a trial still has room for; null when uncapped. */
		remaining?: number | null;
		onclose: () => void;
		onimported: (summary: ImportSummary) => void;
	} = $props();

	/** Mirrors IMPORT_MAX in the page's server actions. */
	const IMPORT_MAX = 200;

	// `id` is what the list is keyed on. Keying on anything derived from the
	// contact would re-key the row as its email is typed into, which tears the
	// input out of the DOM and takes the caret with it.
	type Row = { id: number; contact: ImportedContact; selected: boolean };

	let stage: 'source' | 'review' = $state('source');
	let rows: Row[] = $state([]);
	let error = $state('');
	let busy = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();

	const picker = contactsPicker();
	const known = $derived(new Set(existingEmails.map((e) => e.trim().toLowerCase())));

	/** Recomputed as emails are typed in, so a filled-in row unblocks itself. */
	const issues = $derived(rows.map((row) => contactIssue(row.contact, known)));
	const selected = $derived(rows.filter((row, i) => row.selected && issues[i] === null));
	const duplicateCount = $derived(issues.filter((i) => i === 'duplicate').length);
	const overCap = $derived(remaining !== null && selected.length > remaining);
	const overMax = $derived(selected.length > IMPORT_MAX);
	const payload = $derived(JSON.stringify(selected.map((row) => row.contact)));

	function load(found: (ImportedContact | null)[]) {
		const contacts = dedupeContacts(found.filter((c): c is ImportedContact => c !== null));
		if (contacts.length === 0) {
			error = 'No contacts were found in that.';
			return;
		}
		error = '';
		contacts.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
		// Pre-ticked only where the contact is ready to go. Anything needing an
		// email, or already on file, starts unticked — the contractor opts in to it
		// rather than having to notice and opt out.
		rows = contacts.map((contact, id) => ({
			id,
			contact,
			selected: contactIssue(contact, known) === null
		}));
		stage = 'review';
	}

	/** The OS picker. Its own sheet is the permission prompt and the selection. */
	async function pickFromDevice() {
		if (!picker) return;
		busy = true;
		error = '';
		try {
			// Ask only for properties this browser actually supports — requesting an
			// unsupported one rejects the whole call rather than being ignored.
			const supported = await picker.getProperties();
			const wanted = ['name', 'email', 'tel', 'address'].filter((p) => supported.includes(p));
			const picked = await picker.select(wanted, { multiple: true });
			// An empty result is a cancelled sheet, not a failure. Say nothing.
			if (picked.length > 0) load(picked.map(fromPickedContact));
		} catch {
			error = 'Your contacts could not be opened. Import a vCard file instead.';
		} finally {
			busy = false;
		}
	}

	async function onFilePick(e: Event & { currentTarget: HTMLInputElement }) {
		const files = [...(e.currentTarget.files ?? [])];
		// Cleared so picking the same file twice in a row still fires a change.
		e.currentTarget.value = '';
		if (files.length === 0) return;
		busy = true;
		error = '';
		try {
			const texts = await Promise.all(files.map((f) => f.text()));
			load(texts.flatMap(parseVCards));
		} catch {
			error = 'That file could not be read.';
		} finally {
			busy = false;
		}
	}

	function setAll(value: boolean) {
		rows = rows.map((row, i) => ({ ...row, selected: value && issues[i] === null }));
	}

	/** One line of whatever this contact brought with it, under the name. */
	function detailLine(contact: ImportedContact): string {
		const place = [contact.city, contact.state].filter(Boolean).join(', ');
		return [contact.email, contact.phone, place].filter(Boolean).join(' · ');
	}

	function blocks(issue: ContactIssue): boolean {
		return issue !== null;
	}
</script>

<div class="wrap">
	<div class="head">
		<h2>Import contacts</h2>
		<button type="button" class="close" aria-label="Close" onclick={onclose}>✕</button>
	</div>

	{#if stage === 'source'}
		<!-- Two ways in, said in as few words as each needs. The permission prompt
		     and the review list are the real explanations; a paragraph in front of
		     them was just something to scroll past. -->
		<div class="sources">
			{#if picker}
				<button type="button" class="source primary" disabled={busy} onclick={pickFromDevice}>
					Choose from my contacts
				</button>
			{/if}
			<button type="button" class="source" disabled={busy} onclick={() => fileInput?.click()}>
				Import a .vcf file
			</button>
		</div>
		<!-- Kept out of the layout: the styled button above is what gets clicked. -->
		<input
			bind:this={fileInput}
			type="file"
			accept=".vcf,text/vcard,text/x-vcard,text/directory"
			multiple
			hidden
			onchange={onFilePick}
		/>
	{:else}
		<div class="tally">
			<span>
				<strong>{rows.length}</strong>
				{rows.length === 1 ? 'contact' : 'contacts'} found
				{#if duplicateCount > 0}
					· <strong>{duplicateCount}</strong> already yours
				{/if}
			</span>
			<span class="tally-actions">
				<button type="button" class="link" onclick={() => setAll(true)}>Select all</button>
				<button type="button" class="link" onclick={() => setAll(false)}>Clear</button>
			</span>
		</div>

		<ul class="rows">
			{#each rows as row, i (row.id)}
				{@const issue = issues[i]}
				{@const blocked = blocks(issue)}
				<li class="row" class:blocked>
					<input
						id="import-{i}"
						type="checkbox"
						bind:checked={row.selected}
						disabled={blocked}
						class="row-check"
					/>
					<div class="row-main">
						<label class="row-name" for="import-{i}">
							{row.contact.name || row.contact.email}
							{#if issue}<span class="flag" class:dupe={issue === 'duplicate'}
									>{issueLabel(issue)}</span
								>{/if}
						</label>
						{#if detailLine(row.contact) !== ''}
							<p class="row-sub">{detailLine(row.contact)}</p>
						{/if}
						{#if issue === 'no-email' || issue === 'bad-email'}
							<!-- A customer is identified by their email in this app, so a
							     contact without one gets somewhere to add it rather than
							     being dropped from the list. -->
							<input
								type="email"
								class="row-email"
								inputmode="email"
								placeholder="Email address"
								aria-label="Email for {row.contact.name || 'this contact'}"
								bind:value={row.contact.email}
							/>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if stage === 'review'}
		{#if overMax}
			<p class="warn">Up to {IMPORT_MAX} at a time.</p>
		{:else if overCap}
			<p class="warn">Your trial has room for {remaining} more.</p>
		{/if}

		<form
			method="POST"
			action="?/importCustomers"
			use:enhance={() => {
				busy = true;
				return async ({ result }) => {
					busy = false;
					if (result.type === 'failure') {
						error = String(result.data?.message ?? 'That import could not be saved.');
						return;
					}
					if (result.type !== 'success') {
						error = 'That import could not be saved.';
						return;
					}
					// The directory behind this dialog is now out of date.
					await invalidateAll();
					onimported(result.data as unknown as ImportSummary);
				};
			}}
			class="foot"
		>
			<input type="hidden" name="contacts" value={payload} />
			<button type="button" class="back" onclick={() => (stage = 'source')} disabled={busy}
				>Back</button
			>
			<button type="submit" class="go" disabled={busy || selected.length === 0 || overMax}>
				{busy ? 'Importing…' : `Import ${selected.length}`}
			</button>
		</form>
	{/if}
</div>

<style>
	.wrap {
		display: grid;
		gap: 0.75rem;
		padding: 1.25rem;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.head h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	.close {
		border: none;
		background: none;
		font-size: 1.2rem;
		line-height: 1;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.sources {
		display: grid;
		gap: 0.5rem;
	}
	.source {
		width: 100%;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 700;
		text-transform: none;
		letter-spacing: normal;
		cursor: pointer;
	}
	.source:hover:not(:disabled) {
		background: var(--surface-sunken);
		border-color: var(--fg-muted);
	}
	.source:disabled {
		opacity: 0.6;
		cursor: default;
	}
	/* Pinned dark on yellow: yellow stays light in both themes. */
	.source.primary {
		background: var(--yellow);
		border-color: transparent;
		color: var(--on-yellow);
	}
	.source.primary:hover:not(:disabled) {
		background: var(--yellow-deep);
		border-color: transparent;
	}

	.tally {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
		font-size: 0.82rem;
		color: var(--fg-muted);
	}
	.tally-actions {
		display: flex;
		gap: 0.75rem;
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: none;
		letter-spacing: normal;
		color: var(--fg-muted);
		text-decoration: underline;
		cursor: pointer;
	}
	.link:hover {
		color: var(--fg);
	}

	/* The list is the only thing that scrolls — the tally above and the import
	   button below stay put, so the count and the action are always in view. An
	   address book runs to hundreds of rows; the dialog must not. */
	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
		max-height: min(46vh, 22rem);
		overflow-y: auto;
		display: grid;
		gap: 0.15rem;
		border: 1px solid var(--line);
		border-radius: 10px;
	}
	.row {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.55rem 0.7rem;
		border-bottom: 1px solid var(--line);
	}
	.row:last-child {
		border-bottom: none;
	}
	.row.blocked {
		background: var(--surface-sunken);
	}
	.row-check {
		width: 1.05rem;
		height: 1.05rem;
		margin-top: 0.15rem;
		flex: none;
		accent-color: var(--yellow-deep);
		cursor: pointer;
	}
	.row-check:disabled {
		cursor: default;
	}
	.row-main {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.2rem;
	}
	.row-name {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--fg);
		cursor: pointer;
	}
	.row-sub {
		margin: 0;
		font-size: 0.78rem;
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}
	.flag {
		display: inline-block;
		margin-left: 0.35rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--surface-sunken);
		border: 1px solid var(--line-strong);
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--fg-muted);
		vertical-align: 1px;
	}
	/* Already on file is ordinary news; a missing email is something to act on. */
	.flag:not(.dupe) {
		border-color: var(--danger);
		color: var(--danger);
	}
	.row-email {
		width: 100%;
		max-width: 20rem;
		box-sizing: border-box;
		margin-top: 0.1rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--line-strong);
		border-radius: 8px;
		font-size: 0.85rem;
	}

	.error,
	.warn {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.45;
	}
	.error {
		color: var(--danger);
	}
	.warn {
		color: var(--fg-muted);
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.foot button {
		padding: 0.55rem 1.1rem;
		border-radius: 999px;
		font-family: inherit;
		font-size: 0.88rem;
		text-transform: none;
		letter-spacing: normal;
		cursor: pointer;
	}
	.back {
		border: none;
		background: none;
		color: var(--fg-muted);
		padding: 0.55rem 0.4rem;
		font-size: 0.85rem;
		margin-right: auto;
	}
	.back:hover {
		color: var(--fg);
	}
	.go {
		border: 1px solid transparent;
		background: var(--yellow);
		color: var(--on-yellow);
		font-weight: 700;
		box-shadow: var(--pop-shadow-sm);
	}
	.go:hover:not(:disabled) {
		background: var(--yellow-deep);
	}
	.go:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.foot button:focus-visible,
	.source:focus-visible {
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
</style>
