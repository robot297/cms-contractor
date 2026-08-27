<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import DocumentList from '$lib/DocumentList.svelte';
	import DocumentViewer from '$lib/DocumentViewer.svelte';
	import MessageComposer from '$lib/MessageComposer.svelte';
	import MessageThread from '$lib/MessageThread.svelte';
	import {
		customerProgress,
		formatBytes,
		isAllowedDocumentType,
		MAX_DOCUMENT_BYTES,
		splitFilename,
		timelineKindIcon,
		type CustomerVisibleState,
		type DocumentRef
	} from '$lib/crm';
	import { invoiceDate, paymentLineLabel } from '$lib/invoice';
	import { formatCents } from '$lib/crm';
	import { customerActionSummary, taskDueLabel, taskUrgency } from '$lib/tasks';
	import { todayIso } from '$lib/worker';
	import { onMount } from 'svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/**
	 * Today where the CUSTOMER is, not where the server is.
	 *
	 * Seeded during render so the server has something to send, then re-read on
	 * mount — the same pattern the contractor's surfaces use. It decides whether a
	 * task reads as "Due today" or "Overdue", and getting that wrong by a timezone
	 * tells somebody they are late when they are not.
	 */
	let now = $state(new Date());
	onMount(() => {
		now = new Date();
	});
	const today = $derived(todayIso(now));

	/**
	 * What is waiting on the customer, and the one sentence that says so.
	 *
	 * Computed by the shared `customerActionSummary` rather than here, because the
	 * contractor's workspace shows the same sentence as a preview of what their
	 * customer is being told — and a preview that can drift from the thing it
	 * previews is worse than none.
	 */
	const action = $derived(
		customerActionSummary({
			paymentDue: data.order.paymentDue,
			contractorName: data.order.contractorName,
			tasks: data.order.tasks,
			today
		})
	);

	/**
	 * The money, computed server-side by the same `invoiceSummary` the contractor's
	 * workspace and the emailed invoice use. The portal only chooses how to draw
	 * it — no arithmetic happens on this page, because a balance that disagrees
	 * with the one in the customer's inbox is the failure this whole arrangement
	 * exists to rule out.
	 */
	const invoice = $derived(data.order.invoice);
	const showInvoice = $derived(invoice.totalCents != null || invoice.payments.length > 0);

	// The draft, its send state and the ⌘↵ handling all live in MessageComposer.

	/** Two-step remove, matching every other destructive control in the app. */
	let confirmingRemoveId = $state<string | null>(null);

	let historyOpen = $state(false);
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	/**
	 * The batch waiting on the confirm step. Several files can be picked at once,
	 * each named and each removable — a camera roll's "IMG_4821.jpg" landing on
	 * the contractor unnamed is what the confirm step exists to prevent, and that
	 * has to survive picking five of them.
	 */
	type Picked = { file: File; stem: string; ext: string; previewUrl: string | null };
	let picked = $state<Picked[]>([]);
	let pickError = $state('');
	/**
	 * The document open in the viewer, or null. Every document goes through it —
	 * nothing links straight at the bytes, because that replaces the page with a
	 * bare file and leaves the back button as the only exit.
	 */
	let preview = $state<DocumentRef | null>(null);

	function onPick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const chosen = Array.from(input.files ?? []);
		pickError = '';
		const refused: string[] = [];
		for (const file of chosen) {
			// Pre-checked here so a doomed upload never leaves the browser; the server
			// re-checks both, because this half can be skipped. Per file, so one bad
			// pick does not discard the rest of the selection.
			if (!isAllowedDocumentType(file.type)) {
				refused.push(`${file.name} — images and PDFs only`);
				continue;
			}
			if (file.size > MAX_DOCUMENT_BYTES) {
				refused.push(`${file.name} — over ${formatBytes(MAX_DOCUMENT_BYTES)}`);
				continue;
			}
			const { stem, ext } = splitFilename(file.name);
			picked.push({
				file,
				stem,
				ext,
				previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
			});
		}
		if (refused.length > 0) pickError = refused.join(' · ');
		// Cleared so picking the same file again still fires a change event.
		input.value = '';
	}

	function removePick(index: number) {
		const [gone] = picked.splice(index, 1);
		if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
	}

	function clearPick() {
		for (const p of picked) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
		picked = [];
		pickError = '';
		if (fileInput) fileInput.value = '';
	}

	const order = $derived(data.order);
	const heading = $derived(order.projectName ?? 'Your project');
	const latest = $derived(order.timeline[0] ?? null);
	const older = $derived(order.timeline.slice(1));
	const progress = $derived(customerProgress(order.customerVisibleState as CustomerVisibleState));
	/** How far along the rail the fill runs — 0% on the first step, 100% on the last. */
	const fillPercent = $derived(
		progress.onPath && progress.steps.length > 1
			? (progress.currentIndex / (progress.steps.length - 1)) * 100
			: 0
	);

	const dateFmt = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
	/** "3 days ago" reads faster than a date when the question is "is this fresh". */
	function relative(iso: Date | string): string {
		const then = new Date(iso).getTime();
		const days = Math.floor((Date.now() - then) / 86400000);
		if (days <= 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 30) return `${days} days ago`;
		return dateFmt.format(new Date(iso));
	}

	/**
	 * A rail link to #history opens the strip as well as scrolling to it —
	 * otherwise the jump lands on a collapsed button and looks like it did nothing.
	 */
	$effect(() => {
		if (page.url.hash === '#history') historyOpen = true;
	});

	/*
	 * The effect that used to force the documents panel open on a staged batch or
	 * an upload outcome is gone with the panel: the section is always rendered, so
	 * there is no longer anywhere for "2 sent · x was too large" to be written
	 * that the customer cannot see.
	 */
