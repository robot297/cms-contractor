<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		customerLocation,
		formatBytes,
		formatCents,
		MAX_DOCUMENT_BYTES,
		paymentMethodLabel,
		PAYMENT_METHODS,
		QUICK_UPDATE_STATES,
		snoozeDate,
		toDateInput,
		type DocumentRef
	} from '$lib/crm';
	import DocumentList from '$lib/DocumentList.svelte';
	import DocumentViewer from '$lib/DocumentViewer.svelte';
	import MessageComposer from '$lib/MessageComposer.svelte';
	import MessageThread from '$lib/MessageThread.svelte';
	import ContactPanel from '$lib/ContactPanel.svelte';
	import InlineEditor from '$lib/InlineEditor.svelte';
	import TagPicker from '$lib/TagPicker.svelte';
	import { toast } from '$lib/toast.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// --- Status modal -----------------------------------------------------
	// ONE full-screen modal for every status change — the ⚙ opens it. Setting an
	// interim stage, completing (final invoice + payment) and cancelling (reason)
	// are three views of the same sheet, so "how do I change this order's state" has
	// one answer and one consistent full-screen surface, not a cramped popover for
	// some of it and a footer button for the rest.
	let statusModal = $state<null | 'status' | 'complete' | 'cancel'>(null);
	let markPaid = $state(false);
	let payMethod = $state<string>('cash');
	const isTerminal = $derived(
		data.order.state === 'Work Complete' || data.order.state === 'Work Cancelled'
	);
	function openStatus() {
		statusDraft = order.state;
		statusNote = '';
		noteFieldOpen = false;
		markPaid = false;
		payMethod = 'cash';
		statusModal = 'status';
	}
	const closeoutThenClose =
		(kind: 'complete' | 'cancel'): SubmitFunction =>
		() =>
		async ({ result, update }) => {
			await update();
			if (result.type === 'success') {
				statusModal = null;
				if (kind === 'complete') {
					const emailed = result.data?.invoiceEmail === 'sent';
					toast.success('Order completed', {
						detail: emailed ? `Final invoice emailed to ${order.customerName}.` : undefined
					});
				} else {
					toast.success('Order cancelled');
				}
			}
		};
	// Interim states only — Complete / Cancelled are the modal's close-out buttons.
	const interimStates = QUICK_UPDATE_STATES.filter(
		(s) => s !== 'Work Complete' && s !== 'Work Cancelled'
	);

	// Tags edit in place on the header rather than behind a separate screen.
	let editingTags = $state(false);
	// Past four, tags collapse behind a "+N" chip: a heavily-tagged order used to
	// wrap the header into three lines and push the status badge down the page.
	const TAG_LIMIT = 4;
	let showAllTags = $state(false);
	const shownTags = $derived(showAllTags ? data.order.tags : data.order.tags.slice(0, TAG_LIMIT));
	const hiddenTags = $derived(data.order.tags.slice(TAG_LIMIT));

	// Three panels. Files left the strip for an icon in the header — it is a thing
	// you reach for, not a view you sit in — which also gets the tab row down to
	// something that fits a phone without scrolling.
	//
	// Which one opens is a question about the ORDER, not a preference: a job whose
	// customer is waiting opens on the conversation, everything else on the
	// history. An explicit click overrides that for as long as you stay on the
	// page, and is dropped on navigation so the next order gets its own answer.
	type TabId = 'history' | 'messages' | 'workers';
	let tabOverride = $state<TabId | null>(null);
	const tab = $derived<TabId>(tabOverride ?? (data.owesReply ? 'messages' : 'history'));
	// Only one of these carries a number, and only when it means something.
	//
	// A badge on a tab reads as a notification — as "there is something here for
	// you". "History 12" and "Workers 3" are not that; they are inventory, and
	// wearing the same treatment as a real alert taught the eye to ignore all
	// three. So the counts are gone and Messages keeps a badge for the one thing
	// that IS owed: questions the contractor has not answered.
	const TABS = $derived([
		{ id: 'history' as const, label: 'History', pending: 0 },
		// A peer of the history, not part of it: the history is what happened to
		// the job, the thread is what was said about it.
		{ id: 'messages' as const, label: 'Messages', pending: data.pendingReplies },
		{ id: 'workers' as const, label: 'Workers', pending: 0 }
	]);
	/** Files open in place under the header, the way tags and the customer do. */
	let filesOpen = $state(false);

	/** How many history entries show before "Show all". */
	const HISTORY_PREVIEW = 4;
	let historyExpanded = $state(false);
	/** Whether each entry shows its detail line, or just what happened and when.
	   Off by default: the history reads as a scannable spine of what happened, and
	   the detail on any one entry is one "Show details" press away. */
	let historyDetails = $state(false);
	const shownTimeline = $derived(
		historyExpanded ? data.timeline : data.timeline.slice(0, HISTORY_PREVIEW)
	);

	// Reply composer.
	/** The document open in the shared viewer, or null. */
	let preview = $state<DocumentRef | null>(null);

	/** Two-step delete, matching every other destructive control in the app. */
	let confirmingDeleteId = $state<string | null>(null);
	/** The document whose note and tags are being edited, or null. */
	let editingDocId = $state<string | null>(null);
	let editingNote = $state('');
	let editingTagsValue = $state('');

	function startEditDoc(d: { id: string; note?: string | null; tags?: string[] }) {
		confirmingDeleteId = null;
		editingDocId = d.id;
		editingNote = d.note ?? '';
		editingTagsValue = (d.tags ?? []).join(', ');
	}

	// The reply box and its draft live in MessageComposer; scrolling the thread to
	// its newest message is MessageThread's. Neither is this page's business.
	// Customer details open in place under the customer line, the same way tags do.
	let customerOpen = $state(false);

	// Crew changes are staged, not applied on tap: every assignment writes to the
	// job's history (and is where subcontractor notifications will hang later), so
	// nothing commits until the "✓ Save" in the panel header. Keyed by sub id,
	// value = the desired assigned state; toggling back to the server state simply
	// drops the key.
	let stagedSubs = $state<Record<string, boolean>>({});
	function toggleSub(id: string, currentlyAssigned: boolean) {
		const next = { ...stagedSubs };
		if (id in next) delete next[id];
		else next[id] = !currentlyAssigned;
		stagedSubs = next;
	}
	const stagedAssign = $derived(
		Object.entries(stagedSubs)
			.filter(([, assigned]) => assigned)
			.map(([id]) => id)
	);
	const stagedUnassign = $derived(
		Object.entries(stagedSubs)
			.filter(([, assigned]) => !assigned)
			.map(([id]) => id)
	);
	const stagedCount = $derived(stagedAssign.length + stagedUnassign.length);
	/** Whether this contractor has anybody on the books at all. */
	const hasRoster = $derived(data.assignedSubs.length > 0 || data.availableSubs.length > 0);
	// The add box. Assigned crew renders inline; the rest of the roster only ever
	// appears as search matches, so a fifty-person roster doesn't bury the three
	// people actually on the job.
	let subQuery = $state('');
	const SUB_RESULT_LIMIT = 8;
	// Staged adds surface in the crew list itself (as pending rows), so a picked
	// person doesn't vanish when the search that found them is cleared…
	const stagedAddSubs = $derived(data.availableSubs.filter((s) => stagedSubs[s.id] === true));
	// …and drop out of the results, where they'd otherwise render twice.
	const subMatches = $derived.by(() => {
		const q = subQuery.trim().toLowerCase();
		if (!q) return [];
		return data.availableSubs.filter(
			(s) =>
				stagedSubs[s.id] !== true &&
				(s.name.toLowerCase().includes(q) || (s.trade ?? '').toLowerCase().includes(q))
		);
	});

	const order = $derived(data.order);
	// "City, ST" from the customer's captured fields, for the header line.
	const orderLocation = $derived(
		customerLocation({
			city: order.customerCity,
			state: order.customerState,
			address: order.customerAddress
		})
	);
	const customer = $derived(data.customer);

	// Back link follows where you came from: the dashboard sends you back to the
	// dashboard, the orders list back to orders. Falls back to Orders on a direct
	// load / refresh.
	let backTo = $state<{ href: '/contractor' | '/contractor/orders'; label: string }>({
		href: '/contractor/orders',
		label: 'Orders'
	});
	afterNavigate((nav) => {
		// A new order decides its own opening panel; the last one's click does not
		// carry over.
		tabOverride = null;
		const from = nav.from?.url.pathname;
		if (from === '/contractor') backTo = { href: '/contractor', label: 'Dashboard' };
		else if (from?.startsWith('/contractor/orders'))
			backTo = { href: '/contractor/orders', label: 'Orders' };
	});

	let confirmingDelete = $state(false);
	// The draft state picked in the modal. Re-seeded from the saved state each time
	// the modal opens (see openStatus), so "Save" only lights up once the pick differs.
	let statusDraft = $state(untrack(() => data.order.state));
	let statusNote = $state('');
	/** The note field is the exception, not the rule: most status changes explain
	    themselves, so it stays behind a checkbox rather than sitting empty under
	    every one of them. Unchecked means the input isn't in the form at all. */
	let noteFieldOpen = $state(false);
	const statusDirty = $derived(statusDraft !== order.state);
	const statusThenClose =
		() =>
		async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
			await update();
			if (result.type === 'success') statusModal = null;
		};
	// Follow-up controls collapse behind a single snooze (⏰) button.
	let snoozeOpen = $state(false);
	// Customer contact (email/call) popover, mirroring the dashboard cards.
	let contactOpen = $state(false);
	// Inviting the customer to their portal, straight from the Messages panel —
	// which is where the absence of a portal is actually felt.
	let inviting = $state(false);
	/** The invite already out to this customer, if any — a re-send carries its id. */
	const openInviteId = $derived(
		data.portal.state === 'pending' || data.portal.state === 'expired' ? data.portal.inviteId : null
	);
	const inviteEnhance: SubmitFunction = () => {
		inviting = true;
		const name = order.customerName ?? 'your customer';
		// Anything with an invite id behind it is a re-send; only 'none' is a first.
		const resending = !!openInviteId;
		return async ({ result, update }) => {
			inviting = false;
			await update();
			if (result.type === 'success') {
				toast.success(resending ? `Invite re-sent to ${name}` : `Invite sent to ${name}`, {
					detail: 'They’ll get an email with a link to their portal.'
				});
			} else if (result.type === 'failure') {
				const msg = result.data?.message;
				toast.error(typeof msg === 'string' ? msg : 'That invite could not be sent');
			}
		};
	};
	// Document rules (types + size) live in an info modal, off the main flow.
	let infoDialog: HTMLDialogElement | undefined = $state();
	// The timeline's note input is hidden until the + button reveals it.
	let noteOpen = $state(false);
	// Close the snooze popover once a follow-up change is submitted.
	const snoozeThenClose =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			snoozeOpen = false;
			await update();
		};
	// Close & reset the note field after a note is added.
	const noteThenClose =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			noteOpen = false;
			await update();
		};

	function fmtDate(d: Date | string | null): string {
		return d ? new Date(d).toLocaleDateString() : '—';
	}
	/** "Thu, 20 Aug" — short enough to sit inside a preset button. */
	const shortDay = new Intl.DateTimeFormat(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short'
	});
	function fmtShort(d: Date): string {
		return shortDay.format(d);
	}
	/** The snooze options, and the order they read in. */
	const FOLLOWUP_PRESETS = [
		{ preset: '1d' as const, label: 'Tomorrow' },
		{ preset: '3d' as const, label: 'In 3 days' },
		{ preset: '1w' as const, label: 'Next week' },
		{ preset: '1m' as const, label: 'Next month' }
	];

	// Status badge colour by health: green = on track / done, amber = waiting or
	// stuck, red = cancelled. Mirrors the orders list.
	const STATUS_GO = { bg: '#e6f4ea', border: '#4ea866', fg: '#1a7f37' };
	const STATUS_WAIT = { bg: '#fff4d6', border: '#d4a72c', fg: '#8a5a00' };
	const STATUS_STOP = { bg: '#ffebe9', border: '#e5534b', fg: '#cf222e' };
	function statusBadge(state: string) {
		switch (state) {
			case 'In Progress':
			case 'Work Scheduled':
			case 'Parts Ordered':
			case 'Work Complete':
				return STATUS_GO;
			case 'Work Cancelled':
				return STATUS_STOP;
			default:
				return STATUS_WAIT;
		}
	}
	const badge = $derived(statusBadge(order.state));

	const pill =
		'padding: 0.4rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; font-size: 0.85rem;';
	const sectionTitle =
		'margin: 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: #8c959f;';

	// Show the project type only when the name doesn't already say it, so
	// "Poolside Pergola" + type "Pergola" reads as one line, not "… · Pergola".
	function typeSuffix(name: string | null, type: string | null): string | null {
		if (!type) return null;
		if (name && name.toLowerCase().includes(type.toLowerCase())) return null;
		return type;
	}