</script>

<svelte:head><title>{heading}</title></svelte:head>

<header class="head">
	<div class="head-main">
		<h1>{heading}</h1>
		{#if order.projectType}<p class="kicker">{order.projectType}</p>{/if}
	</div>

	<!-- The documents control that used to live here is gone.

	     It toggled a panel that was `{#if docsOpen}` — so while it was closed the
	     `#documents` section was not in the DOM at all, and the rail's own
	     Documents link jumped to nothing. A nav entry that silently does nothing
	     is worse than no nav entry. Documents are now always rendered, reached
	     from the rail on a desktop and sitting in the Project tab on a phone,
	     which is where every other section of this page already lives. -->
</header>

<!-- Where the job is, as a shape. This is the question the portal exists to
     answer, so it gets the accent treatment and the top of the page.
     History lives inside it rather than beside it: the newest update is shown
     here, and the History strip is the rest of that same list. As its own card it
     cost a full card's chrome — border, padding, shadow — to render one collapsed
     row, and read as a peer of Documents and Messages when it is really this
     card's own past. -->
<section class="hero" id="status">
	<div class="hero-top">
		<span class="hero-label">Status</span>
		<!-- The precise state, not the rail's bucket: "Deposit due" and "Quote sent"
		     both sit in the rail's first stage, and telling the customer only
		     "Pending" for either is how a job waiting on THEM reads as a job the
		     contractor is busy with. -->
		<span class="hero-state" class:act={order.customerMustAct}>{order.customerStateLabel}</span>
	</div>
	<!-- ------------------------------------------------------------ Over to you
	     The one place the portal ASKS rather than reports, and the reason it is
	     directly under the status line rather than further down the page: a
	     customer who has to scroll to find out that the job is waiting on them has
	     been told nothing.

	     It used to be a single sentence about payment, because payment was the
	     only thing the product could ask for — the two "pay me" states were the
	     whole vocabulary. Anything else the contractor needed went in a message
	     and scrolled away. Now the sentence covers both halves and the asks are
	     listed under it with a control on each, because "you owe us three things"
	     with no way to say which are done is a nag rather than a to-do list. -->
	{#if action.waiting}
		<div class="todo" class:urgent={action.overdue > 0 || action.blocking}>
			<p class="todo-lede">{action.headline}</p>

			{#if action.paymentDue}
				<!-- Payment stays a SENTENCE, not a row with a Done button. The app
				     records money and never processes it (ADR-0010), and a customer
				     ticking "paid" would be writing a payment the contractor never
				     confirmed. It clears when they mark the money received. -->
				<p class="todo-pay">
					<span aria-hidden="true">💵</span>
					{order.customerStateLabel} — {order.contractorName} will mark this off once it lands.
				</p>
			{/if}

			{#if action.open.length > 0}
				<ul class="todo-list">
					{#each action.open as task (task.id)}
						{@const urgency = taskUrgency(task.dueOn, today)}
						<li class="todo-item" class:late={urgency === 'overdue'}>
							<span class="todo-text">
								<span class="todo-title">{task.title}</span>
								{#if task.detail}<span class="todo-detail">{task.detail}</span>{/if}
								<span class="todo-meta">
									{#if task.blocking}<span class="todo-hold">Holding up the job</span>{/if}
									{#if task.dueOn}<span class="todo-due" class:late={urgency !== 'upcoming'}
											>{taskDueLabel(task.dueOn, today)}</span
										>{/if}
								</span>
							</span>
							{#if !data.viewing}
								<form method="POST" action="?/completeTask" use:enhance class="todo-done-form">
									<input type="hidden" name="taskId" value={task.id} />
									<button type="submit" class="todo-done">
										<span aria-hidden="true">✓</span> Done
									</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if progress.onPath}
		<!-- One continuous rail with a filled portion, dots sitting on top. The
		     fill is a percentage of the span between the first and last dot
		     centres, so the geometry holds at any step count or label width. -->
		<div class="track" style="--fill: {fillPercent}; --steps: {progress.steps.length}">
			<ol class="steps" aria-label="Project progress">
				{#each progress.steps as step, i (step)}
					<li
						class="step"
						class:done={i < progress.currentIndex}
						class:now={i === progress.currentIndex}
						aria-current={i === progress.currentIndex ? 'step' : undefined}
					>
						<span class="step-dot" aria-hidden="true">
							{#if i < progress.currentIndex}✓{/if}
						</span>
						<span class="step-label">{step}</span>
					</li>
				{/each}
			</ol>
		</div>
	{:else}
		<p class="hero-off">
			This project is <strong>{progress.label}</strong>. Your contractor can tell you more.
		</p>
	{/if}

	{#if latest}
		<div class="hero-update">
			<div class="hero-head">
				<strong>{latest.title}</strong>
				<span class="hero-when">{relative(latest.createdAt)}</span>
			</div>
			{#if latest.detail}<p class="hero-detail">{latest.detail}</p>{/if}
		</div>
	{:else}
		<p class="hero-off">No updates posted yet.</p>
	{/if}

	{#if older.length > 0}
		<div class="history" id="history">
			<button
				type="button"
				class="drill"
				aria-expanded={historyOpen}
				onclick={() => (historyOpen = !historyOpen)}
			>
				<span>History <span class="count">{older.length}</span></span>
				<span class="chev" class:open={historyOpen} aria-hidden="true">▾</span>
			</button>
			{#if historyOpen}
				<!-- A rail with a node per update: the connecting line is drawn behind the
				     icons so the list reads as one history rather than four loose rows. -->
				<ol class="timeline">
					{#each older as t (t.id)}
						<li class="t-item" data-kind={t.kind}>
							<span class="t-kind" aria-hidden="true">{timelineKindIcon(t.kind)}</span>
							<div class="t-body">
								<div class="t-head">
									<strong>{t.title}</strong>
									<span class="t-when">{relative(t.createdAt)}</span>
								</div>
								{#if t.detail}<p class="t-detail">{t.detail}</p>{/if}
								<span class="t-date">{dateFmt.format(new Date(t.createdAt))}</span>
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	{/if}
</section>

<!-- What this job costs and what is left on it.
     The portal used to show no money at all: the contractor recorded a final
     total at close-out and the customer never saw it, so "Deposit due" in the
     status line was a demand with no number attached and every job produced the
     same email asking how much. Shown for the whole life of the order rather than
     only at the end, because a deposit is the FIRST thing that happens. -->
{#if showInvoice}
	<section class="card invoice" id="invoice">
		<div class="card-head">
			<h2>Invoice</h2>
			{#if invoice.status === 'settled'}
				<span class="inv-badge paid">Paid in full</span>
			{:else if invoice.status === 'open'}
				<span class="inv-badge due">Balance due</span>
			{/if}
		</div>

		<dl class="inv-rows">
			<!-- The breakdown, when there is one. Same rows the emailed invoice
			     carries — a customer comparing the two must not find them different. -->
			{#each invoice.lineItems as item (item.id)}
				<div class="inv-row">
					<dt>{item.label}</dt>
					<dd>{formatCents(item.amountCents)}</dd>
				</div>
			{/each}
			{#if invoice.totalCents != null}
				<div class="inv-row" class:inv-sum={invoice.itemised}>
					<dt>{invoice.itemised ? 'Total' : 'Project total'}</dt>
					<dd>{formatCents(invoice.totalCents)}</dd>
				</div>
			{/if}
			{#each invoice.payments as p (p.id)}
				<div class="inv-row paid-line">
					<dt>
						{paymentLineLabel(p)}
						<span class="inv-when">{invoiceDate(p.receivedAt)}</span>
					</dt>
					<dd>−{formatCents(p.amountCents)}</dd>
				</div>
			{/each}
		</dl>

		<div class="inv-balance" class:settled={invoice.status === 'settled'}>
			{#if invoice.status === 'settled'}
				<span>Paid in full</span>
				<strong>{formatCents(invoice.paidCents)}</strong>
			{:else if invoice.status === 'overpaid'}
				<!-- Told, not hidden. Money owed BACK is the customer's business at
				     least as much as money owed. -->
				<span>Refund due to you</span>
				<strong>{formatCents(-(invoice.balanceCents ?? 0))}</strong>
			{:else if invoice.status === 'open'}
				<span>Balance due</span>
				<strong>{formatCents(invoice.balanceCents)}</strong>
			{:else}
				<span>Paid to date</span>
				<strong>{formatCents(invoice.paidCents)}</strong>
			{/if}
		</div>

		{#if data.order.finalNotes}
			<p class="inv-notes">{data.order.finalNotes}</p>
		{/if}

		<!-- ADR-0010: the app records money, it never moves any. There is deliberately
		     no "pay now" control here — the portal used to carry a quick action that
		     looked like one and was really a message, and this card must not become
		     the same mistake with a bigger number on it. -->
		<p class="inv-foot">
			Payments are arranged with {data.order.contractorName} directly. This page is a record of what has
			been paid.
		</p>
	</section>
{/if}

<!-- Always rendered, never behind a toggle. It is a jump target for the rail,
     and a section that comes and goes cannot be one. When there is nothing in it
     the card stays slim — a heading, the add control and one line — which was the
     real worry behind hiding it in the first place. -->
<section class="card" id="documents">
	<div class="card-head">
		<h2>Documents</h2>
		{#if !data.viewing}
			<button
				type="button"
				class="add"
				aria-label="Add document"
				title="Add document"
				onclick={() => fileInput?.click()}
			>
				+
			</button>
		{/if}
	</div>

	<DocumentList documents={data.documents} empty="Nothing sent yet." onopen={(d) => (preview = d)}>
		{#snippet trailing(d)}
			{#if !data.viewing}
				{#if d.readByContractorAt}
					<!-- Said rather than hidden. A control that silently disappears leaves
					     someone hunting for it; this explains why it is gone. -->
					<span class="seen" title="Your contractor has seen this — it can’t be removed now">
						Seen
					</span>
				{:else if confirmingRemoveId === d.id}
					<form
						method="POST"
						action="?/withdraw"
						use:enhance={() => {
							return async ({ update }) => {
								confirmingRemoveId = null;
								await update();
							};
						}}
					>
						<input type="hidden" name="documentId" value={d.id} />
						<button type="submit" class="withdraw danger">Remove</button>
						<button type="button" class="withdraw" onclick={() => (confirmingRemoveId = null)}>
							Keep
						</button>
					</form>
				{:else}
					<button
						type="button"
						class="withdraw"
						aria-label="Remove {d.filename}"
						onclick={() => (confirmingRemoveId = d.id)}
					>
						Remove
					</button>
				{/if}
			{/if}
		{/snippet}
	</DocumentList>

	{#if data.viewing}
		<span class="pick disabled">Read-only while viewing as this customer</span>
	{:else}
		<!-- One form, one file input, always mounted. The confirm block renders
		     inside it, so moving between "pick" and "confirm" never swaps out the
		     input and loses the selection. The files and names are appended by hand
		     on submit, index-aligned, so removing one on the confirm step actually
		     removes it — an <input type="file"> keeps everything it was given. -->
		<form
			method="POST"
			action="?/upload"
			enctype="multipart/form-data"
			class="uploader"
			use:enhance={({ formData }) => {
				formData.delete('file');
				formData.delete('filename');
				for (const p of picked) {
					formData.append('file', p.file);
					formData.append('filename', p.stem);
				}
				uploading = true;
				return async ({ result, update }) => {
					await update();
					uploading = false;
					if (result.type === 'success') clearPick();
				};
			}}
		>
			<!-- The trigger is the + in the card header; this input is only ever
			     opened programmatically, so it carries no visible chrome of its own. -->
			<input
				bind:this={fileInput}
				type="file"
				name="file"
				multiple
				accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
				onchange={onPick}
				class="sr-only"
			/>

			{#if picked.length > 0}
				<!-- Confirm step: see what you picked, name each one, drop any of them,
				     then send once. Sending on pick meant a camera roll's "IMG_4821.jpg"
				     landed on the contractor with no chance to say what it was. -->
				<div class="confirm">
					{#each picked as p, i (p.file.name + i)}
						<div class="confirm-row">
							<div class="confirm-top">
								{#if p.previewUrl}
									<img class="confirm-thumb" src={p.previewUrl} alt="" />
								{:else}
									<span class="confirm-thumb as-ext" aria-hidden="true"
										>{p.ext.replace('.', '').toUpperCase() || 'FILE'}</span
									>
								{/if}
								<div class="confirm-meta">
									<span class="confirm-orig">{p.file.name}</span>
									<span class="confirm-size">{formatBytes(p.file.size)}</span>
								</div>
								<button
									type="button"
									class="confirm-x"
									aria-label="Remove {p.file.name}"
									onclick={() => removePick(i)}
								>
									✕
								</button>
							</div>

							<label class="confirm-field">
								<span>Name this document</span>
								<span class="confirm-input">
									<input bind:value={p.stem} maxlength="80" disabled={uploading} />
									<span class="confirm-ext" aria-hidden="true">{p.ext}</span>
								</span>
							</label>
						</div>
					{/each}

					<div class="confirm-actions">
						<button type="button" class="btn ghost" onclick={clearPick} disabled={uploading}>
							Cancel
						</button>
						<button type="submit" class="btn primary" disabled={uploading}>
							{uploading
								? 'Sending…'
								: picked.length === 1
									? 'Send'
									: `Send ${picked.length} files`}
						</button>
					</div>
				</div>
			{/if}
		</form>
	{/if}

	<!-- Both halves of a partial batch are said out loud: what went and what did
	     not, by name. Silently dropping a file lets someone believe they sent it. -->
	{#if pickError}
		<p class="note error">{pickError}</p>
	{:else if form?.upload && form?.message}
		<p class="note" class:error={form.refused}>{form.message}</p>
	{/if}
</section>

<!-- Read and write in one place. The thread used to be a card here and the
     composer a floating button, which meant one conversation was two different
     controls in two different idioms — and the card was hidden until a thread
     existed, so the only way to start one was the floating button. This card is
     always present for exactly that reason. -->
<section class="card msg-card" id="messages">
	<div class="card-head">
		<h2>Messages</h2>
		{#if data.unreadReplies > 0}
			<span class="pill">
				{data.unreadReplies} new from {order.contractorName}
			</span>
		{/if}
	</div>

	<MessageThread
		messages={data.thread}
		mineRole="customer"
		otherName={order.contractorName}
		empty="No messages yet. Ask {order.contractorName} anything about this project — they’ll get it straight away."
	/>

	<MessageComposer
		action="?/send"
		placeholder="Write to {order.contractorName}…"
		disabledReason={data.viewing ? 'Read-only while viewing as this customer' : null}
	/>
	{#if form?.message && !form?.upload}
		<p class="note error">{form.message}</p>
	{/if}
</section>

<DocumentViewer bind:open={preview} />

<style>
	/* Mobile first: this is the phone layout; the min-width blocks only widen it. */
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		min-width: 0;
	}
	.head-main {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}

	/* The mirror image of the contractor's thread palette: the same two hues with
	   "mine" swapped. The customer's own messages are teal on both surfaces and
	   their contractor's are yellow on both, so one conversation looks like one
	   conversation from either end. MessageThread turns each hue into a wash of
	   the surface, so neither needs a dark-mode variant. */
	.msg-card {
		--thread-mine-hue: var(--who-customer);
		--thread-theirs-hue: var(--who-contractor);
		/* Teal is dark in light mode and light in dark mode, so the send glyph
		   follows the accent's own paired foreground rather than being pinned. */
		--send-fg: var(--accent-fg);
	}

	h1 {
		margin: 0;
		font-size: 1.45rem;
		line-height: 1.15;
		letter-spacing: -0.01em;
		color: var(--fg);
		overflow-wrap: anywhere;
	}
	.kicker {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}

	/* ------------------------------------------------------------------ Hero
	   The heaviest thing on the page. Its palette comes from --hero-* on the
	   layout shell, so light gets an accent slab and dark gets a deep tinted
	   surface — an inverted-brightness copy of the light slab reads as a glowing
	   plastic brick, which is not the same design in a different theme. */
	.hero {
		display: grid;
		gap: 1rem;
		padding: 1.05rem 1rem 1.15rem;
		border-radius: 18px;
		color: var(--hero-fg);
		background: var(--hero-bg);
		border: 1px solid var(--hero-edge);
		box-shadow: var(--hero-shadow);
	}
	.hero-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
	}
	.hero-label {
		font-size: 0.64rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--hero-dim);
	}
	/* The ball is in the customer's court. Underlined rather than recoloured: the
	   hero already sits on the accent, so a second accent would not read, and red
	   would say "something went wrong" when nothing has. */
	.hero-state.act {
		text-decoration: underline;
		text-decoration-thickness: 2px;
		text-underline-offset: 0.28em;
		text-decoration-color: var(--hero-rule);
	}
	.hero-state {
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	/* ---------------------------------------------------------- Over to you
	   A panel INSIDE the hero rather than a card under it. Everything below the
	   hero on this page is reporting — where the job is, what was sent, what was
	   said — and an ask parked among those reads as one more thing to catch up on
	   rather than as the one thing the customer has to do.

	   It takes the hero's inset well and a bright rim off the hero's own rule, so
	   it reads as raised out of the slab in both themes without either one having
	   a colour of its own. */
	.todo {
		display: grid;
		gap: 0.5rem;
		margin: 0.1rem 0 0;
		padding: 0.7rem 0.8rem;
		border-radius: var(--radius-card);
		border: 1px solid var(--hero-rule);
		border-left: 3px solid var(--hero-fg);
		background: var(--hero-inset);
	}
	/* Overdue, or the contractor has said the job is held up. The rim goes to full
	   strength rather than changing hue: on a saturated slab a second colour does
	   not read, and this is emphasis on something already visible, not a new
	   status. */
	.todo.urgent {
		box-shadow: 0 0 0 1px var(--hero-fg);
	}
	.todo-lede {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 700;
		color: var(--hero-fg);
		line-height: 1.4;
	}
	.todo-pay {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		font-size: 0.82rem;
		color: var(--hero-dim);
	}
	.todo-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.todo-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.55rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--hero-rule);
		background: color-mix(in srgb, var(--hero-fg) 8%, transparent);
	}
	.todo-text {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.15rem;
	}
	.todo-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--hero-fg);
		overflow-wrap: anywhere;
	}
	.todo-detail {
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--hero-dim);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.todo-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	/* Two small facts about one ask, so they wear the same chip and differ only in
	   weight — a date and a warning in two different shapes made a one-line task
	   look like three things. */
	.todo-hold,
	.todo-due {
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--hero-rule);
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--hero-dim);
	}
	.todo-hold,
	.todo-due.late {
		border-color: var(--hero-fg);
		color: var(--hero-fg);
	}
	.todo-done-form {
		flex: none;
		display: flex;
	}
	/* The only button on the hero, and the only one the customer needs: what the
	   panel is FOR is being able to say a thing is done. Filled with the hero's
	   own foreground so it is unmistakably the action here — everything else on
	   this slab is text. */
	.todo-done {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.75rem;
		border: none;
		border-radius: var(--radius-pill);
		background: var(--hero-fg);
		color: var(--hero-tick);
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 800;
		cursor: pointer;
	}
	.todo-done:hover {
		opacity: 0.88;
	}
	.todo-done:focus-visible {
		outline: 2px solid var(--hero-fg);
		outline-offset: 2px;
	}

	/* ------------------------------------------------------------- Progress
	   Connectors are drawn per gap and STOP SHORT of the dots on both sides —
	   a single rail running under the circles shows through them and reads as a
	   line struck across the step. The inset here is the dot's radius plus a
	   breathing gap, so nothing ever touches. */
	.track {
		position: relative;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
	}
	.step {
		position: relative;
		display: grid;
		justify-items: center;
		gap: 0.45rem;
		min-width: 0;
	}
	/* The gap between this step and the previous one. */
	.step:not(:first-child)::before {
		content: '';
		position: absolute;
		/* Dot is 1.25rem tall, so its centre sits 0.625rem down; the rule is 2px. */
		top: calc(0.625rem - 1px);
		/* Half a cell back, then clear of both dots (0.625rem radius + 0.3rem gap). */
		left: calc(-50% + 0.925rem);
		right: calc(50% + 0.925rem);
		height: 2px;
		border-radius: 999px;
		background: var(--hero-rule);
	}
	/* Filled once the step it leads INTO has been reached. */
	.step.done::before,
	.step.now::before {
		background: var(--hero-fg);
	}
	.step-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 999px;
		border: 2px solid var(--hero-rule);
		background: transparent;
		font-size: 0.62rem;
		font-weight: 500;
		line-height: 1;
		color: transparent;
	}
	.step.done .step-dot {
		background: var(--hero-fg);
		border-color: var(--hero-fg);
		color: var(--hero-tick);
	}
	/* Current: filled and ringed, so "where am I" survives a glance. */
	.step.now .step-dot {
		background: var(--hero-fg);
		border-color: var(--hero-fg);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--hero-fg) 20%, transparent);
	}
	.step-label {
		font-size: 0.66rem;
		font-weight: 400;
		text-align: center;
		color: var(--hero-dim);
		overflow-wrap: anywhere;
	}
	.step.now .step-label {
		color: var(--hero-fg);
	}

	.hero-off {
		margin: 0;
		font-size: 0.88rem;
		color: var(--hero-dim);
	}
	.hero-off strong {
		color: var(--hero-fg);
	}

	/* The newest update. A rule and some space, not a boxed panel with an icon —
	   it is already inside the hero, so framing it again just adds chrome. */
	.hero-update {
		display: grid;
		gap: 0.3rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--hero-rule);
	}
	.hero-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.hero-head strong {
		font-size: 1rem;
		letter-spacing: -0.005em;
	}
	.hero-when {
		font-size: 0.68rem;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--hero-dim);
		white-space: nowrap;
	}
	.hero-detail {
		margin: 0;
		font-size: 0.89rem;
		line-height: 1.55;
		color: var(--hero-dim);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	/* ----------------------------------------------------------------- Cards */
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: 0.85rem 0.95rem;
		box-shadow: var(--card-shadow);
		display: grid;
		/* See the note on .main in +layout.svelte — the 0 floor has to hold at
		   every level or the one at the bottom never gets to truncate. */
		grid-template-columns: minmax(0, 1fr);
		min-width: 0;
		gap: 0.65rem;
	}
	/* The rail's section links jump here. The bar is sticky, so a bare anchor
	   would park the heading underneath it. */
	.hero,
	.card,
	.history {
		scroll-margin-top: 5rem;
	}
	/* ------------------------------------------------------------------ Invoice
	   The customer's copy of the money. Same figures as the contractor's card and
	   the emailed invoice — all three read one server-computed summary — drawn in
	   the portal's own accent rather than the contractor's yellow, because this is
	   the customer's surface. */
	.invoice .inv-rows {
		margin: 0;
		display: grid;
		gap: 0.1rem;
	}
	.inv-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--line);
		font-size: 0.92rem;
	}
	.inv-row dt {
		color: var(--fg);
		min-width: 0;
	}
	.inv-row dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* A payment is a credit — muted, so the eye runs past it to the balance. */
	.inv-row.paid-line dt,
	.inv-row.paid-line dd {
		color: var(--fg-muted);
	}
	.inv-when {
		display: block;
		font-size: 0.76rem;
		color: var(--fg-muted);
	}
	/* The line the breakdown adds up to, ruled off from the rows above it so a
	   customer counting them can see where the sum starts. */
	.inv-row.inv-sum {
		border-top: 2px solid var(--line-strong);
		font-weight: 500;
	}
	/* The one figure this card exists to report, set as a headline rather than as
	   another row of the table above it — matching the contractor's own invoice
	   card, so the two sides of one invoice look like one invoice. */
	.invoice .inv-balance {
		display: grid;
		gap: 0.15rem;
		margin-top: 0.35rem;
		padding: 0.7rem 0.85rem;
		border-radius: 12px;
		border: 1px solid var(--accent);
		background: var(--accent-soft);
	}
	.invoice .inv-balance span {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--accent-deep);
	}
	.invoice .inv-balance strong {
		font-size: 1.9rem;
		font-weight: 700;
		line-height: 1.05;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		color: var(--fg);
	}
	/* Settled is the good outcome and says so in green rather than in the accent
	   the portal uses for "you still owe us something". */
	.invoice .inv-balance.settled {
		border-color: var(--ok-line);
		background: var(--ok-bg);
	}
	.invoice .inv-balance.settled span,
	.invoice .inv-balance.settled strong {
		color: var(--ok-fg);
	}
	.inv-badge {
		font-size: 0.68rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		white-space: nowrap;
	}
	.inv-badge.paid {
		background: var(--ok-bg);
		color: var(--ok-fg);
		border: 1px solid var(--ok-line);
	}
	.inv-badge.due {
		background: var(--accent-soft);
		color: var(--accent-deep);
		border: 1px solid var(--accent);
	}
	.inv-notes {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--fg-muted);
		white-space: pre-wrap;
	}
	.inv-foot {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--fg-muted);
	}

	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	h2 {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-muted);
	}
	.pill {
		font-size: 0.68rem;
		font-weight: 500;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent-deep);
	}
	:global(:root[data-theme='dark']) .pill {
		background: color-mix(in srgb, var(--accent) 20%, transparent);
		color: var(--accent);
	}

	/* ------------------------------------------------------------- Documents */
	/* The rows themselves live in DocumentList. What stays here is only what is
	   specific to the customer's copy: whether they can still take one back. */
	.seen {
		font-size: 0.7rem;
		color: var(--fg-muted);
		white-space: nowrap;
	}
	.withdraw {
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.72rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}
	.withdraw:hover,
	.withdraw:focus-visible {
		border-color: var(--accent);
		color: var(--fg);
	}
	.withdraw.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
	/* The trigger: a single + beside the heading. */
	.add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		flex-shrink: 0;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface-sunken);
		color: var(--fg);
		font-family: inherit;
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
	}
	.add:hover {
		background: var(--accent);
		border-color: transparent;
		color: var(--accent-fg);
	}
	.pick.disabled {
		font-size: 0.8rem;
		color: var(--fg-muted);
	}
	/* Opened programmatically by the + button; never visible, always submittable. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	/* -------------------------------------------------------- Confirm upload */
	.uploader {
		display: grid;
		gap: 0.6rem;
	}
	.confirm {
		display: grid;
		gap: 0.7rem;
		padding: 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		background: var(--surface-sunken);
	}
	/* One block per picked file, so a batch reads as a list of things being sent
	   rather than as one undifferentiated blob. */
	.confirm-row {
		display: grid;
		gap: 0.5rem;
		padding-bottom: 0.7rem;
		border-bottom: 1px solid var(--line);
	}
	.confirm-row:last-of-type {
		padding-bottom: 0;
		border-bottom: none;
	}
	.confirm-top {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}
	.confirm-thumb {
		width: 2.75rem;
		height: 2.75rem;
		flex-shrink: 0;
		object-fit: cover;
		border-radius: 9px;
		border: 1px solid var(--line);
		display: block;
	}
	.confirm-thumb.as-ext {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--accent-soft);
		color: var(--accent-deep);
		font-size: 0.6rem;
		font-weight: 600;
	}
	:global(:root[data-theme='dark']) .confirm-thumb.as-ext {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent);
	}
	.confirm-meta {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.1rem;
	}
	.confirm-orig {
		font-size: 0.8rem;
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}
	.confirm-size {
		font-size: 0.72rem;
		color: var(--fg-muted);
		opacity: 0.8;
	}
	.confirm-x {
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border: none;
		border-radius: 999px;
		background: var(--surface);
		color: var(--fg-muted);
		font-family: inherit;
		cursor: pointer;
	}
	.confirm-x:hover {
		color: var(--fg);
	}

	.confirm-field {
		display: grid;
		gap: 0.3rem;
		font-size: 0.72rem;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-muted);
	}
	/* The extension rides alongside the field rather than inside it — a rename
	   can't drop it, so a renamed file always still opens. */
	.confirm-input {
		display: flex;
		align-items: center;
		border: 1px solid var(--field-border);
		border-radius: 10px;
		background: var(--field-bg);
		overflow: hidden;
	}
	.confirm-input:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.confirm-input input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		padding: 0.55rem 0.65rem;
		font: inherit;
		font-size: 1rem;
		font-weight: 500;
		text-transform: none;
		letter-spacing: normal;
		color: var(--fg);
	}
	.confirm-input input:focus {
		outline: none;
	}
	.confirm-ext {
		padding-right: 0.65rem;
		font-size: 0.85rem;
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		color: var(--fg-muted);
	}

	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.btn {
		min-height: 2.6rem;
		padding: 0.5rem 1.1rem;
		border-radius: 10px;
		font-family: inherit;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
	}
	.btn.ghost {
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg-muted);
	}
	.btn.ghost:hover:not(:disabled) {
		color: var(--fg);
	}
	.btn.primary {
		border: 1px solid transparent;
		background: var(--accent);
		color: var(--accent-fg);
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--accent-deep);
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	/* History, inside the hero. Separated by a rule rather than by a card of its
	   own: it is this panel's past, not a peer of Documents and Messages. */
	.history {
		margin-top: 0.2rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--hero-rule);
	}
	.drill {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 2.5rem;
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		color: var(--hero-dim);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		cursor: pointer;
	}
	.drill:hover,
	.drill:focus-visible {
		color: var(--hero-fg);
	}
	.count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.15rem;
		height: 1.15rem;
		margin-left: 0.3rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--hero-inset);
		font-size: 0.68rem;
	}
	.chev {
		transition: transform 0.15s ease;
	}
	.chev.open {
		transform: rotate(180deg);
	}

	/* A rail with a node per update, so the list reads as one history rather than
	   a stack of loose rows. The line is drawn behind the icon column. */
	.timeline {
		position: relative;
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.9rem;
	}
	.timeline::before {
		content: '';
		position: absolute;
		left: 0.7rem;
		top: 0.3rem;
		bottom: 0.3rem;
		width: 2px;
		border-radius: 999px;
		background: linear-gradient(
			to bottom,
			var(--line-strong),
			color-mix(in srgb, var(--line-strong) 25%, transparent)
		);
	}
	.t-item {
		position: relative;
		display: flex;
		gap: 0.7rem;
	}
	/* NOTE every colour below comes from the HERO palette, not the page palette.
	   History used to be its own card and these were `--fg` / `--surface` /
	   `--line-strong`; moving it inside the hero left near-black text and white
	   dots sitting on a saturated teal slab. It survived review because the dark
	   theme's `--fg` is near-white and happened to look fine — light mode was the
	   only broken one. */
	.t-kind {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.45rem;
		height: 1.45rem;
		flex-shrink: 0;
		border-radius: 999px;
		background: var(--hero-inset);
		border: 2px solid var(--hero-rule);
		color: var(--hero-fg);
		font-size: 0.65rem;
		font-weight: 500;
		/* Sits on top of the rail rather than beside it. */
		z-index: 1;
	}
	/* A reported problem is the one kind worth marking — everything else is
	   ordinary progress and shouldn't compete for attention. On the hero there is
	   no room for hue to do that (the slab is already saturated), so it is weight
	   and opacity instead. */
	.t-item[data-kind='issue'] .t-kind {
		border-color: var(--hero-fg);
		background: var(--hero-fg);
		color: var(--accent-deep);
	}
	.t-item[data-kind='milestone'] .t-kind {
		border-color: var(--hero-fg);
	}
	.t-body {
		min-width: 0;
		display: grid;
		gap: 0.15rem;
		padding-bottom: 0.1rem;
	}
	.t-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.t-head strong {
		font-size: 0.92rem;
		color: var(--hero-fg);
	}
	.t-when {
		font-size: 0.66rem;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--hero-dim);
		white-space: nowrap;
	}
	.t-detail {
		margin: 0.1rem 0 0;
		font-size: 0.87rem;
		line-height: 1.55;
		color: var(--hero-dim);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.t-date {
		font-size: 0.7rem;
		color: var(--hero-dim);
		opacity: 0.8;
	}

	.note {
		margin: 0;
		font-size: 0.82rem;
		color: var(--fg-muted);
	}
	.note.error {
		color: var(--danger);
	}

	@media (min-width: 30rem) {
		.step-label {
			font-size: 0.72rem;
		}
	}
	@media (min-width: 48rem) {
		h1 {
			font-size: 1.7rem;
		}
		.hero {
			padding: 1.25rem 1.35rem;
			gap: 1.1rem;
		}
		/* The ball is in the customer's court. Underlined rather than recoloured: the
	   hero already sits on the accent, so a second accent would not read, and red
	   would say "something went wrong" when nothing has. */
		.hero-state.act {
			text-decoration: underline;
			text-decoration-thickness: 2px;
			text-underline-offset: 0.28em;
			text-decoration-color: var(--hero-rule);
		}
		.hero-state {
			font-size: 1.2rem;
		}
		.todo-lede {
			font-size: 0.98rem;
		}
		.card {
			padding: 1rem 1.15rem;
		}
	}
</style>