</script>

<svelte:head>
	<title>{order.projectName ?? 'Order'}</title>
</svelte:head>

<div class="order-shell">
	<div class="page">
		<!-- Back and status share the top line. The status used to sit across from
		     the title as a caption to it, which cost the title a fixed column on the
		     right — on a phone that squeezed a project name into three wrapped lines
		     beside a pill with room to spare. Up here it is out of the title's way
		     on every screen, and the back link stops owning a line by itself. -->
		<div class="head-bar">
			<a class="back-link" href={resolve(backTo.href)}>← {backTo.label}</a>
			<div class="statusline">
				<span
					style="font-size: 0.82rem; font-weight: 700; white-space: nowrap; color: {badge.fg}; background: {badge.bg}; border: 1px solid {badge.border}; border-radius: 999px; padding: 0.25rem 0.8rem;"
					>{order.state}</span
				>
				<button
					type="button"
					class="icon-btn {statusModal ? 'on' : ''}"
					aria-haspopup="dialog"
					title="Update status"
					aria-label="Update status"
					onclick={openStatus}
					style="width: 1.9rem; height: 1.9rem; font-size: 1.05rem;">⚙️</button
				>
			</div>
		</div>

		<header class="order-head">
			<div class="head-main">
				<h1 class="order-title">
					{order.projectName ??
						'Untitled project'}{#if typeSuffix(order.projectName, order.projectType)}<span
							class="order-type"
						>
							· {typeSuffix(order.projectName, order.projectType)}</span
						>{/if}
				</h1>
				<!-- Customer, then where the work is — same shape as the list card, so
					     the two surfaces read alike. Omitted when the address has no city
					     to isolate rather than shown as a dangling separator. -->
				<span class="order-sub">
					<span class="sub-customer">{order.customerName}</span>{#if orderLocation}<span
							class="sub-sep">·</span
						>{orderLocation}{/if}
					{#if customer}
						<button
							type="button"
							class="icon-btn cust-toggle"
							class:on={customerOpen}
							style="width: 1.6rem; height: 1.6rem; font-size: 0.9rem;"
							title={customerOpen ? 'Hide customer details' : 'Customer details'}
							aria-label={customerOpen ? 'Hide customer details' : 'Customer details'}
							aria-expanded={customerOpen}
							onclick={() => (customerOpen = !customerOpen)}
						>
							🪪
						</button>
					{/if}
				</span>
			</div>

			{#if customerOpen && customer}
				<InlineEditor title="Customer" onclose={() => (customerOpen = false)}>
					{#snippet actions()}
						<!-- Contact (email / call) behind one button, like the dashboard -->
						<div style="position: relative;">
							<button
								type="button"
								class="icon-btn"
								style="width: 1.9rem; height: 1.9rem; font-size: 1.1rem;"
								title="Contact customer"
								aria-label="Contact customer"
								aria-expanded={contactOpen}
								onclick={() => (contactOpen = !contactOpen)}>💬</button
							>
							{#if contactOpen && customer}
								<!-- Dimmed click-away scrim so the composer is the focus. -->
								<button
									type="button"
									aria-label="Close contact menu"
									onclick={() => (contactOpen = false)}
									class="contact-scrim"
								></button>
								<div class="contact-pop">
									<ContactPanel
										contact={{
											name: customer.name,
											email: customer.email,
											phone: customer.phone,
											preferredContact: customer.preferredContact
										}}
										project={order.projectName}
										orderId={order.id}
										conversations={[
											{
												orderId: order.id,
												projectName: order.projectName,
												thread: data.thread
											}
										]}
										canChat={data.customerLinked}
										customerId={order.customerId}
										portal={data.portal}
										onsent={() => (contactOpen = false)}
										onclose={() => (contactOpen = false)}
									/>
								</div>
							{/if}
						</div>
					{/snippet}
					<dl class="cust-facts">
						<div class="fact">
							<dt>Email</dt>
							<dd class="cust-value">{customer.email}</dd>
						</div>
						{#if customer.phone}
							<div class="fact">
								<dt>Phone</dt>
								<dd class="cust-value">{customer.phone}</dd>
							</div>
						{/if}
						{#if customer.address}
							<div class="fact">
								<dt>Address</dt>
								<dd class="cust-value">{customer.address}</dd>
							</div>
						{/if}
					</dl>
				</InlineEditor>
			{/if}

			<!-- Everything you glance at or reach for about this order, in ONE wrapping
			     row: tags, when to chase it, and the files on it. Each is a label, its
			     value, and the control that edits it. These were three separate
			     full-width blocks, which on a phone meant three lines of mostly empty
			     space; as flex items they pack onto as few lines as the width allows
			     and wrap only when they must. Who's on the job lives in Workers. -->
			<dl class="order-facts">
				<div class="fact">
					<dt>Tags</dt>
					<dd>
						{#each shownTags as tag (tag)}<span class="tag-chip">{tag}</span>{/each}
						{#if hiddenTags.length > 0}
							<!-- Hover shows the rest; clicking expands, since a tooltip is
							     nothing a touch device can reach. -->
							<button
								type="button"
								class="tag-more"
								title={showAllTags ? 'Show fewer tags' : hiddenTags.join(', ')}
								aria-expanded={showAllTags}
								onclick={() => (showAllTags = !showAllTags)}
							>
								{showAllTags ? 'Show less' : `+${hiddenTags.length} more`}
							</button>
						{/if}
						{#if order.tags.length === 0}
							<span class="fact-empty">N/A</span>
						{/if}
						<button
							type="button"
							class="icon-btn tag-toggle"
							style="width: 1.5rem; height: 1.5rem; font-size: 0.95rem;"
							title={editingTags ? 'Close tag editor' : 'Add or edit tags'}
							aria-label={editingTags ? 'Close tag editor' : 'Add or edit tags'}
							aria-expanded={editingTags}
							onclick={() => (editingTags = !editingTags)}
						>
							{editingTags ? '−' : '+'}
						</button>
					</dd>
				</div>

				<div class="fact">
					<dt>Follow-up</dt>
					<dd>
						<strong class="fact-value" class:due={order.followUpDue}
							>{fmtDate(order.nextFollowUpAt)}</strong
						>
						<div class="fu-anchor">
							<button
								type="button"
								class="icon-btn"
								style="width: 1.5rem; height: 1.5rem; font-size: 0.9rem;"
								title="Snooze or set follow-up"
								aria-label="Snooze or set follow-up"
								aria-expanded={snoozeOpen}
								onclick={() => (snoozeOpen = !snoozeOpen)}>⏰</button
							>
							{#if snoozeOpen}
								{@render followUpPop()}
							{/if}
						</div>
					</dd>
				</div>

				<!-- Files, reached the same way tags and the customer are: a control on
				     the header that opens in place. It was a tab, which made a thing you
				     dip into for one file cost a whole view. -->
				<div class="fact">
					<dt>Files</dt>
					<dd>
						{#if data.documents.length === 0}
							<span class="fact-empty">N/A</span>
						{:else}
							<span class="fact-value">{data.documents.length}</span>
						{/if}
						<button
							type="button"
							class="icon-btn"
							class:on={filesOpen}
							style="width: 1.5rem; height: 1.5rem; font-size: 0.85rem;"
							title={filesOpen ? 'Close files' : 'Files on this order'}
							aria-label={filesOpen ? 'Close files' : 'Files on this order'}
							aria-expanded={filesOpen}
							onclick={() => (filesOpen = !filesOpen)}>📎</button
						>
					</dd>
				</div>
			</dl>

			{#if filesOpen}
				<InlineEditor title="Files" onclose={() => (filesOpen = false)}>
					{#snippet actions()}
						<!-- Upload + rules live in the editor's header, next to the title and
						     close — the same place the Customer editor keeps its contact button,
						     so the two panels read alike and "Files" is not printed twice. -->
						<form
							method="POST"
							action="?/uploadDocuments"
							enctype="multipart/form-data"
							use:enhance
							class="file-actions"
						>
							<!-- Styled trigger for a hidden file input; picking uploads. Several at
							     once, and one refusal never costs the rest of the batch. -->
							<label class="add-file">
								📎 Add files
								<input
									type="file"
									name="file"
									multiple
									accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
									required
									onchange={(e) => e.currentTarget.form?.requestSubmit()}
									class="sr-file"
								/>
							</label>
							<button
								type="button"
								class="bare-icon"
								title="Document rules"
								aria-label="Document rules"
								onclick={() => infoDialog?.showModal()}>ℹ️</button
							>
						</form>
					{/snippet}
					{@render filesPanel()}
				</InlineEditor>
			{/if}

			<!-- Both editors open in place, directly under the thing they edit, rather
			     than as cards further down the page — the toggle and the surface it
			     opens stay within a glance of each other. -->
			{#if editingTags}
				<InlineEditor title="Tags" onclose={() => (editingTags = false)}>
					<form
						method="POST"
						action="?/setTags"
						use:enhance={() =>
							async ({ update }) => {
								editingTags = false;
								await update();
							}}
						class="editor-form"
					>
						<TagPicker value={order.tags} />
						<div class="editor-footer">
							<button type="submit" class="editor-save">Save tags</button>
						</div>
					</form>
				</InlineEditor>
			{/if}
		</header>

		{#if form?.message}
			<p
				style="margin: 0; color: #cf222e; font-size: 0.9rem; background: #ffebe9; border: 1px solid #ffd7d5; border-radius: 10px; padding: 0.6rem 0.8rem;"
			>
				{form.message}
			</p>
		{/if}

		<!-- One row of the crew picker, shared by the assigned list, staged adds and
		     the search results. `currentlyAssigned` is the SERVER state — the mark and
		     highlight render the staged (effective) state on top of it. -->
		{#snippet crewRow(
			sub: { id: string; name: string; trade: string | null; tier: string },
			currentlyAssigned: boolean
		)}
			{@const effective = stagedSubs[sub.id] ?? currentlyAssigned}
			{@const pending = sub.id in stagedSubs}
			<button
				type="button"
				class="sub-row"
				class:on={effective}
				class:pending
				aria-pressed={effective}
				onclick={() => toggleSub(sub.id, currentlyAssigned)}
			>
				<span class="sub-mark" aria-hidden="true"
					>{effective ? '✓' : currentlyAssigned ? '–' : '+'}</span
				>
				<span class="sub-text">
					<span class="sub-name">{sub.name}</span>
					<span class="sub-meta">
						<span class="sub-trade">{sub.trade ?? 'Trade not set'}</span>
						<span class="tier" class:guest={sub.tier !== 'trusted'}>
							{sub.tier === 'trusted' ? 'Trusted' : 'Guest'}
						</span>
					</span>
				</span>
			</button>
		{/snippet}

		<!-- The follow-up controls, hung off the ⏰ in the header's meta row. A snippet
	     rather than inline so the row itself stays a row and not a wall. -->
		{#snippet followUpPop()}
			<!-- Same dimmed scrim the contact composer uses, so the two popovers behave
		     alike rather than one dimming the page and one not. -->
			<button
				type="button"
				aria-label="Close follow-up options"
				onclick={() => (snoozeOpen = false)}
				class="contact-scrim"
			></button>
			<div class="followup-pop">
				<!-- A titled panel rather than a bare cluster of pills. As a phone
				     bottom sheet the old version was three small buttons and a date
				     field floating in a full-width slab, which read as an unfinished
				     menu; on a surface that size the panel has to say what it is and
				     what it is currently set to. -->
				<div class="fu-head">
					<span class="fu-title">Follow up</span>
					<span class="fu-current" class:unset={!order.nextFollowUpAt}>
						{order.nextFollowUpAt ? fmtDate(order.nextFollowUpAt) : 'Not set'}
					</span>
				</div>

				<!-- Each preset shows the date it lands on. "+3 days" asks the
				     contractor to do the arithmetic; "Thu, 20 Aug" is the thing they
				     actually want to know before choosing. -->
				<div class="fu-presets">
					{#each FOLLOWUP_PRESETS as p (p.preset)}
						<form method="POST" action="?/snoozeFollowUp" use:enhance={snoozeThenClose}>
							<input type="hidden" name="preset" value={p.preset} />
							<button type="submit" class="fu-opt">
								<span class="fu-opt-label">{p.label}</span>
								<span class="fu-opt-date">{fmtShort(snoozeDate(p.preset))}</span>
							</button>
						</form>
					{/each}
				</div>

				<form method="POST" action="?/setFollowUp" use:enhance={snoozeThenClose} class="fu-set">
					<span class="fu-set-label">Or pick a date</span>
					<div class="fu-set-row">
						<input
							type="date"
							name="date"
							class="fu-date"
							aria-label="Follow-up date"
							value={toDateInput(order.nextFollowUpAt)}
						/>
						<button type="submit" class="fu-btn primary">Set</button>
					</div>
				</form>

				{#if order.nextFollowUpAt}
					<form
						method="POST"
						action="?/clearFollowUp"
						use:enhance={snoozeThenClose}
						class="fu-clear"
					>
						<button type="submit" class="fu-btn danger">Clear follow-up</button>
					</form>
				{/if}
			</div>
		{/snippet}

		<!-- Tabs. The detail page used to stack six full-width cards, which meant
		     scrolling past the customer and the files to reach the timeline. One panel
		     at a time keeps the working surface at the top of the screen. -->
		{#snippet filesPanel()}
			<div style="display: grid; gap: 0.7rem;">
				<dialog
					bind:this={infoDialog}
					style="border: none; border-radius: 16px; padding: 0; max-width: 380px; width: 92vw; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);"
				>
					<div style="padding: 1.1rem 1.2rem; display: grid; gap: 0.6rem;">
						<h3 style="margin: 0; font-size: 1rem;">Document rules</h3>
						<ul
							style="margin: 0; padding-left: 1.1rem; font-size: 0.9rem; color: #57606a; display: grid; gap: 0.3rem;"
						>
							<li>Accepted files: PNG, JPEG, WebP, GIF, or PDF.</li>
							<li>Up to {formatBytes(MAX_DOCUMENT_BYTES)} per file.</li>
							<li>
								The contents are checked, not just the name — archives and programs are refused.
							</li>
						</ul>
						<form method="dialog" style="justify-self: end;">
							<button type="submit" style={pill}>Got it</button>
						</form>
					</div>
				</dialog>

				{#if form?.message}
					<p class="upload-note">{form.message}</p>
				{/if}

				<!-- The same list and the same viewer as the customer and subcontractor
				     portals. What is specific to the contractor rides in as snippets: where
				     a document came from, whether it is new since they last looked, and the
				     controls only they have. -->
				<DocumentList
					documents={data.documents}
					empty="No documents yet."
					onopen={(d) => (preview = d)}
				>
					{#snippet badge(d)}
						<!-- Where it came from. A document the customer sent is a different
						     thing from one the contractor filed, and the list is the only place
						     that distinction is visible. -->
						{#if d.uploadedByRole && d.uploadedByRole !== 'contractor'}
							<span class="from-badge" class:sub={d.uploadedByRole === 'subcontractor'}>
								From {d.uploadedByRole === 'customer' ? data.order.customerName : 'a subcontractor'}
							</span>
						{/if}
						{#if !d.readByContractorAt}
							<span class="new-badge">New</span>
						{/if}
					{/snippet}

					{#snippet trailing(d)}
						{#if editingDocId === d.id}
							<!-- Nothing else, so the row's controls don't compete with the form
							     that replaced them. -->
						{:else if confirmingDeleteId === d.id}
							<form
								method="POST"
								action="?/deleteDocument"
								use:enhance={() => {
									return async ({ update }) => {
										confirmingDeleteId = null;
										await update();
									};
								}}
								style="display: flex; gap: 0.25rem; align-items: center;"
							>
								<input type="hidden" name="documentId" value={d.id} />
								<button type="submit" class="doc-btn danger">Delete</button>
								<button type="button" class="doc-btn" onclick={() => (confirmingDeleteId = null)}
									>Keep</button
								>
							</form>
						{:else}
							<button
								type="button"
								class="doc-icon"
								title="Edit note and tags"
								aria-label="Edit note and tags for {d.filename}"
								onclick={() => startEditDoc(d)}>✎</button
							>
							<!-- Two-step, like every other destructive control in the app: a
							     document is the only copy of something a customer sent. -->
							<button
								type="button"
								class="doc-icon"
								title="Delete document"
								aria-label="Delete {d.filename}"
								onclick={() => (confirmingDeleteId = d.id)}>🗑</button
							>
						{/if}
					{/snippet}
				</DocumentList>

				{#if editingDocId}
					<form
						method="POST"
						action="?/updateDocument"
						class="doc-edit"
						use:enhance={() => {
							return async ({ update }) => {
								editingDocId = null;
								await update();
							};
						}}
					>
						<input type="hidden" name="documentId" value={editingDocId} />
						<label class="doc-field">
							<span>What this is</span>
							<input
								name="note"
								bind:value={editingNote}
								maxlength="200"
								placeholder="Signed quote, page 2 missing…"
							/>
						</label>
						<label class="doc-field">
							<span>Tags</span>
							<input name="tags" bind:value={editingTagsValue} placeholder="permit, invoice" />
						</label>
						<div class="doc-edit-actions">
							<button type="button" class="doc-btn" onclick={() => (editingDocId = null)}
								>Cancel</button
							>
							<button type="submit" class="doc-btn primary">Save</button>
						</div>
					</form>
				{/if}
			</div>
		{/snippet}

		<div class="card panel">
			<div class="tabs" role="tablist" aria-label="Order sections">
				{#each TABS as t (t.id)}
					<button
						type="button"
						role="tab"
						id={`tab-${t.id}`}
						aria-selected={tab === t.id}
						aria-controls={`panel-${t.id}`}
						class="tab"
						class:on={tab === t.id}
						onclick={() => (tabOverride = t.id)}
					>
						{t.label}{#if t.pending > 0}<span class="tab-count as-pending">{t.pending}</span>{/if}
					</button>
				{/each}
			</div>

			<div class="panel-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
				{#if tab === 'history'}
					<div
						style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;"
					>
						<h2 style={sectionTitle}>History</h2>
						<button
							type="button"
							class="icon-btn"
							class:on={noteOpen}
							style="width: 2.1rem; height: 2.1rem; font-size: 1.05rem;"
							title="Add note"
							aria-label="Add note"
							aria-expanded={noteOpen}
							onclick={() => (noteOpen = !noteOpen)}>📝</button
						>
					</div>
					{#if noteOpen}
						<form
							method="POST"
							action="?/addNote"
							use:enhance={noteThenClose}
							style="display: flex; gap: 0.5rem; align-items: center;"
						>
							<input
								name="note"
								placeholder="Add an internal note…"
								required
								class="field-input"
								style="flex: 1;"
							/>
							<button type="submit" class="primary-btn">Add</button>
						</form>
					{/if}

					<!-- A job that has been running a while has a long history, and all of
					     it above the Workers and Messages tabs. Only the most recent few
					     are shown, with the rest one press away — and the per-entry detail
					     lines fold away too, so the list can be read as a spine of what
					     happened before deciding which entry to read properly. -->
					{#if data.timeline.length > 0}
						<div class="tl-controls">
							{#if data.timeline.length > HISTORY_PREVIEW}
								<button
									type="button"
									class="tl-toggle"
									aria-expanded={historyExpanded}
									onclick={() => (historyExpanded = !historyExpanded)}
								>
									{historyExpanded ? 'Show less' : `Show all ${data.timeline.length}`}
								</button>
							{/if}
							<button
								type="button"
								class="tl-toggle"
								aria-pressed={historyDetails}
								onclick={() => (historyDetails = !historyDetails)}
							>
								{historyDetails ? 'Hide details' : 'Show details'}
							</button>
						</div>
					{/if}

					{#if data.timeline.length === 0}
						<p style="margin: 0; color: #57606a; font-size: 0.9rem;">No activity yet.</p>
					{:else}
						<ol class="timeline" class:lean={!historyDetails}>
							{#each shownTimeline as entry, i (entry.id)}
								<!-- The newest entry (the list is newest-first) carries a little more
								     weight — an accent edge and a "Latest" marker — so the eye lands
								     on what just happened before scanning back through the rest. -->
								<li class="tl-entry" class:internal={entry.internal} class:latest={i === 0}>
									<div class="tl-head">
										<strong class="tl-title">{entry.title}</strong>
										{#if i === 0 || entry.internal}
											<span class="tl-badges">
												{#if i === 0}<span class="tl-latest">Latest</span>{/if}
												{#if entry.internal}<span class="tl-tag">internal</span>{/if}
											</span>
										{/if}
									</div>
									{#if entry.detail}<div class="tl-detail">{entry.detail}</div>{/if}
									<div class="tl-meta">
										{new Date(entry.createdAt).toLocaleString()} · {entry.authorRole}
									</div>
								</li>
							{/each}
						</ol>
					{/if}
				{:else if tab === 'workers'}
					<!-- The commit control lives up here: while changes are staged, the
					     roster link hands its corner to a compact save + discard pair, so
					     confirming is one glance up instead of a banner under the list. -->
					<div
						style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;"
					>
						<h2 style={sectionTitle}>Workers</h2>
						{#if stagedCount > 0}
							<div class="subs-commit">
								<button type="button" class="sub-discard" onclick={() => (stagedSubs = {})}
									>Discard</button
								>
								<form
									method="POST"
									action="?/saveSubs"
									use:enhance={() =>
										async ({ result, update }) => {
											await update();
											if (result.type === 'success') {
												stagedSubs = {};
												subQuery = '';
											}
										}}
								>
									<input type="hidden" name="assign" value={stagedAssign.join(',')} />
									<input type="hidden" name="unassign" value={stagedUnassign.join(',')} />
									<button type="submit" class="subs-save">
										<span aria-hidden="true">✓</span> Save {stagedCount}
									</button>
								</form>
							</div>
						{:else if hasRoster}
							<!-- Only once there is a roster to manage: with nobody on the books
							     the empty state below already offers the one useful next step,
							     and two links to the same page is one too many. -->
							<a class="panel-link" href={resolve('/contractor/subcontractors')}>Manage roster →</a>
						{/if}
					</div>

					{#if !hasRoster}
						<!-- Nothing to explain here: an empty roster has exactly one useful
						     next step, so it's a button rather than a sentence about one. -->
						<div class="panel-empty">
							<span class="empty-mark" aria-hidden="true">👷</span>
							<p class="editor-note">No subcontractors found</p>
							<a class="subs-empty-cta" href={resolve('/contractor/subcontractors')}
								>Add subcontractors</a
							>
						</div>
					{:else}
						<!-- The crew on this job (including staged adds), then a search box to
						     pull more people in. The roster is never dumped wholesale — with a
						     few dozen subs the old flat list buried the three assigned people
						     under everyone else. -->
						{#if data.assignedSubs.length === 0 && stagedAddSubs.length === 0}
							<p class="editor-note">No one is on this job yet — search your roster below.</p>
						{:else}
							<p class="editor-note">
								Tap a row to stage a change; nothing applies until you save.
							</p>
							<div class="sub-list">
								{#each data.assignedSubs as sub (sub.id)}
									{@render crewRow(sub, true)}
								{/each}
								{#each stagedAddSubs as sub (sub.id)}
									{@render crewRow(sub, false)}
								{/each}
							</div>
						{/if}

						{#if data.availableSubs.length > 0}
							<div class="crew-add">
								<span class="crew-add-icon" aria-hidden="true">🔍</span>
								<input
									class="crew-search"
									type="search"
									placeholder="Add crew — search name or trade…"
									aria-label="Search your roster to add crew"
									bind:value={subQuery}
								/>
							</div>
							{#if subQuery.trim()}
								{#if subMatches.length === 0}
									<p class="crew-none">No one in your roster matches “{subQuery.trim()}”.</p>
								{:else}
									<div class="sub-list">
										{#each subMatches.slice(0, SUB_RESULT_LIMIT) as sub (sub.id)}
											{@render crewRow(sub, false)}
										{/each}
									</div>
									{#if subMatches.length > SUB_RESULT_LIMIT}
										<p class="crew-none">
											+{subMatches.length - SUB_RESULT_LIMIT} more — keep typing to narrow it down.
										</p>
									{/if}
								{/if}
							{/if}
						{/if}
					{/if}
				{:else if tab === 'messages'}
					<h2 style={sectionTitle}>Messages</h2>

					{#if data.customerLinked}
						<p class="msg-lede">
							Your conversation with {data.order.customerName}. They see this in their portal.
						</p>

						<!-- The same component the customer sees this conversation through. Two
						     ends of one Thread should not be able to drift apart, which is exactly
						     what happened while each surface rendered its own. Only the palette
						     differs — "mine" is the safety yellow here, teal in the portal. -->
						<MessageThread
							messages={data.thread}
							mineRole="contractor"
							otherName={data.order.customerName ?? 'your customer'}
							empty="No messages yet — say the first thing."
						/>

						<MessageComposer
							action="?/replyToCustomer"
							placeholder="Reply to {data.order.customerName}…"
						/>
						{#if form?.action === 'replyToCustomer' && form?.message}
							<p class="msg-note">{form.message}</p>
						{/if}
					{:else}
						<!-- No portal, so there is no conversation to show and nothing a reply
						     could land in. This used to be an empty thread box, a disabled
						     composer AND a sentence explaining the disabled composer — three
						     pieces of furniture around one absent thing. It is now the single
						     action that changes the situation. -->
						<div class="panel-empty">
							<span class="empty-mark" aria-hidden="true">✉</span>
							<p class="msg-invite-lede">
								{data.order.customerName ?? 'This customer'} isn’t on their portal yet. Invite them and
								your conversation starts here.
							</p>
							{#if order.customerId}
								<form method="POST" action="?/sendInvite" use:enhance={inviteEnhance}>
									<input type="hidden" name="customerId" value={order.customerId} />
									{#if openInviteId}
										<input type="hidden" name="inviteId" value={openInviteId} />
									{/if}
									<button type="submit" class="msg-invite-send" disabled={inviting}>
										{inviting
											? 'Sending…'
											: data.portal.state === 'none'
												? 'Send invite'
												: 'Resend invite'}
									</button>
								</form>
								{#if data.portal.state === 'pending'}
									<span class="msg-invite-status">
										Invite sent · expires {fmtDate(data.portal.expiresAt ?? null)}
									</span>
								{:else if data.portal.state === 'expired'}
									<span class="msg-invite-status">The last invite expired.</span>
								{/if}
							{/if}
							{#if form?.action === 'invite' && form?.message}
								<span class="msg-invite-status">{form.message}</span>
							{/if}
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Once an order is ended, the record of how. The ways to end it live in the
		     status modal (⚙), next to the interim states. -->
		{#if isTerminal}
			<div class="closeout-summary" class:done={order.state === 'Work Complete'}>
				{#if order.state === 'Work Complete'}
					<span class="cs-badge done">✓ Completed</span>
					<dl class="cs-facts">
						{#if order.finalAmountCents != null}
							<div>
								<dt>Final invoice</dt>
								<dd>{formatCents(order.finalAmountCents)}</dd>
							</div>
						{/if}
						<div>
							<dt>Payment</dt>
							<dd>
								{#if order.paidAt}
									Received{order.paymentMethod
										? ` · ${paymentMethodLabel(order.paymentMethod)}`
										: ''}
								{:else}
									<span class="cs-muted">Not recorded as paid</span>
								{/if}
							</dd>
						</div>
					</dl>
					{#if order.finalNotes}<p class="cs-notes">{order.finalNotes}</p>{/if}
				{:else}
					<span class="cs-badge stop">Cancelled</span>
				{/if}
			</div>
		{/if}

		<!-- Deleting an order is rare and irreversible, so it sits quietly at the foot
		     of the page as a plain link — no card, no heading. It only grows teeth once
		     you ask for it. -->
		<div class="footer-danger">
			{#if confirmingDelete}
				<div class="danger-confirm" role="alert">
					<span>Delete this order and its entire timeline? This can’t be undone.</span>
					<span class="danger-actions">
						<form method="POST" action="?/deleteOrder" use:enhance>
							<button type="submit" class="danger-yes">Yes, delete</button>
						</form>
						<button type="button" class="danger-no" onclick={() => (confirmingDelete = false)}
							>Cancel</button
						>
					</span>
				</div>
			{:else}
				<button type="button" class="danger-link" onclick={() => (confirmingDelete = true)}
					>Delete this order</button
				>
			{/if}
		</div>
	</div>
</div>

<DocumentViewer bind:open={preview} />

<!-- One full-screen modal for every status change: pick an interim stage, or close
     the order out (complete / cancel). Opened by the ⚙ next to the status badge. -->
{#if statusModal}
	{@const title =
		statusModal === 'complete'
			? 'Complete order'
			: statusModal === 'cancel'
				? 'Cancel order'
				: 'Update status'}
	<div class="co-overlay" role="dialog" aria-modal="true" aria-label={title}>
		<button
			type="button"
			class="co-backdrop"
			aria-label="Close"
			onclick={() => (statusModal = null)}
		></button>
		<div class="co-sheet">
			<div class="co-head">
				<h2>{title}</h2>
				<button type="button" class="co-x" aria-label="Close" onclick={() => (statusModal = null)}
					>✕</button
				>
			</div>

			{#if statusModal === 'status'}
				<form
					method="POST"
					action="?/updateStatus"
					use:enhance={statusThenClose}
					class="co-form no-sticky"
				>
					<p class="co-lede">
						Move {order.projectName ?? 'this project'} to a new stage — the customer sees the change.
					</p>
					<div class="st-options" role="radiogroup" aria-label="Order status">
						{#each interimStates as s (s)}
							<label class="st-option" class:on={statusDraft === s}>
								<input type="radio" name="state" value={s} bind:group={statusDraft} />
								<span class="st-name">{s}</span>
								{#if s === order.state}<span class="st-current">Current</span>{/if}
							</label>
						{/each}
					</div>
					<label class="co-check st-note-check">
						<input type="checkbox" bind:checked={noteFieldOpen} />
						<span>Add an internal note</span>
					</label>
					{#if noteFieldOpen}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							autofocus
							name="note"
							bind:value={statusNote}
							class="st-input st-note-input"
							placeholder="Why the change — the customer never sees this"
							aria-label="Internal note"
						/>
					{/if}
					<button type="submit" class="co-save st-save" disabled={!statusDirty}>Save status</button>

					{#if !isTerminal}
						<div class="st-closeout">
							<span class="st-closeout-label">or close this order out</span>
							<div class="st-closeout-buttons">
								<button
									type="button"
									class="closeout-complete"
									onclick={() => (statusModal = 'complete')}
								>
									<span aria-hidden="true">✓</span> Complete order
								</button>
								<button
									type="button"
									class="closeout-cancel"
									onclick={() => (statusModal = 'cancel')}
								>
									Cancel order
								</button>
							</div>
						</div>
					{/if}
				</form>
			{:else if statusModal === 'complete'}
				<form
					method="POST"
					action="?/completeOrder"
					use:enhance={closeoutThenClose('complete')}
					class="co-form"
				>
					<p class="co-lede">
						Record the final invoice and payment for {order.projectName ?? 'this project'}.
					</p>
					<label class="co-field">
						<span>Final invoice total</span>
						<div class="co-amount">
							<span class="co-cur" aria-hidden="true">$</span>
							<input
								name="amount"
								inputmode="decimal"
								placeholder="0.00"
								value={order.finalAmountCents != null
									? (order.finalAmountCents / 100).toFixed(2)
									: ''}
							/>
						</div>
					</label>
					<label class="co-field">
						<span>Details (optional)</span>
						<textarea name="notes" rows="3" placeholder="What this invoice covers…"
							>{order.finalNotes ?? ''}</textarea
						>
					</label>
					<label class="co-check">
						<input type="checkbox" name="markPaid" bind:checked={markPaid} />
						<span>Mark final payment received</span>
					</label>
					{#if markPaid}
						<div class="co-methods" role="radiogroup" aria-label="Payment method">
							{#each PAYMENT_METHODS as m (m)}
								<label class="co-method" class:on={payMethod === m}>
									<input type="radio" name="paymentMethod" value={m} bind:group={payMethod} />
									{paymentMethodLabel(m)}
								</label>
							{/each}
						</div>
					{/if}
					<label class="co-check">
						<input type="checkbox" name="sendInvoice" />
						<span>Email the final invoice to {order.customerName}</span>
					</label>
					<div class="co-actions">
						<button type="button" class="co-cancel" onclick={() => (statusModal = 'status')}
							>Back</button
						>
						<button type="submit" class="co-save">Complete order</button>
					</div>
				</form>
			{:else}
				<form
					method="POST"
					action="?/cancelOrder"
					use:enhance={closeoutThenClose('cancel')}
					class="co-form"
				>
					<p class="co-lede">
						Cancel {order.projectName ?? 'this project'}. This closes the order out.
					</p>
					<label class="co-field">
						<span>Reason (optional — kept internal)</span>
						<textarea name="reason" rows="3" placeholder="Why is this being cancelled?"></textarea>
					</label>
					<label class="co-check">
						<input type="checkbox" name="notify" />
						<span>Let {order.customerName} know it was cancelled</span>
					</label>
					<div class="co-actions">
						<button type="button" class="co-cancel" onclick={() => (statusModal = 'status')}
							>Back</button
						>
						<button type="submit" class="co-save danger">Cancel order</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Page canvas. In light this is the familiar sunken grey; in dark it has to be
	   *darker* than the cards sitting on it (the old #f6f8fa literal got remapped
	   to a raised grey, so cards read as holes punched into the page). */
	.order-shell {
		background: var(--surface-sunken);
		min-height: 100%;
	}
	.page {
		max-width: 1040px;
		margin: 0 auto;
		padding: 1.25rem 1rem 2.5rem;
		display: grid;
		gap: 1rem;
	}
	/* Header. The title row is always two columns — project + customer on the left,
	   status across from them on the right — because the status is *about* the title
	   and reads as a caption to it. The prompts and follow-up sit full width below,
	   where they have room to wrap on a phone. */
	/* The header stacks four things — title block, any open editor, follow-up, and
	   the file prompt. They were 0.6rem apart with the title and customer line
	   almost touching, which read as one dense clump rather than a hierarchy. */
	.order-head {
		display: grid;
		/* Both of these are load-bearing on a phone. As a grid item of .page the
		   header defaults to min-width:auto, so its widest content sets a floor and
		   pushes past the viewport; and its own implicit column does the same to the
		   editors inside it. `.panel` (the tab card) carries the same min-width:0,
		   which is why that one has always fitted. */
		min-width: 0;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.9rem;
	}
	/* The header sits on the page's sunken canvas — and so did the inline editors it
	   opens (customer, files, tags), a sunken panel on a sunken page, which is why an
	   expanded card barely showed. Raise them onto the card surface with a soft shadow
	   so opening one clearly lifts a panel out of the header. Scoped to this header so
	   inline editors elsewhere (which sit on lighter backgrounds) are untouched. */
	.order-head :global(.inline-editor) {
		background: var(--surface);
		box-shadow: var(--card-shadow);
	}
	/* Back link and status on one line, above the title. */
	.head-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-width: 0;
	}
	.back-link {
		flex: none;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--fg-muted);
		text-decoration: none;
	}
	.back-link:hover {
		color: var(--fg);
	}
	/* Title and customer line only. The editors and the tags row are siblings of
	   .head-top, not children of this column — inside it they were boxed into
	   whatever width the status badge left over, which on a phone is not much. */
	.head-main {
		flex: 1;
		display: grid;
		gap: 0.35rem;
		min-width: 0;
	}

	/* Toggle icon button in its open state — filled accent so the "hide" (✕)
	   state is clearly on. */
	.icon-btn.on {
		background: #ece7fb;
		color: #4b2fa8;
	}
	.icon-btn.on:hover {
		background: #e2daf7;
	}
	/* The document rows themselves live in DocumentList. What stays here is only
	   what the contractor has and the other surfaces do not. */
	.add-file {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg);
		cursor: pointer;
		font-weight: 600;
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.sr-file {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
	.upload-note {
		margin: 0;
		font-size: 0.8rem;
		color: var(--fg-muted);
	}
	.doc-icon {
		border: none;
		background: none;
		cursor: pointer;
		color: var(--fg-muted);
		font-size: 0.95rem;
		padding: 0.2rem 0.35rem;
		line-height: 1;
	}
	.doc-icon:hover,
	.doc-icon:focus-visible {
		color: var(--fg);
	}
	.doc-btn {
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.doc-btn.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
	.doc-btn.primary {
		background: var(--yellow);
		border-color: var(--yellow-deep);
		color: var(--on-yellow);
	}
	/* New since the contractor last opened this order's files. */
	.new-badge {
		display: inline-block;
		margin: 0.2rem 0 0 0.3rem;
		font-size: 0.66rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: var(--danger);
		color: #fff;
	}
	/* Inset within the Files editor (which is now the raised card surface), so the
	   edit form reads as a well sunk into the panel rather than another floating card. */
	.doc-edit {
		display: grid;
		gap: 0.5rem;
		padding: 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		background: var(--surface-sunken);
	}
	.doc-field {
		display: grid;
		gap: 0.2rem;
		font-size: 0.75rem;
		color: var(--fg-muted);
	}
	.doc-field input {
		padding: 0.45rem 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--field-border);
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.85rem;
	}
	.doc-edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.4rem;
	}

	/* Provenance chip on a file the contractor didn't upload. */
	.from-badge {
		display: inline-block;
		margin-top: 0.2rem;
		font-size: 0.66rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--yellow) 30%, transparent);
		border: 1px solid var(--yellow-deep);
		color: var(--fg);
	}
	.from-badge.sub {
		background: var(--surface-sunken);
		border-color: var(--line-strong);
		color: var(--fg-muted);
	}

	/* ------------------------------------------------------------- Messages
	   The conversation with the customer, styled as a thread rather than a rail so
	   it reads as speech and not as job history. Mirrors the customer portal's own
	   bubbles, with the sides swapped: "mine" is the contractor here. */
	.msg-lede {
		margin: -0.2rem 0 0;
		color: var(--fg-muted);
		font-size: 0.85rem;
	}
	/* The thread itself is MessageThread's; what stays here is its palette, the
	   lede, the reply composer and the note under it.

	   The palette is set as custom properties on this panel rather than passed
	   inline on the component, because it needs a dark-mode variant and inline
	   style props cannot carry one.

	   What it fixes: "mine" used to be a solid `--yellow` fill with `--ink` text.
	   `--ink` FLIPS to near-white in dark mode (app.css), so the bubbles came out
	   white-on-light-yellow and unreadable — and even in light mode a saturated
	   #ffcc00 slab is a lot of shouting for something you wrote yourself. It is
	   now a wash of the same yellow over the surface, with ordinary body text on
	   it: still unmistakably "yours", no longer the loudest thing on the page. */

	.msg-note {
		margin: 0;
		font-size: 0.82rem;
		color: var(--fg-muted);
	}

	.msg-invite-lede {
		margin: 0;
		max-width: 38ch;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.msg-invite-send {
		padding: 0.5rem 1.2rem;
		border: none;
		border-radius: 999px;
		background: var(--yellow);
		color: var(--on-yellow);
		font-family: inherit;
		font-size: 0.88rem;
		font-weight: 800;
		cursor: pointer;
	}
	.msg-invite-send:hover:not(:disabled) {
		background: var(--yellow-deep);
	}
	.msg-invite-send:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.msg-invite-status {
		font-size: 0.78rem;
		color: var(--fg-muted);
	}

	/* -------------------------------------------------------------- History
	   A rail with a dot per entry. Everything is token-driven; the internal
	   (contractor-only) entries carry a warm amber tint that has a dark
	   counterpart instead of the old cream-on-dark literals. */
	.tl-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.tl-toggle {
		padding: 0.25rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: none;
		letter-spacing: normal;
		cursor: pointer;
	}
	.tl-toggle:hover {
		color: var(--fg);
		border-color: var(--fg-muted);
	}
	.tl-toggle[aria-pressed='false'] {
		background: var(--surface-sunken);
	}
	/* Details folded away: the list becomes a spine of what happened and when.
	   Not `:global()` — .tl-detail is rendered by this component, so it carries
	   the scope hash and a global selector would match nothing. */
	.timeline.lean .tl-detail {
		display: none;
	}

	.timeline {
		list-style: none;
		margin: 0;
		padding: 0 0 0 0.9rem;
		display: grid;
		gap: 0.5rem;
		border-left: 2px solid var(--line);
	}
	.tl-entry {
		position: relative;
		padding: 0.65rem 0.75rem;
		border-radius: 10px;
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		display: grid;
		gap: 0.2rem;
	}
	/* The dot on the rail, aligned with the entry's title line. */
	.tl-entry::before {
		content: '';
		position: absolute;
		left: -1.24rem;
		top: 0.95rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: var(--line-strong);
		/* Ring in the card colour so the dot punches through the rail cleanly. */
		border: 2px solid var(--surface);
		box-sizing: content-box;
	}
	.tl-entry.internal {
		background: #fffdf5;
		border-color: #f0e6c0;
	}
	.tl-entry.internal::before {
		background: #d4a72c;
	}
	/* The most recent entry, lifted just enough to catch the eye first: an accent
	   left edge, a hair more contrast than the entries below it, and a soft shadow.
	   After .internal so it wins the shared dot when the newest entry is also a note. */
	.tl-entry.latest {
		background: var(--surface);
		border-color: var(--yellow-deep);
		border-left-width: 3px;
		box-shadow: var(--pop-shadow-sm);
	}
	.tl-entry.latest::before {
		background: var(--yellow-deep);
	}
	.tl-title {
		font-size: 0.92rem;
		color: var(--fg);
	}
	.tl-head {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: baseline;
	}
	/* Latest + internal markers sit together on the right of the head, so the title
	   keeps the left edge rather than being spread across the row. */
	.tl-badges {
		flex-shrink: 0;
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
	}
	/* The "Latest" marker — the accent pill, matching the app's other waiting/active
	   signals rather than shouting in red. */
	.tl-latest {
		flex-shrink: 0;
		font-size: 0.62rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--on-yellow);
		background: var(--yellow);
		border: 1px solid var(--yellow-deep);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
	}
	.tl-tag {
		flex-shrink: 0;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9a6700;
	}
	.tl-detail {
		font-size: 0.9rem;
		color: var(--fg-muted);
		white-space: pre-wrap;
	}
	.tl-meta {
		font-size: 0.75rem;
		color: var(--fg-muted);
	}

	/* The page's filled submit — add-note and save-status. Was an inline blue fill
	   relying on the `[style*='background: #0969da']` interception in app.css to
	   turn into the theme button; drawn from the tokens directly instead, so it
	   can't fall through to blue. */
	.primary-btn {
		padding: 0.55rem 1rem;
		border-radius: 999px;
		border: none;
		/* Pinned dark: yellow stays light in both themes. */
		background: var(--yellow);
		color: var(--on-yellow);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.primary-btn:hover:not(:disabled) {
		background: var(--yellow-deep);
	}

	/* The status-view Save stays inert until a different stage is picked; greyed out
	   (not just dimmed) so "nothing to save" reads without hovering. */
	.co-save:disabled {
		cursor: not-allowed;
		filter: grayscale(1);
		opacity: 0.5;
		box-shadow: none;
	}
	/* Interim-stage picker: a row per stage, the current one marked, filling the
	   modal's width rather than a cramped dropdown. */
	.st-options {
		display: grid;
		gap: 0.3rem;
	}
	.st-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 0.8rem;
		border: 1.5px solid var(--line-strong);
		border-radius: 12px;
		background: var(--surface);
		cursor: pointer;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--fg);
	}
	.st-option:hover {
		border-color: var(--fg-muted);
	}
	.st-option.on {
		border-color: var(--yellow-deep);
		background: color-mix(in srgb, var(--yellow) 16%, var(--surface));
	}
	.st-option input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.st-name {
		flex: 1;
		min-width: 0;
	}
	.st-current {
		flex: none;
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-muted);
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
	}
	.st-input {
		width: 100%;
		box-sizing: border-box;
		min-height: 2.6rem;
		padding: 0.55rem 0.7rem;
		border-radius: 10px;
		border: 1px solid var(--field-border);
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 400;
	}
	.st-input:focus {
		outline: none;
		border-color: var(--yellow-deep);
		box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.22);
		background: var(--field-bg-focus);
	}
	/* Small and quiet: the note is an occasional extra on a status change, so its
	   toggle should read as a footnote to the stage picker, not as a second field
	   of equal weight.

	   Doubled up on `.co-check` rather than written alone: a bare `.st-note-check`
	   ties `.co-check` on specificity and LOSES, because `.co-check` is declared
	   further down this stylesheet. */
	.co-check.st-note-check {
		justify-self: start;
		font-size: 0.82rem;
		color: var(--fg-muted);
	}
	.co-check.st-note-check input {
		width: 0.95rem;
		height: 0.95rem;
		accent-color: var(--yellow-deep);
	}
	.co-check.st-note-check:hover {
		color: var(--fg);
	}
	.st-note-input {
		margin-top: -0.2rem;
	}
	.st-save {
		justify-self: stretch;
		text-align: center;
	}
	/* The two ways to close the order out, under a labelled divider so they read as
	   the alternative to setting an interim stage rather than more of the same. */
	.st-closeout {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.3rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--line);
	}
	.st-closeout-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-muted);
		text-align: center;
	}
	.st-closeout-buttons {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	/* The order title should read as a title but stay subtle — no chunky yellow
	   hero box, and a normal-weight font instead of the heavy display face.
	   The customer carries the line, so it takes the full text colour and the
	   location trails it in muted — the whole line used to sit at one muted weight,
	   which gave the eye nothing to land on. */
	.order-sub {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.3rem;
		font-size: 0.95rem;
		font-weight: 500;
		line-height: 1.5;
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}
	.sub-customer {
		font-weight: 700;
		color: var(--fg);
	}
	.sub-sep {
		opacity: 0.55;
	}
	/* What's on the job, listed under the customer line. Labelled rather than a bare
	   run of chips so tags and subcontractors don't read as one undifferentiated
	   pile once both are present. */
	/* Tags, follow-up and files as three bordered widgets rather than three runs
	   of loose text.

	   They were `LABEL value ⊕` triplets separated only by whitespace, so on any
	   width where they shared a line you could not tell where one ended and the
	   next began — "TAGS cedar FOLLOW-UP 20 Aug FILES 3" reads as one sentence.
	   Giving each a border and its own padding makes them three things, and drops
	   the shouty uppercase labels for sentence case now that the boundary is
	   doing that work. */
	.order-facts {
		display: flex;
		flex-wrap: wrap;
		min-width: 0;
		gap: 0.4rem;
		margin: 0;
	}
	.fact {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
		padding: 0.3rem 0.5rem 0.3rem 0.65rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-sunken);
	}
	.fact dt {
		flex: none;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--fg-muted);
	}
	.fact dd {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		margin: 0;
		min-width: 0;
	}
	.fact-empty {
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	/* A fact's value, where it is a value rather than a run of chips. */
	.fact-value {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--fg);
	}
	.fact-value.due {
		color: var(--danger);
	}
	/* Reads as a tag chip, behaves as a control — it's the overflow count, so it
	   belongs to the run of chips rather than standing apart from it. */
	.tag-more {
		padding: 0.1rem 0.55rem;
		border-radius: 999px;
		border: 1px dashed var(--line-strong);
		background: transparent;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 1.5;
		white-space: nowrap;
		cursor: pointer;
	}
	.tag-more:hover {
		border-color: var(--fg-muted);
		color: var(--fg);
	}
	.tag-more:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 1px;
	}
	/* Nudged off the chips so the toggle doesn't read as one of them. */
	.tag-toggle {
		margin-left: 0.15rem;
		font-weight: 700;
	}
	/* The project type rides the title without competing with it. */
	.order-type {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--fg-muted);
	}
	.order-title {
		margin: 0;
		font-family: 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif;
		font-size: 1.6rem;
		overflow-wrap: anywhere;
		font-weight: 700;
		line-height: 1.25;
		letter-spacing: -0.015em;
		text-transform: none;
		color: #1f2328;
		background: none;
		border: none;
		border-radius: 0;
		box-shadow: none;
		padding: 0;
		display: block;
	}

	/* ---------------------------------------------------------------- Tabs
	   The strip lives inside the panel card and underlines the active tab — the
	   same treatment as the subcontractor detail pane — so it reads as one object
	   rather than buttons floating above a box. Scrolls sideways on narrow screens
	   instead of wrapping to two rows and shoving the content down. */
	.panel {
		min-width: 0;
		gap: 0;
		padding: 0;
		overflow: hidden;
	}
	/* Three tabs sharing the strip evenly rather than bunched at the left with a
	   long empty tail — with only three of them there is nothing for that space to
	   be saving. Each is a full-height target, which is what a thumb wants. */
	.tabs {
		display: flex;
		gap: 0.15rem;
		padding: 0 0.35rem;
		border-bottom: 1px solid var(--line);
		background: var(--surface-sunken);
	}
	.tab {
		flex: 1 1 0;
		min-width: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.8rem 0.85rem;
		border: none;
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		white-space: nowrap;
		cursor: pointer;
		border-bottom: 3px solid transparent;
		margin-bottom: -1px;
	}
	.tab:hover {
		color: var(--fg);
	}
	.tab.on {
		color: var(--fg);
		border-bottom-color: var(--yellow-deep);
	}
	.tab:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: -3px;
	}
	.tab-count {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--line);
		color: var(--fg-muted);
		font-size: 0.7rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	/* Pinned dark: yellow stays light in both themes. */
	.tab.on .tab-count {
		background: var(--yellow);
		color: var(--on-yellow);
	}
	/* Unanswered messages. The one count on this strip that is a notification
	   rather than an inventory, so it is the only one that carries the accent —
	   and it keeps it while the tab is selected, because selecting the tab is not
	   answering. Accent rather than --danger, matching every other waiting count
	   in the app: docs/adr/0009-waiting-counts-use-the-accent-not-danger.md. */
	.tab-count.as-pending,
	.tab.on .tab-count.as-pending {
		background: var(--yellow);
		border-color: var(--yellow-deep);
		color: var(--on-yellow);
	}
	/* Quiet link in a panel's header row, across from its title. */
	.panel-link {
		flex: none;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--fg-muted);
		text-decoration: none;
		white-space: nowrap;
	}
	.panel-link:hover {
		color: var(--fg);
		text-decoration: underline;
	}

	/* ------------------------------------------------ Subcontractor picker
	   A row per person rather than a pill: the trade and tier were previously only
	   in a title tooltip, which a phone never shows, so picking came down to
	   recognising a name. The mark on the left carries the on/off state. */
	.sub-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
		gap: 0.5rem;
	}
	.sub-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		/* No global border-box in this app — every `width: 100%` next to padding
		   needs this or it overflows its grid cell by the padding. */
		box-sizing: border-box;
		padding: 0.55rem 0.7rem;
		border: 1.5px solid var(--line-strong);
		border-radius: 12px;
		background: var(--surface);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.12s ease,
			background 0.12s ease;
	}
	.sub-row:hover {
		border-color: var(--fg-muted);
	}
	.sub-row:focus-visible {
		outline: 2px solid var(--yellow-deep);
		outline-offset: 2px;
	}
	.sub-row.on {
		border-color: var(--yellow-deep);
		background: color-mix(in srgb, var(--yellow) 16%, var(--surface));
	}
	.sub-mark {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		color: var(--fg-muted);
		font-size: 0.8rem;
		font-weight: 700;
		line-height: 1;
	}
	.sub-row.on .sub-mark {
		background: var(--yellow);
		border-color: var(--yellow-deep);
		color: var(--on-yellow);
	}
	/* A staged, uncommitted toggle: dashed amber so it clearly isn't saved yet.
	   The header's "✓ Save N" is the other half of the signal. */
	.sub-row.pending {
		border-style: dashed;
		border-color: var(--yellow-deep);
	}

	/* The add box: the roster only ever appears as search matches under it. */
	.crew-add {
		position: relative;
		margin-top: 0.35rem;
	}
	.crew-add-icon {
		position: absolute;
		left: 0.7rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: 0.85rem;
		color: #8c959f;
		pointer-events: none;
	}
	.crew-search {
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.75rem 0.55rem 2.2rem;
		border: 1px solid var(--field-border);
		border-radius: 10px;
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.92rem;
	}
	.crew-search:focus {
		outline: none;
		border-color: var(--yellow-deep);
		box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.22);
		background: var(--field-bg-focus);
	}
	.crew-none {
		margin: 0;
		font-size: 0.82rem;
		color: var(--fg-muted);
	}

	/* The header commit pair: discard as quiet text, save as a compact yellow
	   pill carrying the staged count. */
	.subs-commit {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
	}
	.subs-save {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.85rem;
		border: none;
		border-radius: 999px;
		background: var(--yellow);
		color: var(--on-yellow);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.subs-save:hover {
		background: var(--yellow-deep);
	}
	.subs-save:focus-visible {
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
	.sub-discard {
		border: none;
		background: none;
		padding: 0.45rem 0.6rem;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
	}
	.sub-discard:hover {
		color: var(--fg);
	}
	.sub-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.sub-name {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub-meta {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		font-size: 0.72rem;
		color: var(--fg-muted);
	}
	.sub-trade {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tier {
		flex: none;
		padding: 0.05rem 0.35rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		font-weight: 700;
	}
	.tier.guest {
		border-style: dashed;
	}

	/* A glyph on its own — no chip, no border. For secondary affordances (the
	   document-rules ℹ️) that shouldn't compete with the real controls beside them. */
	.bare-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		padding: 0;
		border: none;
		background: none;
		font-size: 1.05rem;
		line-height: 1;
		opacity: 0.75;
		cursor: pointer;
	}
	.bare-icon:hover {
		opacity: 1;
	}
	.bare-icon:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
		border-radius: 8px;
	}

	/* ----------------------------------------------------- Editor cards
	   The panel shell itself lives in InlineEditor.svelte; what's left here is only
	   what goes *inside* one. */
	.cust-facts {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35rem;
		margin: 0;
	}
	.cust-value {
		margin: 0;
		font-size: 0.88rem;
		color: var(--fg);
		overflow-wrap: anywhere;
	}
	/* Sits on the customer line the way the tag toggle sits after the tags. */
	.cust-toggle {
		margin-left: 0.15rem;
		flex: none;
	}
	.editor-note {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.subs-empty-cta {
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		background: var(--yellow);
		/* Pinned dark: yellow stays light in both themes. */
		color: var(--on-yellow);
		font-size: 0.82rem;
		font-weight: 700;
		text-decoration: none;
		white-space: nowrap;
	}
	.subs-empty-cta:hover {
		background: var(--yellow-deep);
	}
	.editor-form {
		display: grid;
		gap: 0.8rem;
	}
	/* Save reads as a footer action — right-aligned under the picker, above a hairline
	   — rather than a lone button floating at the bottom-left of the panel. */
	.editor-footer {
		display: flex;
		justify-content: flex-end;
		border-top: 1px solid var(--line);
		padding-top: 0.7rem;
	}
	/* Upload controls in the Files editor header: a compact pill and the rules glyph,
	   sized to sit on the InlineEditor's title row next to the close button. */
	.file-actions {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.file-actions .add-file {
		padding: 0.3rem 0.7rem;
		font-size: 0.8rem;
	}
	.file-actions .bare-icon {
		width: 1.6rem;
		height: 1.6rem;
		font-size: 0.95rem;
	}
	.editor-save {
		padding: 0.5rem 1rem;
		border-radius: 999px;
		border: none;
		background: var(--yellow);
		/* Pinned dark: yellow stays light in both themes. */
		color: var(--on-yellow);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 700;
		text-transform: none;
		letter-spacing: normal;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	/* ------------------------------------------------------------ Phones */
	@media (max-width: 560px) {
		/* Phones were spending roughly 2rem of every row on chrome — 0.75rem of page
		   gutter each side plus 1.2rem of card padding — before any content got a
		   look in. On a 360px screen that is a sixth of the width given over to
		   whitespace around whitespace. The gutter and the card padding both come
		   in, and the stack tightens, so the page carries appreciably more per
		   screenful without anything actually feeling cramped. */
		.page {
			padding: 0.85rem 0.6rem 2rem;
			gap: 0.7rem;
		}
		.page :global(.card) {
			padding: 0.9rem;
			border-radius: 14px;
		}
		/* The header's upper block, rebuilt for a narrow screen.

		   On desktop the status sits across from the title as a caption to it. On a
		   phone that arrangement is backwards: the pill claims a fixed column on the
		   right, the title is squeezed into whatever is left and wraps to three
		   lines, and the row ends up taller than either part needs. Wrapping the row
		   and sending the status ABOVE the title gives the name the full width — it
		   usually drops to one or two lines — and turns the status into the small
		   chip a phone layout wants it to be. */
		/* The blocks below it stack; at 0.9rem apart the tags, follow-up and files
		   rows pushed the tabs off the bottom of the screen. */
		.order-head {
			gap: 0.6rem;
		}
		.order-facts {
			gap: 0.35rem;
		}
		.fact {
			padding: 0.28rem 0.4rem 0.28rem 0.55rem;
		}
		/* Long project names shouldn't push the header sideways. */
		.order-title {
			font-size: 1.25rem;
			overflow-wrap: anywhere;
		}
		.panel-body {
			padding: 0.85rem;
		}
		.tabs {
			padding: 0 0.25rem;
		}
		.tab {
			padding: 0.7rem 0.6rem;
			font-size: 0.78rem;
		}
		/* The status sits beside a wrapping title, so keep it top-aligned and let
		   the badge shrink rather than shove the title. */
		.statusline {
			flex-shrink: 0;
		}
	}

	@media (max-width: 480px) {
		/* Full-width targets on a phone rather than a ragged wrap. */
		.editor-save {
			width: 100%;
		}
	}

	/* -------------------------------------------------------- Close out
	   The two ways to end a live order (in the status modal), and the record of how
	   once it's ended (the footer summary). */
	.closeout-complete,
	.closeout-cancel {
		flex: 1 1 12rem;
		padding: 0.7rem 1rem;
		border-radius: 12px;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
	}
	.closeout-complete {
		border: none;
		background: var(--yellow);
		color: var(--on-yellow);
		box-shadow: var(--pop-shadow-sm);
	}
	.closeout-complete:hover {
		background: var(--yellow-deep);
	}
	.closeout-cancel {
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg-muted);
	}
	.closeout-cancel:hover {
		border-color: var(--danger);
		color: var(--danger);
	}
	.closeout-summary {
		display: grid;
		gap: 0.5rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--surface);
		box-shadow: var(--card-shadow);
	}
	.cs-badge {
		justify-self: start;
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
	}
	.cs-badge.done {
		background: var(--yellow);
		color: var(--on-yellow);
		border: 1px solid var(--yellow-deep);
	}
	.cs-badge.stop {
		background: color-mix(in srgb, var(--danger) 14%, transparent);
		color: var(--danger);
		border: 1px solid var(--danger);
	}
	.cs-facts {
		margin: 0;
		display: grid;
		gap: 0.3rem;
	}
	.cs-facts > div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.9rem;
	}
	.cs-facts dt {
		color: var(--fg-muted);
	}
	.cs-facts dd {
		margin: 0;
		font-weight: 700;
		color: var(--fg);
	}
	.cs-muted {
		color: var(--fg-muted);
		font-weight: 500;
	}
	.cs-notes {
		margin: 0;
		font-size: 0.88rem;
		color: var(--fg-muted);
		white-space: pre-wrap;
	}

	/* ------------------------------------------------ Close-out modal
	   A centred sheet over a dimmed page — full-screen on a phone, a card on
	   desktop — so completing/cancelling gets the room its form needs. */
	.co-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.co-backdrop {
		position: absolute;
		inset: 0;
		border: none;
		background: rgba(15, 23, 42, 0.5);
		cursor: pointer;
	}
	.co-sheet {
		position: relative;
		z-index: 1;
		width: min(560px, 100vw);
		max-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		box-shadow: var(--card-shadow);
		overflow: hidden;
	}
	@media (min-width: 560px) {
		.co-sheet {
			max-height: 92dvh;
			border-radius: 16px;
		}
	}
	.co-head {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.9rem 1.1rem;
		border-bottom: 1px solid var(--line);
	}
	.co-head h2 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 800;
	}
	.co-x {
		flex: none;
		border: none;
		background: none;
		font-size: 1.2rem;
		line-height: 1;
		color: var(--fg-muted);
		cursor: pointer;
		padding: 0.2rem 0.35rem;
	}
	.co-x:hover {
		color: var(--fg);
	}
	.co-form {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		gap: 0.8rem;
		align-content: start;
		padding: 1rem 1.1rem 1.25rem;
	}
	.co-lede {
		margin: 0;
		font-size: 0.9rem;
		color: var(--fg-muted);
		line-height: 1.45;
	}
	.co-field {
		display: grid;
		gap: 0.3rem;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--fg-muted);
	}
	.co-field textarea {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		min-height: 4.5rem;
		padding: 0.55rem 0.7rem;
		border-radius: 10px;
		border: 1px solid var(--field-border);
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 400;
	}
	.co-field textarea:focus {
		outline: none;
		border-color: var(--yellow-deep);
		box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.22);
		background: var(--field-bg-focus);
	}
	/* Amount input with a leading $ sign. */
	.co-amount {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.1rem 0.7rem 0.1rem 0.75rem;
		border-radius: 10px;
		border: 1px solid var(--field-border);
		background: var(--field-bg);
	}
	.co-amount:focus-within {
		border-color: var(--yellow-deep);
		box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.22);
	}
	.co-cur {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--fg-muted);
	}
	.co-amount input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		padding: 0.55rem 0;
		color: var(--fg);
		font-family: inherit;
		font-size: 1.05rem;
		font-weight: 600;
	}
	.co-amount input:focus {
		outline: none;
	}
	.co-check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.92rem;
		color: var(--fg);
		cursor: pointer;
	}
	.co-check input {
		width: 1.1rem;
		height: 1.1rem;
		flex: none;
	}
	.co-methods {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.co-method {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.co-method.on {
		border-color: var(--yellow-deep);
		background: var(--yellow);
		color: var(--on-yellow);
	}
	.co-method input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	/* Sticky footer so the primary action is always reachable. */
	.co-actions {
		position: sticky;
		bottom: 0;
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		margin-top: 0.3rem;
		padding: 0.75rem 0 0.35rem;
		background: var(--surface);
		border-top: 1px solid var(--line);
	}
	.co-cancel {
		border: none;
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.9rem;
		padding: 0.55rem 0.6rem;
		cursor: pointer;
	}
	.co-cancel:hover {
		color: var(--fg);
	}
	.co-save {
		border: none;
		border-radius: 999px;
		background: var(--yellow);
		color: var(--on-yellow);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 700;
		padding: 0.55rem 1.2rem;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.co-save:hover {
		background: var(--yellow-deep);
	}
	.co-save.danger {
		background: var(--danger);
		color: #fff;
	}
	.co-save.danger:hover {
		background: color-mix(in srgb, var(--danger) 85%, #000);
	}

	/* -------------------------------------------------------- Delete order
	   A quiet link at the foot of the page rather than a titled card. */
	.footer-danger {
		display: flex;
		justify-content: center;
		padding-top: 0.25rem;
	}
	.danger-link {
		border: none;
		background: none;
		padding: 0.3rem 0.5rem;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.danger-link:hover {
		color: var(--danger);
	}
	.danger-confirm {
		display: grid;
		gap: 0.5rem;
		justify-items: center;
		text-align: center;
		padding: 0.7rem 0.9rem;
		border: 1.5px solid var(--danger);
		border-radius: 12px;
		background: color-mix(in srgb, var(--danger) 8%, var(--surface));
		font-size: 0.85rem;
		color: var(--fg);
	}
	.danger-actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		justify-content: center;
	}
	.danger-confirm button {
		padding: 0.35rem 0.85rem;
		border-radius: 999px;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
	}
	.danger-yes {
		border: 1px solid var(--danger);
		background: var(--danger);
		color: #fff;
	}
	.danger-no {
		border: none;
		background: none;
		color: var(--fg-muted);
	}
	.danger-no:hover {
		color: var(--fg);
	}

	/* Both of this panel's empty states — no conversation yet, no roster yet — are
	   the same shape: a mark, a line, and the one control that changes the
	   situation. Centred in the card on BOTH axes, because content aligned to the
	   top-left of a mostly-empty frame reads as something that failed to load
	   rather than as a deliberate "this is where X will go". One class for both so
	   they cannot drift the way the two of them already had. */
	.panel-empty {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 0.7rem;
		min-height: 13rem;
		padding: 1.5rem 1rem;
		text-align: center;
		border: 1px dashed var(--line-strong);
		border-radius: 12px;
	}
	.empty-mark {
		font-size: 1.5rem;
		line-height: 1;
		color: var(--yellow-deep);
	}

	.panel-body {
		display: grid;
		gap: 0.85rem;
		padding: 1.1rem 1.2rem;
		min-width: 0;
		--thread-max-height: 26rem;
		/* Coloured by WHO, not by which app: the contractor's own replies are yellow
		   here and yellow in the customer's portal; the customer's are teal in both.
		   MessageThread turns each hue into a wash of the surface, so nothing here
		   needs a dark-mode variant. */
		--thread-mine-hue: var(--who-contractor);
		--thread-theirs-hue: var(--who-customer);
		/* The send button is filled with the sender's own hue. Yellow is light in
		   BOTH themes, so its glyph is pinned dark rather than following a token
		   that flips. */
		--send-fg: #14171c;
	}

	/* Status badge and its ⚙️ on one line. The editor is a full-screen modal now
	   (.co-* / .st-*), not an anchored popover. */
	.statusline {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	/* ----------------------------------------------------------- Follow-up
	   A fact in the header's meta row rather than a line of its own. */
	.fu-anchor {
		position: relative;
	}
	/* Opens rightward from the ⏰. It used to be `right: 0`, which anchored the
	   panel's right edge to a button sitting near the LEFT of the header — so the
	   230px of panel extended off the left of the screen on a phone. */
	.followup-pop {
		position: absolute;
		left: 0;
		top: calc(100% + 6px);
		right: auto;
		/* Above .contact-scrim (z 90), which this shares with the contact composer. */
		z-index: 100;
		/* A definite width. `max-content` made the panel measure itself against
		   percentage-width children, which is how the presets came out ragged. */
		width: min(20rem, calc(100vw - 2rem));
		box-sizing: border-box;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
		padding: 0.7rem;
		display: grid;
		gap: 0.55rem;
	}
	.fu-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--line);
	}
	.fu-title {
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}
	.fu-current {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--fg);
	}
	.fu-current.unset {
		font-weight: 500;
		color: var(--fg-muted);
	}

	/* A vertical menu of preset rows, matching the dashboard card's snooze component
	   rather than the old grid of bordered pills. Each preset is its own <form>, so
	   the forms are dropped out of the layout with `display: contents` and the
	   buttons become the grid items. */
	.fu-presets {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.15rem;
	}
	.fu-presets form {
		display: contents;
	}
	/* A clean menu row: the label on the left, the date it lands on trailing in
	   muted so choosing does not require counting days in your head. */
	.fu-opt {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.7rem;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--fg);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.fu-opt:hover {
		background: var(--surface-sunken);
	}
	.fu-opt:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 1px;
	}
	.fu-opt-label {
		font-size: 0.8rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.fu-opt-date {
		font-size: 0.7rem;
		color: var(--fg-muted);
		white-space: nowrap;
	}
	.fu-set-label {
		display: block;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--fg-muted);
		margin-bottom: 0.3rem;
	}
	.fu-set-row {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.fu-clear {
		border-top: 1px solid var(--line);
		padding-top: 0.5rem;
	}
	/* The popover's controls used to be the page's inline `pill` / `field` style
	   constants, which are hardcoded light literals — pale pills on a dark panel.
	   Token-driven so both themes work. */
	.fu-btn {
		width: 100%;
		box-sizing: border-box;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface-sunken);
		color: var(--fg);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
	.fu-btn:hover {
		border-color: var(--fg-muted);
		background: var(--surface-inset);
	}
	.fu-btn:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 1px;
	}
	.fu-btn.primary {
		width: auto;
		flex: none;
		background: var(--yellow);
		border-color: var(--yellow-deep);
		color: var(--on-yellow);
		font-weight: 700;
	}
	.fu-btn.primary:hover {
		background: var(--yellow-deep);
	}
	.fu-btn.danger {
		color: var(--danger);
	}

	.fu-date {
		flex: 1;
		min-width: 0;
		box-sizing: border-box;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--field-border);
		border-radius: 8px;
		background: var(--field-bg);
		color: var(--fg);
		font: inherit;
		font-size: 0.85rem;
	}
	/* Bottom sheet on a phone, matching the contact composer — a panel anchored to a
	   button that sits mid-row has nowhere good to go on a narrow screen, which is
	   how it ended up running off the edge.

	   This block MUST come after the base .followup-pop rule. A media query adds no
	   specificity, so the two rules tie and source order decides; sitting up with the
	   other phone rules it lost every declaration to the base and did nothing at all.
	   Same trap as `.contact-pop.up` in app.css. */
	@media (max-width: 560px) {
		.followup-pop {
			position: fixed;
			top: auto;
			right: 0.6rem;
			bottom: 0.6rem;
			left: 0.6rem;
			width: auto;
			max-height: 80vh;
			overflow-y: auto;
			/* Roomier as a sheet than as a popover: at this size it is the whole
			   screen's worth of attention, and desktop padding on a full-width slab
			   is what made it look like a menu that had not finished loading. */
			padding: 1rem;
			gap: 0.8rem;
			border-radius: 16px 16px 12px 12px;
		}
		/* One per row. Three columns on a phone gave each preset ~30% of the width,
		   which is where the labels started truncating and the whole thing began
		   reading as three anonymous chips. */
		.fu-presets {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.4rem;
		}
		.fu-opt {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 0.6rem;
			padding: 0.7rem 0.9rem;
			text-align: left;
		}
		.fu-opt-label {
			font-size: 0.92rem;
		}
		.fu-opt-date {
			font-size: 0.8rem;
		}
		.fu-date,
		.fu-btn {
			padding: 0.6rem 0.7rem;
			font-size: 0.9rem;
		}
	}

	/* Dark theme */
	:global(:root[data-theme='dark']) .order-shell {
		/* Sit the canvas *below* the cards in elevation. */
		background: var(--paper);
	}
	:global(:root[data-theme='dark']) .tl-entry.internal {
		background: #2a2415;
		border-color: #4a3f22;
	}
	:global(:root[data-theme='dark']) .tl-entry.internal::before {
		background: #e3b341;
	}
	/* After the dark .internal rules (equal specificity) so the newest entry keeps
	   its accent even when it is also an internal note. */
	:global(:root[data-theme='dark']) .tl-entry.latest {
		background: var(--surface);
		border-color: var(--yellow-deep);
	}
	:global(:root[data-theme='dark']) .tl-entry.latest::before {
		background: var(--yellow-deep);
	}
	:global(:root[data-theme='dark']) .tl-tag {
		color: #e3b341;
	}
	:global(:root[data-theme='dark']) .icon-btn.on {
		background: #2e2a44;
		border-color: #4a3f6b;
		color: #cabff5;
	}
	:global(:root[data-theme='dark']) .icon-btn.on:hover {
		background: #383352;
	}
	:global(:root[data-theme='dark']) .order-title {
		color: var(--fg);
	}
</style>
