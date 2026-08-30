<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
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
		isCustomerActionState,
		snoozeDate,
		toDateInput,
		type ContractorOrderState,
		type DocumentRef
	} from '$lib/crm';
	import {
		customerActionSummary,
		isTaskOpen,
		openTasks,
		taskDueLabel,
		taskUrgency
	} from '$lib/tasks';
	import {
		halfOf,
		invoiceDate,
		paidFraction,
		paymentKindLabel,
		paymentLineLabel,
		PAYMENT_KINDS
	} from '$lib/invoice';
	import { coversDay, stintLabel, todayIso, workerInitials } from '$lib/worker';
	import DocumentList from '$lib/DocumentList.svelte';
	import DocumentViewer from '$lib/DocumentViewer.svelte';
	import MessageComposer from '$lib/MessageComposer.svelte';
	import MessageThread from '$lib/MessageThread.svelte';
	import ContactDialog from '$lib/ContactDialog.svelte';
	import InlineEditor from '$lib/InlineEditor.svelte';
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
					// Three outcomes now, and 'simulated' has to say so out loud: a
					// server with email dev tools on composes and records the invoice
					// but sends nothing, and a contractor told "emailed" on that box
					// would believe a customer had it.
					const outcome = result.data?.invoiceEmail;
					toast.success('Order completed', {
						detail:
							outcome === 'sent'
								? `Final invoice emailed to ${order.customerName}.`
								: outcome === 'simulated'
									? 'Invoice composed and recorded — simulation is on, so nothing was sent.'
									: outcome === 'skipped'
										? 'Invoice was not emailed — email is not configured here.'
										: undefined
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

	// Three panels. Files left the strip for an icon in the header — it is a thing
	// you reach for, not a view you sit in — which also gets the tab row down to
	// something that fits a phone without scrolling.
	//
	// Which one opens is a question about the ORDER, not a preference: a job whose
	// customer is waiting opens on the conversation, everything else on the
	// history. An explicit click overrides that for as long as you stay on the
	// page, and is dropped on navigation so the next order gets its own answer.
	type TabId = 'history' | 'messages' | 'crew' | 'billing';
	let tabOverride = $state<TabId | null>(null);
	/**
	 * Which panel opens.
	 *
	 * Owed a reply wins, because somebody is waiting on an answer. Everything else
	 * opens on the history — including a job stalled waiting on the CUSTOMER,
	 * which used to get a tab of its own to land on. It no longer needs one: what
	 * the job is waiting for is the first thing in the history panel now, so
	 * arriving there already answers "why has nothing happened".
	 */
	const tab = $derived<TabId>(tabOverride ?? (data.owesReply ? 'messages' : 'history'));

	/**
	 * On a phone, Messages is a screen rather than a section.
	 *
	 * The strip switches which pane is under it, and nothing else moved: you
	 * tapped Messages from halfway down an order and the conversation opened
	 * below the fold, with the newest message at the bottom of a 26rem box and
	 * the reply field below THAT. Two scrolls to reach the thing you pressed the
	 * tab for.
	 *
	 * So the strip goes to the top of the screen and the pane takes the rest of
	 * it: heading, thread, composer, one screenful, nothing to scroll to. The
	 * height is measured rather than written as a `calc()` of hand-totalled
	 * chrome — the strip wraps to two rows at some widths and the bottom tab bar
	 * is a setting, so both are only knowable at runtime.
	 */
	let tabsEl = $state<HTMLDivElement | null>(null);
	/** The measured height, or null where the pane should size to its content. */
	let messagesFill = $state<string | null>(null);
	/** Below this the strip is on screen and one pane shows at a time. */
	const TABBED_MAX = 1100;

	function fitMessagesPane() {
		const strip = tabsEl;
		if (!strip || window.innerWidth >= TABBED_MAX) {
			messagesFill = null;
			return;
		}
		// The fixed bottom bar is optional (Settings → Navigation), so ask the page
		// whether there is one rather than assuming its height either way.
		const bottomBar = document.querySelector('nav.bottombar');
		const room =
			window.innerHeight -
			strip.getBoundingClientRect().height -
			(bottomBar?.getBoundingClientRect().height ?? 0) -
			// The gap under the strip, and a little air under the composer.
			34;
		// Too short to be worth pinning — a landscape phone would get a two-line
		// thread. Below the floor the pane goes back to sizing to its content.
		messagesFill = room >= 280 ? `${Math.round(room)}px` : null;
	}

	$effect(() => {
		if (!tabsEl) return;
		fitMessagesPane();
		// The strip's own height changes when it wraps; the window's when the phone
		// turns or the URL bar collapses.
		const observer = new ResizeObserver(fitMessagesPane);
		observer.observe(tabsEl);
		window.addEventListener('resize', fitMessagesPane);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', fitMessagesPane);
		};
	});

	/**
	 * Switching tabs puts the strip at the top of the screen, so the pane it just
	 * switched to is the screen. Only where the strip is doing any switching —
	 * above 1100px every pane is on screen at once and scrolling the page on a
	 * click nobody made would be a surprise.
	 */
	function pickTab(id: TabId) {
		tabOverride = id;
		if (window.innerWidth >= TABBED_MAX) return;
		tick().then(() => tabsEl?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
	}
	// Only one of these carries a number, and only when it means something.
	//
	// A badge on a tab reads as a notification — as "there is something here for
	// you". "History 12" and "Workers 3" are not that; they are inventory, and
	// wearing the same treatment as a real alert taught the eye to ignore all
	// three. So the counts are gone and Messages keeps a badge for the one thing
	// that IS owed: questions the contractor has not answered.
	const TABS = $derived([
		// "Waiting on them" was here, first, wearing a count. It is not a tab any
		// more: it was on show whether or not anything was waiting, so most of the
		// time it was a permanent label advertising an empty list. What the job
		// needs from the customer sits above the history now, and only when there
		// is some — see the `.asks` block in that panel.
		{ id: 'history' as const, label: 'History', pending: 0 },
		// A peer of the history, not part of it: the history is what happened to
		// the job, the thread is what was said about it.
		{ id: 'messages' as const, label: 'Messages', pending: data.pendingReplies },
		// One tab, one list: crew and subcontractors both. It was two — labelled
		// "Workers" while assigning subs — which is the confusion this whole
		// feature exists to end.
		{ id: 'crew' as const, label: 'People', pending: 0 },
		// Money. Last, and badge-less: a balance outstanding is a fact about the
		// job, not a thing somebody is waiting on YOU for, and the counts here are
		// reserved for the two tabs where that is what a number means.
		{ id: 'billing' as const, label: 'Billing', pending: 0 }
	]);
	/** Files open in place under the header, the way the customer does. */
	let filesOpen = $state(false);

	/**
	 * Whether the order card is showing everything or just the glanceable half.
	 *
	 * Closed by default: a job is opened to DO something to it, and the scope, the
	 * site address, the on-site date and the file count are reference — four rows
	 * between the header and the work, scrolled past on every visit.
	 */
	let detailsOpen = $state(false);

	// ----------------------------------------------------------------- Asks
	// Things needed FROM the customer. Before this, the only ask the product could
	// express was money, via the two "pay me" states — so "send me the colour" went
	// in a message and scrolled away while the portal said "In progress".
	let taskAdding = $state(false);
	let taskEditId = $state<string | null>(null);
	let taskConfirmDeleteId = $state<string | null>(null);

	const openTaskList = $derived(openTasks(data.tasks));
	const doneTaskList = $derived(data.tasks.filter((t) => !isTaskOpen(t)));

	/**
	 * Today, in the contractor's timezone.
	 *
	 * Seeded during render so the server has something to send, then re-read on
	 * mount: which calendar day it is where the CREW is standing is the whole
	 * question here, and the server's day can be the wrong one. Same pattern the
	 * dashboard uses for its follow-up dates.
	 */
	let now = $state(new Date());
	onMount(() => {
		now = new Date();
	});
	const today = $derived(todayIso(now));

	/**
	 * Who is on site today, by the same rule the dashboard uses.
	 *
	 * Computed here rather than asked of the server: the stints are already loaded
	 * and `coversDay` is the one place the calendar rule lives, so a second
	 * implementation could only disagree with the first.
	 */
	const onSiteToday = $derived(
		data.assignedPeople.filter((p) => coversDay({ startsOn: p.startsOn, endsOn: p.endsOn }, today))
	);

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
	/** The document whose note is being edited, or null. */
	let editingDocId = $state<string | null>(null);
	let editingNote = $state('');

	function startEditDoc(d: { id: string; note?: string | null }) {
		confirmingDeleteId = null;
		editingDocId = d.id;
		editingNote = d.note ?? '';
	}

	// The reply box and its draft live in MessageComposer; scrolling the thread to
	// its newest message is MessageThread's. Neither is this page's business.

	// ---------------------------------------------------------------- People
	// Who is on this job — crew and subcontractors in ONE list, because that was
	// never two questions. The staged batch-save the subcontractor panel used to
	// have is gone: every assignment now carries dates that have to be typed
	// anyway, so there is a form to submit regardless and staging only added a
	// second step in front of it.
	let crewEditKey = $state<string | null>(null);
	let crewAdding = $state(false);
	let crewQuery = $state('');
	let crewConfirmRemoveKey = $state<string | null>(null);
	/** Whether the picker is showing its "somebody new" form rather than results. */
	let crewCreating = $state(false);
	/** Carried from the search box, so a name typed once isn't typed twice. */
	let crewNewName = $state('');

	/**
	 * Nobody on the books at all — not "nobody left to add to this job".
	 *
	 * The difference decides what the panel offers. With an empty roster there is
	 * nothing to search and the people page is worth pointing at (it imports, and
	 * it is where subcontractors are set up); with a full one it is a link away
	 * from the thing you came here to do.
	 */
	const rosterEmpty = $derived(
		data.availablePeople.length === 0 && data.assignedPeople.length === 0
	);

	/** Stable identity across the two tables — ids are only unique within a kind. */
	const personKey = (p: { kind: string; id: string }) => `${p.kind}-${p.id}`;

	const crewMatches = $derived.by(() => {
		const q = crewQuery.trim().toLowerCase();
		if (!q) return data.availablePeople;
		return data.availablePeople.filter((p) =>
			[p.name, p.role, p.company]
				.filter((f): f is string => Boolean(f))
				.some((f) => f.toLowerCase().includes(q))
		);
	});

	const order = $derived(data.order);

	/**
	 * The exact sentence the customer is being shown, previewed here.
	 *
	 * Same function, same inputs — a preview computed a second way is a preview
	 * that can lie. It matters because "waiting on them" is a claim the contractor
	 * is making to somebody else, and they should be able to see it as written.
	 */
	const customerSees = $derived(
		customerActionSummary({
			paymentDue: isCustomerActionState(order.state as ContractorOrderState),
			contractorName: data.contractorName,
			tasks: data.tasks,
			today
		})
	);

	// ------------------------------------------------------------------ Invoice
	// The money panel. What the job costs lives on the order; what has been paid
	// is a list of rows; the balance is the subtraction — see src/lib/invoice.ts,
	// which does that arithmetic once for this page, the portal and the email.
	const invoice = $derived(data.invoice);

	// Editing the total is a toggle rather than a permanently-live field: this is
	// the number the whole invoice is measured against, and a stray keystroke in an
	// always-open input is not something a contractor should be able to do to it.
	let editingTotal = $state(false);
	let totalInput = $state('');
	function openTotalEditor() {
		totalInput = order.finalAmountCents != null ? (order.finalAmountCents / 100).toFixed(2) : '';
		editingTotal = true;
	}

	// Recording a payment. Opens closed — most visits to an order are not about
	// money — and the amount prefills to nothing rather than to a guess.
	let payOpen = $state(false);
	let payAmount = $state('');
	let payKind = $state<(typeof PAYMENT_KINDS)[number]>('deposit');
	// `payVia`, not `payMethod`: the close-out modal already owns a `payMethod`
	// for its own one-shot radio group, and two states with one name is how the
	// two forms start setting each other's values.
	let payVia = $state<string>('check');
	let payNote = $state('');
	let payDate = $state('');

	/**
	 * Open the payment form, pre-set to the move the job is actually at.
	 *
	 * Nothing has been paid yet → a deposit, and the obvious deposit is half. Money
	 * has already come in → this is the rest of it, so the amount prefills to the
	 * outstanding balance and the kind to `final`. Both are prefills the contractor
	 * types over; neither is a rule.
	 */
	function openPayment() {
		const outstanding = invoice.balanceCents;
		if (invoice.payments.length === 0) {
			payKind = 'deposit';
			const half = halfOf(invoice.totalCents);
			payAmount = half != null ? (half / 100).toFixed(2) : '';
		} else {
			payKind = 'final';
			payAmount = outstanding != null && outstanding > 0 ? (outstanding / 100).toFixed(2) : '';
		}
		payVia = 'check';
		payNote = '';
		payDate = toDateInput(new Date());
		payOpen = true;
	}

	/** Drop the whole balance into the amount field — the "and the rest" button. */
	function fillOutstanding() {
		const outstanding = invoice.balanceCents;
		if (outstanding != null && outstanding > 0) payAmount = (outstanding / 100).toFixed(2);
	}

	// Removing a recorded payment changes what someone owes, so it asks first.
	let confirmRemovePayment = $state<string | null>(null);

	// How much of the job has been paid for, for the bar. Null when there is no
	// total to measure against — a bar with no denominator is decoration.
	const paidPortion = $derived(paidFraction(invoice));

	// ---- Line items. The breakdown behind the total.
	//
	// Adding the first one is what turns a lump figure into an itemised invoice,
	// after which the total is the SUM and stops being typed at all — which is why
	// the total's own editor disappears once `invoice.itemised` is true.
	let addingLine = $state(false);
	let lineLabel = $state('');
	let lineAmount = $state('');
	let editingLineId = $state<string | null>(null);
	let editLabel = $state('');
	let editAmount = $state('');
	let confirmRemoveLine = $state<string | null>(null);

	function openLineEditor(item: { id: string; label: string; amountCents: number }) {
		editingLineId = item.id;
		editLabel = item.label;
		editAmount = (item.amountCents / 100).toFixed(2);
	}
	const closeLineForm =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			await update();
			addingLine = false;
			editingLineId = null;
			lineLabel = '';
			lineAmount = '';
		};

	// ---- Details. What the job is, where, and when.
	let editingDetails = $state(false);
	let detDescription = $state('');
	let detStart = $state('');
	let detTarget = $state('');
	let detSiteOn = $state(false);
	let detAddress = $state('');
	let detCity = $state('');
	let detState = $state('');
	let detPostal = $state('');

	const hasDetails = $derived(
		Boolean(
			order.description ||
			order.siteAddress ||
			order.startDate ||
			order.targetDate ||
			order.visitDate
		)
	);
	/** The site line, only when the job is somewhere other than the customer's address. */
	const siteLine = $derived(
		order.siteAddress
			? [
					order.siteAddress,
					[order.siteCity, order.siteState].filter(Boolean).join(', '),
					order.sitePostalCode
				]
					.filter(Boolean)
					.join(' · ')
			: ''
	);
	/** Past its target and not finished. Terminal orders are not late, they are done. */
	const targetOverdue = $derived(
		Boolean(order.targetDate) && !isTerminal && new Date(order.targetDate!) < new Date()
	);

	function openDetailsEditor() {
		detDescription = order.description ?? '';
		detStart = toDateInput(order.startDate);
		detTarget = toDateInput(order.targetDate);
		detSiteOn = Boolean(order.siteAddress);
		detAddress = order.siteAddress ?? '';
		detCity = order.siteCity ?? '';
		detState = order.siteState ?? '';
		detPostal = order.sitePostalCode ?? '';
		editingDetails = true;
	}
	const closeDetailsEditor =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			await update();
			editingDetails = false;
		};

	const closePaymentForm =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			await update();
			payOpen = false;
		};
	const closeTotalEditor =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			await update();
			editingTotal = false;
		};
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
	/**
	 * "Aug 19" — or "Aug 19, 2027" when it is not this year.
	 *
	 * The schedule block reads as two dates side by side, and "8/19/2026" twice
	 * over is four numbers the eye has to parse before it can compare them. The
	 * year only earns its place when leaving it out would be ambiguous.
	 */
	function fmtShortDate(d: Date | string | null): string {
		if (!d) return '—';
		const date = new Date(d);
		const sameYear = date.getFullYear() === new Date().getFullYear();
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			...(sameYear ? {} : { year: 'numeric' })
		});
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

{#snippet askFields(title: string, detail: string, dueOn: string | null, blocking: boolean)}
	<!-- One set of fields for asking and for editing. They were briefly two, and
	     the edit form immediately lost the "holding up the job" box. -->
	<label class="crew-wide"
		>What you need<input
			class="field-input"
			name="title"
			required
			maxlength="120"
			autocomplete="off"
			placeholder="Pick your tile · Sign the permit · Gate code"
			value={title}
		/></label
	>
	<label class="crew-wide"
		>Detail (optional)<textarea
			class="field-input"
			name="detail"
			rows="2"
			placeholder="Where to send it, which of the three quotes, why it is holding things up"
			>{detail}</textarea
		></label
	>
	<label>By<input class="field-input" type="date" name="dueOn" value={dueOn ?? ''} /></label>
	<label class="ask-check"
		><input type="checkbox" name="blocking" checked={blocking} />
		<span>The job is held up until this is done</span></label
	>
{/snippet}

<svelte:head>
	<title>{order.projectName ?? 'Order'}</title>
</svelte:head>

<div class="order-shell">
	<div class="page page-shell">
		<!-- Back and status share the top line. The status used to sit across from
		     the title as a caption to it, which cost the title a fixed column on the
		     right — on a phone that squeezed a project name into three wrapped lines
		     beside a pill with room to spare. Up here it is out of the title's way
		     on every screen, and the back link stops owning a line by itself. -->
		<div class="head-bar">
			<a class="back-link" href={resolve(backTo.href)}>← {backTo.label}</a>
			<div class="statusline">
				<span
					style="font-size: 0.82rem; font-weight: 600; white-space: nowrap; color: {badge.fg}; background: {badge.bg}; border: 1px solid {badge.border}; border-radius: 999px; padding: 0.25rem 0.8rem;"
					>{order.state}</span
				>
				<button
					type="button"
					class="icon-btn {statusModal ? 'on' : ''}"
					aria-haspopup="dialog"
					title="Update status"
					aria-label="Update status"
					onclick={openStatus}
					style="width: 2rem; height: 2rem; font-size: 1.25rem;">⚙️</button
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

				<!-- Who the job is for, in the shape the People directory uses: the same
				     photo-or-initial, the same name, the same 💬 beside it. It was a name
				     in muted type with a 🪪 next to it that opened a panel of read-only
				     facts — a control that looked like an edit affordance, opened
				     something you could not edit, and put a third rendering of "a
				     person" on a third surface.

				     It is a STATEMENT, not a control. The name was briefly a link into
				     the directory, on the reasoning that editing a person should happen
				     in one place — but the whole chip then behaved like a button on a
				     page whose every other press does something to this job, and
				     "who is this for" is a fact you read, not a place you go. The
				     directory is one nav click away for the rare time you want it. -->
				<!-- The box itself. Everything below is one order's facts, so they share
				     one surface — the identity row, the two things you glance at, and the
				     rest behind the toggle. -->
				<div class="order-box">
					{#if customer}
						<div class="head-customer">
							<div class="cust-identity">
								{#if customer.avatar}
									<img class="cust-avatar" src={customer.avatar} alt="" />
								{:else}
									<span class="cust-avatar fallback" aria-hidden="true"
										>{customer.name.charAt(0).toUpperCase()}</span
									>
								{/if}
								<span class="cust-who">
									<span class="cust-name">{customer.name}</span>
									<span class="cust-meta">
										{#if orderLocation}<span class="cust-where"
												><span aria-hidden="true">📍</span>{orderLocation}</span
											>{/if}
										{#if customer.email}<span class="cust-reach">{customer.email}</span>{/if}
									</span>
								</span>
							</div>

							<!-- Reaching them is not editing them, so this stays. Same control,
							     same panel and same seat as the directory's row. -->
							{#if customer.email || customer.phone}
								<div class="cust-contact">
									<button
										type="button"
										class="icon-btn"
										style="width: 2.5rem; height: 2.5rem; font-size: 1.4rem;"
										title="Message {customer.name}"
										aria-label="Message {customer.name}"
										aria-expanded={contactOpen}
										onclick={() => (contactOpen = !contactOpen)}>💬</button
									>
									{#if contactOpen}
										<ContactDialog
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
									{/if}
								</div>
							{/if}
						</div>
					{:else}
						<!-- An order whose customer record has gone. The name still rides on the
						     order itself, so the header says who it was for rather than nothing. -->
						<span class="cust-name orphan">{order.customerName}</span>
					{/if}

					<!-- ------------------------------------------------ The order, in one box
				     Who it is for, when it runs, and what is owed — then everything else
				     behind one toggle.

				     It was three boxes: this card carried the customer, a wrapping row
				     beside it carried the follow-up and the files, and a Details card in
				     the rail below carried the scope, the site, the schedule and the visit
				     date. Every one of them was about THIS ORDER, and the split was by
				     which feature shipped when rather than by anything a contractor cares
				     about — so opening a job meant reading three headers to assemble one
				     answer, and the schedule (the thing you actually look up) was the
				     furthest down the page.

				     What stays on show is what gets glanced at: who, where, when to chase
				     it, and the two dates the job runs between. The scope, the site
				     address, the on-site date and the files are things you open a job TO
				     DO, not things you read on the way past. -->
					<dl class="oc-facts">
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
										style="width: 1.7rem; height: 1.7rem; font-size: 1.1rem;"
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

						<!-- The two dates as one span, not two facts. They describe one stretch
					     of time and are read together; stacked as separate rows they were
					     two unrelated dates that happened to be adjacent. -->
						<div class="fact">
							<dt>Runs</dt>
							<dd>
								{#if order.startDate || order.targetDate}
									<span class="fact-value">{fmtShortDate(order.startDate)}</span>
									<span class="fact-arrow" aria-hidden="true">→</span>
									<span class="fact-value" class:det-late={targetOverdue}
										>{fmtShortDate(order.targetDate)}</span
									>
									{#if targetOverdue}<span class="det-late-flag">overdue</span>{/if}
								{:else}
									<span class="fact-empty">Not set</span>
								{/if}
							</dd>
						</div>
					</dl>

					<!-- The rest, folded. Closed by default because a job is opened to do
					     something to it, and four more rows of reference between the header
					     and the work is four rows you scroll past every time.

					     RIGHT-ALIGNED, opposite the facts it belongs to. It is a control
					     rather than a fact, and sitting at the left margin it read as a
					     third column of the row above — a label with no value under it. -->
					<div class="oc-more">
						<button
							type="button"
							class="oc-more-btn"
							aria-expanded={detailsOpen}
							aria-controls="order-detail"
							onclick={() => (detailsOpen = !detailsOpen)}
						>
							{detailsOpen ? 'Fewer details' : 'More details'}
							<span class="oc-chev" class:open={detailsOpen} aria-hidden="true">▾</span>
						</button>
					</div>

					{#if detailsOpen}
						<div class="oc-detail" id="order-detail">
							{#if editingDetails}
								<form
									method="POST"
									action="?/setOrderDetails"
									use:enhance={closeDetailsEditor}
									class="det-form"
								>
									<label class="inv-field">
										<span>Scope of work</span>
										<textarea
											name="description"
											rows="4"
											placeholder="Tear out the old cedar, re-frame the two rotten joists, 16x20 with a railing…"
											bind:value={detDescription}></textarea>
									</label>

									<div class="det-dates">
										<label class="inv-field">
											<span>Starts</span>
											<input type="date" name="startDate" bind:value={detStart} />
										</label>
										<label class="inv-field">
											<span>Target finish</span>
											<input type="date" name="targetDate" bind:value={detTarget} />
										</label>
									</div>

									<!-- Off by default. Most jobs happen at the customer's own address,
									     and a second address always on screen invites someone to retype
									     the one already on the customer record. -->
									<label class="det-check">
										<input type="checkbox" bind:checked={detSiteOn} />
										<span>The work is at a different address</span>
									</label>
									{#if detSiteOn}
										<!-- Plain fields rather than <AddressFields>: that component hard-codes
										     the input names `city` / `state` / `postalCode` for the customer
										     form and has no address line at all, so reusing it here would post
										     the wrong keys and drop the street. -->
										<label class="inv-field">
											<span>Street</span>
											<input
												name="siteAddress"
												bind:value={detAddress}
												placeholder="1180 Alder Street"
											/>
										</label>
										<div class="det-site-row">
											<label class="inv-field grow">
												<span>City</span>
												<input name="siteCity" bind:value={detCity} />
											</label>
											<label class="inv-field det-state">
												<span>State</span>
												<input name="siteState" bind:value={detState} maxlength="2" />
											</label>
											<label class="inv-field det-zip">
												<span>ZIP</span>
												<input name="sitePostalCode" bind:value={detPostal} inputmode="numeric" />
											</label>
										</div>
									{:else}
										<!-- Cleared on save when the box is unticked, so unticking it really
										     does hand the job back to the customer's address instead of
										     leaving a stale one behind. -->
										<input type="hidden" name="siteAddress" value="" />
										<input type="hidden" name="siteCity" value="" />
										<input type="hidden" name="siteState" value="" />
										<input type="hidden" name="sitePostalCode" value="" />
									{/if}

									<div class="inv-pay-actions">
										<button type="button" class="inv-btn" onclick={() => (editingDetails = false)}
											>Cancel</button
										>
										<button type="submit" class="inv-btn primary">Save details</button>
									</div>
								</form>
							{:else if hasDetails}
								{#if order.description}
									<p class="det-scope">{order.description}</p>
								{/if}
								<!-- The schedule as a span rather than two rows of a definition list.
								     Two dates that describe one stretch of time should be read
								     together — stacked as "Starts …" over "Target …" they were two
								     unrelated facts that happened to be adjacent. -->
								{#if order.startDate || order.targetDate}
									<div class="det-schedule">
										<div class="det-when">
											<span class="det-when-label">Starts</span>
											<span class="det-when-value">{fmtShortDate(order.startDate)}</span>
										</div>
										<span class="det-arrow" aria-hidden="true"></span>
										<div class="det-when">
											<span class="det-when-label">Target</span>
											<span class="det-when-value" class:det-late={targetOverdue}>
												{fmtShortDate(order.targetDate)}
											</span>
										</div>
										{#if targetOverdue}
											<span class="det-late-flag">overdue</span>
										{/if}
									</div>
								{/if}

								{#if siteLine}
									<div class="det-site">
										<span class="det-site-label">Site</span>
										<span>{siteLine}</span>
									</div>
								{/if}

								<!-- The day the crew turns up, which is the one date here that gets
								     changed on the morning it applies to — so it is settable in one
								     press rather than through the details form. It is what the
								     dashboard's "on site today" list is a query over. -->
								<div class="det-visit">
									<span class="det-site-label">On site</span>
									<span class="det-visit-value">
										{order.visitDate ? fmtShortDate(order.visitDate) : 'Not scheduled'}
									</span>
									<form method="POST" action="?/setVisitDate" use:enhance class="det-visit-form">
										<input type="date" name="date" value={toDateInput(order.visitDate)} />
										<button type="submit" class="inv-btn">Set</button>
									</form>
									{#if !order.visitDate}
										<form method="POST" action="?/setVisitDate" use:enhance>
											<input type="hidden" name="date" value={toDateInput(new Date())} />
											<button type="submit" class="inv-btn">Today</button>
										</form>
									{/if}
								</div>
							{:else}
								<p class="det-empty">
									Nothing recorded yet — what the job is, where it happens, when it runs.
								</p>
							{/if}

							<!-- Files, in the box everything else about this order lives in. It was
						     a fact in the header row with a 📎 beside it, which put "how many
						     files" on permanent display — a number nobody needs until the
						     moment they want the file itself. -->
							<div class="det-visit">
								<span class="det-site-label">Files</span>
								<span class="det-visit-value">
									{data.documents.length === 0 ? 'None yet' : data.documents.length}
								</span>
								<button
									type="button"
									class="inv-btn"
									class:on={filesOpen}
									aria-expanded={filesOpen}
									onclick={() => (filesOpen = !filesOpen)}
								>
									{filesOpen ? 'Close' : 'Open files'}
								</button>
							</div>

							{#if !editingDetails}
								<div class="oc-detail-actions">
									<button type="button" class="inv-btn" onclick={openDetailsEditor}>
										{hasDetails ? 'Edit details' : 'Add details'}
									</button>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>

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
		</header>

		{#if form?.message}
			<p
				style="margin: 0; color: #cf222e; font-size: 0.9rem; background: #ffebe9; border: 1px solid #ffd7d5; border-radius: 10px; padding: 0.6rem 0.8rem;"
			>
				{form.message}
			</p>
		{/if}

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
								title="Edit note"
								aria-label="Edit note for {d.filename}"
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
							<div class="doc-edit-actions">
								<button type="button" class="doc-btn" onclick={() => (editingDocId = null)}
									>Cancel</button
								>
								<button type="submit" class="doc-btn primary">Save</button>
							</div>
						</label>
					</form>
				{/if}
			</div>
		{/snippet}

		<!-- All three panes are always rendered; which one SHOWS is CSS. That is what
		     lets the desktop layout place them side by side — a `{#if tab === …}` can
		     only ever put one of them on screen, so no amount of grid could have
		     arranged the other two. On a phone the tab strip still shows exactly one,
		     via `.pane:not(.on)`.

		     The strip itself sits in the rail, directly above the People pane and below
		     Details / Invoice: on a phone that is the one position where the always-on
		     cards read as the order's own facts rather than as the open tab's contents.
		     It is hidden from 1100px, where every pane is on screen at once. -->

		<div class="workspace">
			<div class="col-rail">
				<div class="tabs" role="tablist" aria-label="Order sections" bind:this={tabsEl}>
					{#each TABS as t (t.id)}
						<button
							type="button"
							role="tab"
							id={`tab-${t.id}`}
							aria-selected={tab === t.id}
							aria-controls={`panel-${t.id}`}
							class="tab"
							class:on={tab === t.id}
							onclick={() => pickTab(t.id)}
						>
							{t.label}{#if t.pending > 0}<span class="tab-count as-pending">{t.pending}</span>{/if}
						</button>
					{/each}
				</div>

				<!-- ------------------------------------------------------------- Billing
				     What the job costs, what has come in, what is left.

				     A tab now, alongside the others. It used to be a card of its own,
				     sitting above the strip, on the reasoning that "the tab row is three
				     wide because that is what fits a phone, and money is something you
				     glance at on the way past rather than a view you sit in". The first
				     half of that stopped being true when the row went to four; the second
				     stopped being true when the invoice grew line items, payments and a
				     close-out — it IS a view you sit in now.

				     FIRST among the rail's panes on purpose. Above 1100px the strip is
				     hidden and every pane shows at once, so pane order IS the rail's
				     order — putting billing here keeps it at the top of the rail exactly
				     where the card used to be, while a phone reaches it through the tab.

				     Shown for the whole life of the order, not just at close-out. A deposit
				     is taken at the START of a job, which is exactly the period the old
				     close-out-only record could not describe. -->
				<!-- The pane is the DIV; the card stays a <section> inside it. A
				     `<section role="tabpanel">` is the role fighting the element, and the
				     other four panes are divs — so this matches them, and the card keeps
				     its own heading association. `.pane-billing` drops the pane's frame,
				     because the card inside already draws one. -->
				<div
					class="pane pane-billing"
					class:on={tab === 'billing'}
					role="tabpanel"
					id="panel-billing"
					aria-labelledby="tab-billing"
				>
					<section class="card invoice" aria-labelledby="invoice-head">
						<div class="inv-head">
							<h2 id="invoice-head">Invoice</h2>
							<!-- The whole point of the preview: what the customer will actually be
							     sent, rendered by the same code that sends it. Opens in a new tab
							     because it is a document, not a step in this page's flow. -->
							<a
								class="inv-preview"
								href={resolve(`/contractor/orders/${order.id}/invoice`)}
								target="_blank"
								rel="noopener"
							>
								Preview email <span aria-hidden="true">↗</span>
							</a>
						</div>

						<!-- The card's headline, and the reason it leads rather than trails: the one thing
						     anyone opens an invoice to learn is what is still owed. It used to sit at the
						     bottom, under the breakdown and the payment list, in the same weight as the
						     labels around it.

						     The bar and the sub-line both restate figures given in words, so the bar is
						     aria-hidden and the sub-line carries the numbers as text. -->
						<div
							class="inv-hero"
							class:settled={invoice.status === 'settled'}
							class:owed={invoice.status === 'open'}
						>
							{#if invoice.status === 'settled'}
								<span class="inv-hero-label">Paid in full</span>
								<span class="inv-hero-value">{formatCents(invoice.paidCents)}</span>
							{:else if invoice.status === 'overpaid'}
								<span class="inv-hero-label">Refund owed</span>
								<span class="inv-hero-value">{formatCents(-(invoice.balanceCents ?? 0))}</span>
							{:else if invoice.status === 'open'}
								<span class="inv-hero-label">Balance due</span>
								<span class="inv-hero-value">{formatCents(invoice.balanceCents)}</span>
							{:else if invoice.paidCents !== 0}
								<!-- Money in, no agreed total. Report what arrived rather than a balance
								     that cannot be computed. -->
								<span class="inv-hero-label">Paid to date</span>
								<span class="inv-hero-value">{formatCents(invoice.paidCents)}</span>
							{:else}
								<span class="inv-hero-label">Balance</span>
								<span class="inv-hero-value unset">Nothing recorded yet</span>
							{/if}

							{#if paidPortion != null}
								<div
									class="inv-progress"
									class:full={invoice.status === 'settled' || invoice.status === 'overpaid'}
									aria-hidden="true"
								>
									<div class="inv-progress-fill" style="--paid: {paidPortion}"></div>
								</div>
								<span class="inv-hero-sub">
									{formatCents(invoice.paidCents)} received of {formatCents(invoice.totalCents)}
								</span>
							{/if}
						</div>

						<!-- The total. One editable number, and the only one on this card that is
						     typed rather than derived. -->
						<div class="inv-total">
							{#if editingTotal}
								<form
									method="POST"
									action="?/setOrderTotal"
									use:enhance={closeTotalEditor}
									class="inv-total-form"
								>
									<label class="inv-total-label" for="inv-total-input">Project total</label>
									<div class="inv-amount">
										<span class="inv-cur" aria-hidden="true">$</span>
										<input
											id="inv-total-input"
											name="total"
											inputmode="decimal"
											placeholder="0.00"
											bind:value={totalInput}
										/>
									</div>
									<button type="submit" class="inv-btn primary">Save</button>
									<button type="button" class="inv-btn" onclick={() => (editingTotal = false)}
										>Cancel</button
									>
								</form>
							{:else}
								<div class="inv-total-read">
									<span class="inv-total-label">{invoice.itemised ? 'Total' : 'Project total'}</span
									>
									<span class="inv-total-value" class:unset={invoice.totalCents == null}>
										{invoice.totalCents != null ? formatCents(invoice.totalCents) : 'Not set'}
									</span>
									<!-- No editor once the invoice is itemised: the total IS the sum of the
									     lines, and offering a field for it would be offering to make the
									     breakdown disagree with the figure printed above it. -->
									{#if !invoice.itemised}
										<button type="button" class="inv-btn" onclick={openTotalEditor}>
											{invoice.totalCents != null ? 'Edit' : 'Set total'}
										</button>
									{/if}
								</div>
							{/if}
						</div>

						<!-- The breakdown. What the total is made of, and the answer to the one
						     question a lump figure cannot answer: why is it that much? -->
						{#if invoice.lineItems.length > 0}
							<ul class="inv-items">
								{#each invoice.lineItems as item (item.id)}
									<li class="inv-item">
										{#if editingLineId === item.id}
											<form
												method="POST"
												action="?/updateLineItem"
												use:enhance={closeLineForm}
												class="inv-item-form"
											>
												<input type="hidden" name="itemId" value={item.id} />
												<input
													name="label"
													class="inv-item-label-input"
													bind:value={editLabel}
													aria-label="Line description"
												/>
												<div class="inv-amount tight">
													<span class="inv-cur" aria-hidden="true">$</span>
													<input
														name="amount"
														inputmode="decimal"
														bind:value={editAmount}
														aria-label="Line amount"
													/>
												</div>
												<button type="submit" class="inv-btn primary">Save</button>
												<button type="button" class="inv-btn" onclick={() => (editingLineId = null)}
													>Cancel</button
												>
											</form>
										{:else}
											<button
												type="button"
												class="inv-item-read"
												title="Edit this line"
												onclick={() => openLineEditor(item)}
											>
												<span class="inv-item-label">{item.label}</span>
												<span class="inv-item-amount" class:credit={item.amountCents < 0}
													>{formatCents(item.amountCents)}</span
												>
											</button>
											{#if confirmRemoveLine === item.id}
												<span class="inv-line-confirm" role="alert">
													<span>Remove?</span>
													<form method="POST" action="?/deleteLineItem" use:enhance>
														<input type="hidden" name="itemId" value={item.id} />
														<button type="submit" class="inv-remove-yes">Yes</button>
													</form>
													<button
														type="button"
														class="inv-btn"
														onclick={() => (confirmRemoveLine = null)}>No</button
													>
												</span>
											{:else}
												<button
													type="button"
													class="inv-remove"
													title="Remove this line"
													aria-label="Remove line {item.label}"
													onclick={() => (confirmRemoveLine = item.id)}>×</button
												>
											{/if}
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						{#if addingLine}
							<form
								method="POST"
								action="?/addLineItem"
								use:enhance={closeLineForm}
								class="inv-item-form add"
							>
								<input
									name="label"
									class="inv-item-label-input"
									placeholder="Cedar decking"
									bind:value={lineLabel}
									aria-label="Line description"
								/>
								<div class="inv-amount tight">
									<span class="inv-cur" aria-hidden="true">$</span>
									<input
										name="amount"
										inputmode="decimal"
										placeholder="0.00"
										bind:value={lineAmount}
										aria-label="Line amount"
									/>
								</div>
								<button type="submit" class="inv-btn primary">Add</button>
								<button type="button" class="inv-btn" onclick={() => (addingLine = false)}
									>Cancel</button
								>
							</form>
						{:else}
							<button type="button" class="inv-add-line" onclick={() => (addingLine = true)}>
								<span aria-hidden="true">+</span>
								{invoice.itemised ? 'Add another line' : 'Break the total into lines'}
							</button>
						{/if}

						<!-- The running account. Oldest-first: an invoice is read down, not up. -->
						{#if invoice.payments.length > 0}
							<ul class="inv-lines">
								{#each invoice.payments as p (p.id)}
									<li class="inv-line">
										<span class="inv-line-text">
											<span class="inv-line-label">{paymentLineLabel(p)}</span>
											<span class="inv-line-date">{invoiceDate(p.receivedAt)}</span>
										</span>
										<span class="inv-line-amount">{formatCents(p.amountCents)}</span>
										{#if confirmRemovePayment === p.id}
											<span class="inv-line-confirm" role="alert">
												<span>Remove?</span>
												<form method="POST" action="?/deletePayment" use:enhance>
													<input type="hidden" name="paymentId" value={p.id} />
													<button type="submit" class="inv-remove-yes">Yes</button>
												</form>
												<button
													type="button"
													class="inv-btn"
													onclick={() => (confirmRemovePayment = null)}>No</button
												>
											</span>
										{:else}
											<button
												type="button"
												class="inv-remove"
												title="Remove this payment"
												aria-label="Remove {paymentKindLabel(p.kind)} of {formatCents(
													p.amountCents
												)}"
												onclick={() => (confirmRemovePayment = p.id)}>×</button
											>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						{#if payOpen}
							<form
								method="POST"
								action="?/recordPayment"
								use:enhance={closePaymentForm}
								class="inv-pay-form"
							>
								<div class="inv-pay-row">
									<label class="inv-field">
										<span>Amount</span>
										<div class="inv-amount">
											<span class="inv-cur" aria-hidden="true">$</span>
											<input
												name="amount"
												inputmode="decimal"
												placeholder="0.00"
												bind:value={payAmount}
											/>
										</div>
									</label>
									{#if invoice.balanceCents != null && invoice.balanceCents > 0}
										<button type="button" class="inv-btn" onclick={fillOutstanding}>
											Use balance ({formatCents(invoice.balanceCents)})
										</button>
									{/if}
								</div>

								<div class="inv-pay-row" role="radiogroup" aria-label="What this payment is">
									{#each PAYMENT_KINDS as k (k)}
										<label class="inv-chip" class:on={payKind === k}>
											<input type="radio" name="kind" value={k} bind:group={payKind} />
											{paymentKindLabel(k)}
										</label>
									{/each}
								</div>

								<div class="inv-pay-row" role="radiogroup" aria-label="How they paid">
									{#each PAYMENT_METHODS as m (m)}
										<label class="inv-chip" class:on={payVia === m}>
											<input type="radio" name="method" value={m} bind:group={payVia} />
											{paymentMethodLabel(m)}
										</label>
									{/each}
								</div>

								<div class="inv-pay-row">
									<label class="inv-field">
										<span>Received on</span>
										<input type="date" name="receivedAt" bind:value={payDate} />
									</label>
									<label class="inv-field grow">
										<span>Note (optional)</span>
										<input name="note" placeholder="Check #1041" bind:value={payNote} />
									</label>
								</div>

								<div class="inv-pay-actions">
									<button type="button" class="inv-btn" onclick={() => (payOpen = false)}
										>Cancel</button
									>
									<button type="submit" class="inv-btn primary">Record payment</button>
								</div>
							</form>
						{:else}
							<button type="button" class="inv-record" onclick={openPayment}>
								<span aria-hidden="true">+</span> Record a payment
							</button>
						{/if}

						{#if order.finalNotes}
							<p class="inv-notes">{order.finalNotes}</p>
						{/if}
					</section>
				</div>

				<!-- ----------------------------------------------------------- People
			     Who is on this job, and when. Crew and subcontractors in one list —
			     it was two panels, which made "who is on this job" look like two
			     questions. The chip on each row says which kind somebody is; the
			     capability difference (tier, insurance, portal) lives on the
			     subcontractor page, where it applies. -->
				<div
					class="pane pane-crew"
					class:on={tab === 'crew'}
					role="tabpanel"
					id="panel-crew"
					aria-labelledby="tab-crew"
				>
					<!-- The heading only. "Manage people →" used to sit here on every job,
					     every time — a permanent link OFF the page, offered to a contractor
					     who had come here to staff a job and could do that right below it.
					     The one moment it is genuinely the answer is when the books are
					     empty, and that is where it now lives. -->
					<h2 style={sectionTitle}>On this job</h2>

					{#if onSiteToday.length > 0}
						<!-- The one fact this panel exists to answer at a glance. Only shown
					     when somebody actually is on site — an empty "on site today" line
					     on every job would train the eye straight past it. -->
						<p class="crew-today">
							<span aria-hidden="true">🦺</span>
							On site today: {onSiteToday.map((p) => p.name).join(', ')}
						</p>
					{/if}

					{#if form?.action === 'crew' && form?.message}
						<p class="crew-error" role="alert">{form.message}</p>
					{/if}

					{#if data.assignedPeople.length === 0}
						<div class="panel-empty">
							<span class="empty-mark" aria-hidden="true">🦺</span>
							<p class="editor-note">Nobody is on this job yet.</p>
						</div>
					{:else}
						<ul class="crew-list">
							{#each data.assignedPeople as p (personKey(p))}
								{@const key = personKey(p)}
								{@const onToday = coversDay({ startsOn: p.startsOn, endsOn: p.endsOn }, today)}
								<li class="crew-item" class:here={onToday}>
									<div class="crew-row">
										{#if p.avatar}
											<img class="crew-face" src={p.avatar} alt="" />
										{:else}
											<span class="crew-face placeholder" aria-hidden="true"
												>{workerInitials(p.name)}</span
											>
										{/if}
										<span class="crew-who">
											<span class="crew-name">
												{p.name}{#if p.archived}<span
														class="crew-gone"
														title="No longer on your books">· former</span
													>{/if}
											</span>
											<!-- Role and company, then the dates. No crew/sub chip: whose
											     company somebody is on is the fact that actually separates a
											     hand from a hired firm, and it is right here — a second label
											     saying the same thing in different words is noise. -->
											<span class="crew-meta">
												{[p.jobRole ?? p.role, p.company].filter(Boolean).join(' · ') ||
													'On this job'} ·
												{stintLabel({ startsOn: p.startsOn, endsOn: p.endsOn }, now)}
											</span>
										</span>
										{#if onToday}<span class="crew-badge">Today</span>{/if}
										<button
											type="button"
											class="crew-btn"
											aria-expanded={crewEditKey === key}
											onclick={() => {
												crewEditKey = crewEditKey === key ? null : key;
												crewConfirmRemoveKey = null;
											}}>Dates</button
										>
									</div>

									{#if p.jobNotes}
										<p class="crew-note">{p.jobNotes}</p>
									{/if}

									{#if crewEditKey === key}
										<form
											method="POST"
											action="?/assignPerson"
											use:enhance={() =>
												async ({ result, update }) => {
													await update({ reset: false });
													if (result.type === 'success') crewEditKey = null;
												}}
											class="crew-form"
										>
											<input type="hidden" name="personId" value={p.id} />
											<input type="hidden" name="kind" value={p.kind} />
											<label
												>Start<input
													class="field-input"
													type="date"
													name="startsOn"
													value={p.startsOn ?? ''}
												/></label
											>
											<label
												>End<input
													class="field-input"
													type="date"
													name="endsOn"
													value={p.endsOn ?? ''}
												/></label
											>
											<label class="crew-wide"
												>On this job<input
													class="field-input"
													name="role"
													value={p.jobRole ?? ''}
													placeholder={p.role ?? 'Framer, helper, operator…'}
												/></label
											>
											<label class="crew-wide"
												>Note<input
													class="field-input"
													name="notes"
													value={p.jobNotes ?? ''}
													placeholder="Optional"
												/></label
											>
											<div class="crew-actions crew-wide">
												{#if crewConfirmRemoveKey === key}
													<span class="crew-confirm">Take {p.name} off this job?</span>
													<button
														type="button"
														class="crew-btn"
														onclick={() => (crewConfirmRemoveKey = null)}>Keep</button
													>
												{:else}
													<button
														type="button"
														class="crew-btn danger"
														onclick={() => (crewConfirmRemoveKey = key)}>Remove</button
													>
												{/if}
												<span class="crew-spacer"></span>
												<button type="button" class="crew-btn" onclick={() => (crewEditKey = null)}
													>Cancel</button
												>
												<button type="submit" class="crew-save">Save dates</button>
											</div>
										</form>
										{#if crewConfirmRemoveKey === key}
											<form
												method="POST"
												action="?/unassignPerson"
												use:enhance={() =>
													async ({ update }) => {
														await update();
														crewConfirmRemoveKey = null;
														crewEditKey = null;
													}}
											>
												<input type="hidden" name="personId" value={p.id} />
												<input type="hidden" name="kind" value={p.kind} />
												<button type="submit" class="crew-btn danger wide-btn"
													>Yes, take {p.name} off</button
												>
											</form>
										{/if}
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					{#snippet newPerson()}
						<!-- The field version of a person: a name, what they do, and a number
						     to reach them on. Deliberately not the people page's form — at the
						     moment somebody turns up on a Tuesday that IS everything you know
						     about them, and asking for a company and an email before they can
						     be put on the job is how a contractor ends up not recording them
						     at all. The full record is there to fill in later. -->
						<form
							method="POST"
							action="?/createAndAssignPerson"
							use:enhance={() =>
								async ({ result, update }) => {
									await update();
									if (result.type === 'success') {
										crewCreating = false;
										crewQuery = '';
										crewNewName = '';
									}
								}}
							class="crew-new"
						>
							<input type="hidden" name="startsOn" value={today} />
							<label class="crew-wide"
								>Name<input
									class="field-input"
									name="name"
									required
									autocomplete="off"
									placeholder="Dave Ellis"
									bind:value={crewNewName}
								/></label
							>
							<label
								>Does<input
									class="field-input"
									name="role"
									autocomplete="off"
									placeholder="Framer, helper, operator…"
								/></label
							>
							<label
								>Phone<input
									class="field-input"
									name="phone"
									type="tel"
									autocomplete="off"
									placeholder="Optional"
								/></label
							>
							<div class="crew-actions crew-wide">
								<button
									type="button"
									class="crew-btn"
									onclick={() => {
										crewCreating = false;
										if (rosterEmpty) crewAdding = false;
									}}>{rosterEmpty ? 'Cancel' : 'Back to the list'}</button
								>
								<span class="crew-spacer"></span>
								<button type="submit" class="crew-save">Add to this job</button>
							</div>
						</form>
					{/snippet}

					{#if crewAdding}
						<div class="crew-add-box">
							{#if rosterEmpty}
								<!-- Nothing to search, so no search box: an empty field asking a
								     contractor to look through nobody is furniture. This is the one
								     state where the people page IS the answer, so it is the one
								     state that links to it. -->
								<p class="editor-note">Nobody on your books yet — add the first one here.</p>
								{@render newPerson()}
								<p class="editor-note">
									Setting up a subcontractor, or bringing across a list you already have?
									<a class="panel-link" href={resolve('/contractor/people')}>Manage people →</a>
								</p>
							{:else}
								<div class="crew-search-row">
									<span aria-hidden="true">🔍</span>
									<input
										class="crew-search"
										type="search"
										placeholder="Search crew and subs…"
										aria-label="Search your people"
										bind:value={crewQuery}
									/>
									<button
										type="button"
										class="crew-btn"
										onclick={() => {
											crewAdding = false;
											crewCreating = false;
											crewQuery = '';
										}}>Done</button
									>
								</div>

								{#if crewCreating}
									{@render newPerson()}
								{:else}
									{#if crewMatches.length === 0}
										<p class="editor-note">
											{crewQuery.trim()
												? `Nobody matches “${crewQuery.trim()}”.`
												: 'Everyone on your books is already on this job.'}
										</p>
									{:else}
										<ul class="crew-picker">
											{#each crewMatches.slice(0, 8) as p (personKey(p))}
												<li>
													<!-- Dates default to today rather than empty: the common case is
												     "put them on this job, starting now", and an empty pair means
												     they never show up on an on-site list. Both stay editable. -->
													<form
														method="POST"
														action="?/assignPerson"
														use:enhance={() =>
															async ({ result, update }) => {
																await update();
																if (result.type === 'success') crewQuery = '';
															}}
														class="crew-pick-row"
													>
														<input type="hidden" name="personId" value={p.id} />
														<input type="hidden" name="kind" value={p.kind} />
														<input type="hidden" name="startsOn" value={today} />
														<span class="crew-face placeholder" aria-hidden="true"
															>{workerInitials(p.name)}</span
														>
														<span class="crew-who">
															<span class="crew-name">{p.name}</span>
															<span class="crew-meta"
																>{[p.role, p.company].filter(Boolean).join(' · ') ||
																	'No role set'}</span
															>
														</span>
														<button type="submit" class="crew-save">Add</button>
													</form>
												</li>
											{/each}
										</ul>
										{#if crewMatches.length > 8}
											<p class="editor-note">
												+{crewMatches.length - 8} more — keep typing to narrow it down.
											</p>
										{/if}
									{/if}

									<!-- Search that can also create. Whatever has been typed rides
									     into the name field, so "Dave" finding nobody is one press
									     away from being Dave. -->
									<button
										type="button"
										class="crew-new-open"
										onclick={() => {
											crewNewName = crewQuery.trim();
											crewCreating = true;
										}}
									>
										<span aria-hidden="true">＋</span>
										{crewQuery.trim() ? `Add “${crewQuery.trim()}” as someone new` : 'Somebody new'}
									</button>
								{/if}
							{/if}
						</div>
					{:else}
						<button type="button" class="crew-add-open" onclick={() => (crewAdding = true)}>
							<span aria-hidden="true">＋</span> Put someone on this job
						</button>
					{/if}
				</div>
			</div>

			<!-- The conversation leads. It is the thing a contractor opens this page
			     TO DO; the history is the record of what already happened, and it sat
			     above the thread for no better reason than being written first. -->
			<div class="col-main">
				<div
					class="pane pane-messages"
					class:on={tab === 'messages'}
					class:fill={messagesFill != null && data.customerLinked}
					style:--messages-fill={messagesFill ?? undefined}
					role="tabpanel"
					id="panel-messages"
					aria-labelledby="tab-messages"
				>
					<h2 style={sectionTitle}>Messages</h2>

					{#if data.customerLinked}
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
				</div>

				<div
					class="pane pane-history"
					class:on={tab === 'history'}
					role="tabpanel"
					id="panel-history"
					aria-labelledby="tab-history"
				>
					<!-- ------------------------------------------------------ Waiting on them
			     What this job needs from the CUSTOMER before it can go on.

			     The gap this closes: every "waiting on you" the portal could show was
			     derived from the order's State, and only two of the ten States meant
			     it — Deposit Pending and Final Payment Pending. So money was the only
			     thing this product could ask a customer for. A colour to pick, a
			     permit to sign, a gate code, being home Thursday — all of it went
			     into a Message, where it read as chat and scrolled away while the
			     portal reported "In progress" on a job that had not moved in a week.

			     THIS IS NOT A TAB ANY MORE. It was the first of four, wearing a
			     count, and it was on every job whether or not anything was waiting —
			     so most of the time it was a permanent label advertising an empty
			     list, with a whole panel behind it whose only job was to say no.

			     It sits above the history instead, where it reads as what it is: the
			     part of this job's story that has not happened yet, on top of the
			     part that has. When nothing is waiting it collapses to the one
			     control that still has to be reachable — the ask itself. -->
					<div class="asks">
						{#if form?.action === 'task' && form?.message}
							<p class="crew-error" role="alert">{form.message}</p>
						{/if}

						<!-- The blurb, and deliberately the customer's OWN words for it: one
					     function writes this line and the one in the portal, so a
					     contractor making a claim about whose turn it is sees the claim
					     exactly as it lands. Amber, the app's tone for waiting on
					     somebody — not danger, which would make an unanswered question
					     look like a fault. See docs/adr/0009.

					     `customerSees.waiting` covers money as well as asks, so a job
					     held up by a deposit says so here even with an empty list. -->
						{#if customerSees.waiting}
							<p class="ask-banner">
								<!-- "They see", kept from the panel this replaced. The sentence is
								     addressed to the CUSTOMER — "this one's with you" — so on this
								     screen it has to say whose "you" that is, or the blurb is a
								     pronoun pointing at the wrong person. -->
								<span class="ask-banner-tag">They see</span>
								<span>{customerSees.headline}</span>
							</p>
						{/if}

						{#if openTaskList.length > 0}
							<ul class="ask-list">
								{#each openTaskList as task (task.id)}
									{@const urgency = taskUrgency(task.dueOn, today)}
									<li class="ask-item" class:late={urgency === 'overdue'}>
										<div class="ask-row">
											<span class="ask-text">
												<span class="ask-title">{task.title}</span>
												{#if task.detail}<span class="ask-detail">{task.detail}</span>{/if}
												<span class="ask-meta">
													{#if task.blocking}<span class="ask-chip hold">Holding up the job</span
														>{/if}
													{#if task.dueOn}<span class="ask-chip" class:late={urgency !== 'upcoming'}
															>{taskDueLabel(task.dueOn, today)}</span
														>{/if}
												</span>
											</span>

											<!-- Done, from this side, because cash changes hands on site and a
										     permit is handed over in person. The history records WHICH side
										     ticked it, so the two are never confused. -->
											<form method="POST" action="?/completeTask" use:enhance>
												<input type="hidden" name="taskId" value={task.id} />
												<button type="submit" class="crew-save">Done</button>
											</form>
											<button
												type="button"
												class="crew-btn"
												aria-expanded={taskEditId === task.id}
												onclick={() => {
													taskEditId = taskEditId === task.id ? null : task.id;
													taskConfirmDeleteId = null;
												}}>Edit</button
											>
										</div>

										{#if taskEditId === task.id}
											<form
												method="POST"
												action="?/editTask"
												use:enhance={() =>
													async ({ result, update }) => {
														await update({ reset: false });
														if (result.type === 'success') taskEditId = null;
													}}
												class="ask-form"
											>
												<input type="hidden" name="taskId" value={task.id} />
												{@render askFields(task.title, task.detail, task.dueOn, task.blocking)}
												<div class="crew-actions crew-wide">
													{#if taskConfirmDeleteId === task.id}
														<span class="crew-confirm">Take this ask back?</span>
														<button
															type="button"
															class="crew-btn"
															onclick={() => (taskConfirmDeleteId = null)}>Keep</button
														>
													{:else}
														<button
															type="button"
															class="crew-btn danger"
															onclick={() => (taskConfirmDeleteId = task.id)}>Remove</button
														>
													{/if}
													<span class="crew-spacer"></span>
													<button type="button" class="crew-btn" onclick={() => (taskEditId = null)}
														>Cancel</button
													>
													<button type="submit" class="crew-save">Save</button>
												</div>
											</form>
											{#if taskConfirmDeleteId === task.id}
												<form
													method="POST"
													action="?/deleteTask"
													use:enhance={() =>
														async ({ update }) => {
															await update();
															taskConfirmDeleteId = null;
															taskEditId = null;
														}}
												>
													<input type="hidden" name="taskId" value={task.id} />
													<button type="submit" class="crew-btn danger wide-btn"
														>Yes, take it back</button
													>
												</form>
											{/if}
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						{#if taskAdding}
							<form
								method="POST"
								action="?/addTask"
								use:enhance={() =>
									async ({ result, update }) => {
										await update();
										if (result.type === 'success') taskAdding = false;
									}}
								class="ask-form"
							>
								{@render askFields('', '', null, false)}
								<div class="crew-actions crew-wide">
									<button type="button" class="crew-btn" onclick={() => (taskAdding = false)}
										>Cancel</button
									>
									<span class="crew-spacer"></span>
									<button type="submit" class="crew-save">Ask them</button>
								</div>
							</form>
						{:else}
							<button type="button" class="crew-add-open" onclick={() => (taskAdding = true)}>
								<span aria-hidden="true">＋</span> Ask the customer for something
							</button>
						{/if}

						{#if doneTaskList.length > 0}
							<details class="ask-done">
								<summary>Done <span class="ask-done-count">{doneTaskList.length}</span></summary>
								<ul class="ask-list done">
									{#each doneTaskList as task (task.id)}
										<li class="ask-item">
											<div class="ask-row">
												<span class="ask-text">
													<span class="ask-title">{task.title}</span>
													<span class="ask-meta">
														<!-- WHO ticked it, because "they did it" and "I recorded it
													     for them" are different facts and only one of them is
													     the customer saying so. -->
														<span class="ask-chip"
															>{task.completedBy === 'customer'
																? 'They marked it done'
																: 'You marked it done'}</span
														>
													</span>
												</span>
												<form method="POST" action="?/reopenTask" use:enhance>
													<input type="hidden" name="taskId" value={task.id} />
													<button type="submit" class="crew-btn">Reopen</button>
												</form>
											</div>
										</li>
									{/each}
								</ul>
							</details>
						{/if}
					</div>

					<div
						style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;"
					>
						<h2 style={sectionTitle}>History</h2>
						<!-- Says what it does. A bare 📝 square asked you to guess whether it
						     meant "add a note", "edit the history" or "notes about this order",
						     and the answer was only ever found by pressing it. -->
						<button
							type="button"
							class="note-btn"
							class:on={noteOpen}
							aria-expanded={noteOpen}
							onclick={() => (noteOpen = !noteOpen)}
						>
							<span class="note-btn-sign" aria-hidden="true">+</span>
							Add note
						</button>
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
				</div>
			</div>
		</div>

		<!-- Once an order is ended, the record of how. The ways to end it live in the
		     status modal (⚙), next to the interim states. -->
		{#if isTerminal}
			<div class="closeout-summary" class:done={order.state === 'Work Complete'}>
				{#if order.state === 'Work Complete'}
					<span class="cs-badge done">✓ Completed</span>
					<!-- Read from the invoice, not from the order's old `paid_at` stamp:
					     a job settled by a deposit plus a balance was never "paid" in
					     one moment, and the sum is the only thing that can say whether
					     it is square. Details live on the Invoice card above; this is
					     the one-line verdict. -->
					<dl class="cs-facts">
						{#if invoice.totalCents != null}
							<div>
								<dt>Final invoice</dt>
								<dd>{formatCents(invoice.totalCents)}</dd>
							</div>
						{/if}
						<div>
							<dt>Payment</dt>
							<dd>
								{#if invoice.status === 'settled'}
									Paid in full
								{:else if invoice.status === 'overpaid'}
									Overpaid by {formatCents(-(invoice.balanceCents ?? 0))}
								{:else if invoice.status === 'open'}
									{formatCents(invoice.balanceCents)} outstanding
								{:else if invoice.paidCents !== 0}
									{formatCents(invoice.paidCents)} received
								{:else}
									<span class="cs-muted">Not recorded as paid</span>
								{/if}
							</dd>
						</div>
					</dl>
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
					<!-- Says the amount, because this checkbox no longer means "the whole
					     total arrived" — it records whatever is still OUTSTANDING as a
					     final payment, so on a job with a deposit it is the balance and
					     not the total. A contractor ticking it should be able to read
					     the figure they were handed. -->
					<label class="co-check">
						<input type="checkbox" name="markPaid" bind:checked={markPaid} />
						<span>
							{#if invoice.balanceCents != null && invoice.balanceCents > 0}
								Mark the remaining {formatCents(invoice.balanceCents)} received
							{:else if invoice.status === 'settled'}
								Already paid in full
							{:else}
								Mark final payment received
							{/if}
						</span>
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
					<a
						class="co-preview"
						href={resolve(`/contractor/orders/${order.id}/invoice`)}
						target="_blank"
						rel="noopener">See exactly what they'll get <span aria-hidden="true">↗</span></a
					>
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
	/* ------------------------------------------------------------------ Type
	   One weight scale for this page, because it did not have one: 58 of the
	   declarations below were 700 or 800, which is the same as having none — when
	   everything is bold nothing reads as emphasis and the page reads as noise.

	     400  body copy, labels, values, dates, metadata — most of the page
	     500  things you can click, and a value that needs a nudge over its label
	     600  names, badges, section eyebrows, primary buttons
	     700  the ONE thing per card that is the point: the order's title, its
	          current state, the invoice total and the balance. Four places.

	   Nothing on this page is 800. If something needs to shout, it gets size or
	   colour — another weight step is not available. */
	/* Page canvas. In light this is the familiar sunken grey; in dark it has to be
	   *darker* than the cards sitting on it (the old #f6f8fa literal got remapped
	   to a raised grey, so cards read as holes punched into the page). */
	.order-shell {
		background: var(--surface-sunken);
		min-height: 100%;
	}
	/* Gutters, gap and the growth curve come from `.page-shell` (app.css).
	   
	   The 1180px cap this used to carry is GONE. Its reasoning — "this page is a
	   document, and a line of prose 1300px long is harder to read, not easier" —
	   was correct about one column and stopped applying the moment there were two:
	   no single column below ever gets near that width, so capping the page just
	   left empty gutters on a large monitor. Mobile is untouched either way; the
	   column only grows where there is room for it. */
	.page {
		display: grid;
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
	/* The header sits on the page's sunken canvas — and so did the inline editor it
	   opens (files), a sunken panel on a sunken page, which is why an
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
		font-weight: 500;
		color: var(--fg-muted);
		text-decoration: none;
	}
	.back-link:hover {
		color: var(--fg);
	}
	/* Title and customer line only. The editors and the facts row are siblings of
	   .head-top, not children of this column — inside it they were boxed into
	   whatever width the status badge left over, which on a phone is not much. */
	.head-main {
		flex: 1;
		display: grid;
		gap: 0.35rem;
		min-width: 0;
	}

	/* The open state is `.icon-btn.on` in app.css — brand-driven and correct in
	   both themes. The literal lilac wash that used to live here predated that and
	   clashed with every palette but the one it was drawn against. */
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
		font-weight: 500;
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
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}
	.doc-btn.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
	.doc-btn.primary {
		background: var(--brand);
		border-color: var(--brand-deep);
		color: var(--on-brand);
	}
	/* New since the contractor last opened this order's files. */
	.new-badge {
		display: inline-block;
		margin: 0.2rem 0 0 0.3rem;
		font-size: 0.66rem;
		font-weight: 600;
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
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--brand) 30%, transparent);
		border: 1px solid var(--brand-deep);
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
	/* The thread itself is MessageThread's; what stays here is its palette, the
	   lede, the reply composer and the note under it.

	   The palette is set as custom properties on this panel rather than passed
	   inline on the component, because it needs a dark-mode variant and inline
	   style props cannot carry one.

	   What it fixes: "mine" used to be a solid `--brand` fill with `--ink` text.
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
		background: var(--brand);
		color: var(--on-brand);
		font-family: inherit;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
	}
	.msg-invite-send:hover:not(:disabled) {
		background: var(--brand-deep);
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

	/* "+ Note", across from the History heading. Shares the timeline toggles'
	   geometry so the pane's three controls read as one family, but carries the
	   border weight of a real action rather than a quiet toggle. */
	.note-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		padding: 0.3rem 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 0.14s ease,
			border-color 0.14s ease,
			color 0.14s ease;
	}
	/* The sign leads at a larger size than the word — it is the part that is read
	   at a glance, and at label size a "+" all but disappears. */
	.note-btn-sign {
		font-size: 1rem;
		line-height: 1;
		font-weight: 700;
	}
	.note-btn:hover {
		border-color: var(--brand);
		background: var(--surface-sunken);
	}
	/* Open: the fill says the form below is this button's doing. The "+" does NOT
	   flip to "−" — the visible words are the accessible name (WCAG 2.5.3), so the
	   label has to hold still, and "− Add note" would read as nonsense next to it.
	   `aria-expanded` carries the state for anyone not seeing the fill. */
	.note-btn.on,
	.note-btn.on:hover {
		background: color-mix(in srgb, var(--brand) 14%, var(--surface));
		border-color: var(--brand);
		color: var(--brand);
	}
	.note-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	.tl-toggle {
		padding: 0.25rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 500;
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
	/* Flattened. Every entry used to be its own bordered, filled, rounded box —
	   twelve of them stacked read as twelve cards inside a card, and the history
	   ended up the tallest thing on the page while saying the least. It is a
	   reference list: hairlines between entries, no chrome, and the signals that
	   actually mean something (internal, latest) carry their own marks below. */
	.tl-entry {
		position: relative;
		padding: 0.4rem 0.1rem 0.45rem;
		display: grid;
		gap: 0.1rem;
	}
	.tl-entry + .tl-entry {
		border-top: 1px solid var(--line);
	}
	/* The dot on the rail, aligned with the entry's title line. */
	.tl-entry::before {
		content: '';
		position: absolute;
		left: -1.24rem;
		top: 0.72rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: var(--line-strong);
		/* Ring in the card colour so the dot punches through the rail cleanly. */
		border: 2px solid var(--surface);
		box-sizing: content-box;
	}
	/* An internal note is the one distinction worth a fill: it is the entry the
	   customer will never see, and mistaking it for one they can is the expensive
	   error. Kept as a tint plus its own dot rather than the full box. */
	.tl-entry.internal {
		background: #fffdf5;
		border-radius: 8px;
		padding-left: 0.5rem;
		box-shadow: inset 2px 0 0 #d4a72c;
	}
	.tl-entry.internal::before {
		background: #d4a72c;
	}
	/* The most recent entry, lifted just enough to catch the eye first: an accent
	   left edge, a hair more contrast than the entries below it, and a soft shadow.
	   After .internal so it wins the shared dot when the newest entry is also a note. */
	/* The newest entry needs no box: it is already first, and it already wears the
	   "Latest" pill. Weighting the title is enough. */
	.tl-entry.latest .tl-title {
		font-weight: 600;
	}
	.tl-entry.latest::before {
		background: var(--brand-deep);
		/* Same as above: an empty dot, coloured only to satisfy the brand-fill
		   guard. This one has been tripping it since before the invoice work. */
		color: var(--on-brand);
	}
	.tl-title {
		font-size: 0.88rem;
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
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--on-brand);
		background: var(--brand);
		border: 1px solid var(--brand-deep);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
	}
	.tl-tag {
		flex-shrink: 0;
		font-size: 0.68rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9a6700;
	}
	.tl-detail {
		font-size: 0.86rem;
		line-height: 1.4;
		color: var(--fg-muted);
		white-space: pre-wrap;
	}
	.tl-meta {
		font-size: 0.72rem;
		color: var(--fg-muted);
		opacity: 0.85;
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
		background: var(--brand);
		color: var(--on-brand);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.primary-btn:hover:not(:disabled) {
		background: var(--brand-deep);
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
		font-weight: 400;
		color: var(--fg);
	}
	.st-option:hover {
		border-color: var(--fg-muted);
	}
	.st-option.on {
		border-color: var(--brand-deep);
		background: color-mix(in srgb, var(--brand) 16%, var(--surface));
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
		font-weight: 700;
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
		border-color: var(--brand-deep);
		box-shadow: 0 0 0 3px var(--brand-glow);
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
		accent-color: var(--brand-deep);
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
		font-weight: 400;
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
	/* ------------------------------------------------------- Who it is for
	   The People directory's row, on this page. Same photo-or-initial, same name,
	   same 💬 in the same seat — a person should not be drawn three different ways
	   in one product. */
	/* The order's own box.

	   The chrome used to be on the customer row, which was the only thing in it.
	   It now holds three things — who the job is for, the two facts you glance at,
	   and the fold — so the surface belongs to the box and the customer row is
	   just its first line.

	   Keeping the box (rather than letting these sit on the page's ground) is what
	   stops the avatar landing a quarter of a rem off the screen edge on a phone:
	   the gutter is 0.8rem there, and content flush against the glass reads as
	   something that slipped rather than something that was placed. */
	.order-box {
		display: grid;
		min-width: 0;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--surface);
		box-shadow: var(--card-shadow);
	}
	.head-customer {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
		padding-bottom: 0.55rem;
	}
	/* The identity half. Not a link and not a button: every other press on this
	   page does something to the job, and "who is this for" is a fact you read. */
	.cust-identity {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}
	.cust-avatar {
		flex: none;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-round);
		object-fit: cover;
		background: var(--surface-sunken);
	}
	.cust-avatar.fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--line-strong);
		font-size: 0.9rem;
		font-weight: 800;
		color: var(--fg-muted);
	}
	.cust-who {
		min-width: 0;
		display: grid;
		gap: 0.05rem;
	}
	.cust-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--fg);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cust-name.orphan {
		color: var(--fg-muted);
	}
	/* Where they are and how to reach them, on one line and ellipsised as a pair.
	   These used to be a panel you opened; as a caption they are simply there, and
	   cost the header nothing it was not already spending. */
	.cust-meta {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.cust-where,
	.cust-reach {
		flex: 0 1 auto;
		min-width: 0;
		display: inline-flex;
		align-items: baseline;
		gap: 0.2rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cust-contact {
		flex: none;
		position: relative;
	}
	/* The email is the first thing to go when the header is narrow: the name and
	   the town are what identify a job, and an address that ellipsises to "ja…" is
	   worth less than the space it takes. */
	@media (max-width: 40rem) {
		.cust-reach {
			display: none;
		}
	}
	/* Follow-up and files as labelled pairs rather than two runs of loose text.

	   They were `LABEL value ⊕` triplets separated only by whitespace, so on any
	   width where they shared a line you could not tell where one ended and the
	   next began — "FOLLOW-UP 20 Aug FILES 3" reads as one sentence. The label's
	   colour is what separates it from its value. */
	/* The glanceable half, inside the card rather than beside it. A rule above it
	   rather than a gap alone: identity and schedule are two different questions
	   and the card is now answering both. */
	.oc-facts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		min-width: 0;
		gap: 0.35rem 1rem;
		margin: 0;
		padding-top: 0.55rem;
		border-top: 1px solid var(--line);
	}
	/* The arrow between the two dates — what makes them one span of time rather
	   than two dates filed next to each other. */
	.fact-arrow {
		color: var(--fg-muted);
		font-size: 0.85rem;
	}

	/* The disclosure. A quiet row, because it is a way IN to reference material
	   rather than an action on the job — and pushed right, where a card's controls
	   live, rather than left where its facts do. */
	.oc-more {
		display: flex;
		justify-content: flex-end;
		padding-top: 0.5rem;
	}
	.oc-more-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0;
		border: none;
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
	}
	.oc-more-btn:hover {
		color: var(--fg);
	}
	.oc-more-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
		border-radius: 4px;
	}
	.oc-chev {
		font-size: 0.65rem;
		transition: transform 0.15s ease;
	}
	.oc-chev.open {
		transform: rotate(180deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.oc-chev {
			transition: none;
		}
	}
	/* The opened half. Same internal rhythm the Details card had — a rule between
	   blocks rather than a gap alone — since it is the same content. */
	.oc-detail {
		display: grid;
		padding-top: 0.6rem;
		border-top: 1px solid var(--line);
	}
	.oc-detail > * + * {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--line);
	}
	.oc-detail-actions {
		display: flex;
		justify-content: flex-end;
	}
	/* Plain text, not chips. Follow-up / Files each used to sit in its own
	   bordered, filled, rounded box — boxes across the header, each framing about
	   six characters. Removing the chrome is most of what makes this page feel
	   lighter; the label's colour is enough to separate it from its value. */
	.fact {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		padding: 0.15rem 0;
	}
	.fact dt {
		flex: none;
		font-size: 0.72rem;
		font-weight: 400;
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
	/* A fact's value. */
	.fact-value {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--fg);
	}
	.fact-value.due {
		color: var(--danger);
	}
	/* The project type rides the title without competing with it. */
	.order-type {
		font-size: 0.95rem;
		font-weight: 400;
		color: var(--fg-muted);
	}
	/* The page's own title, opting out of the slab treatment a bare `h1` gets in
	   app.css — the accent block belongs on a section heading, not on a name that
	   can run to three lines.

	   What it no longer opts out of is the THEME. It used to pin Helvetica and the
	   literal `#1f2328`, which predate the palettes: the face ignored whichever
	   display type the theme ships, and near-black on a near-black page is what
	   that colour is in dark mode. Both now come from tokens — the face and its
	   tracking are inherited from the shared `h1, h2, h3` rule, and only the size
	   and the slab are restated here. */
	.order-title {
		margin: 0;
		font-size: 1.6rem;
		overflow-wrap: anywhere;
		line-height: 1.2;
		color: var(--fg);
		/* The one thing it still overrides: a project name is CONTENT, typed by the
		   contractor, and the themes that uppercase their headings mean labels.
		   "Rear elevation re-clad" shouted back at you is not a house style, it is
		   the app disagreeing with what you typed. */
		text-transform: none;
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
	/* The strip is a standalone control now rather than the lid of a card: the
	   panes each carry their own chrome, so there is no box for it to be the top
	   of. Rounded and bordered on its own so it still reads as one object. */
	.tabs {
		border: 1px solid var(--line);
		border-radius: 12px;
		/* Scrolls sideways, never clips. It was `overflow: hidden` — fine for the
		   radius, quietly fatal once the strip outgrew a phone: the tabs are
		   `nowrap`, so the last one was cut off and unreachable rather than
		   narrowed. Billing joining as a fifth is what made that visible, but four
		   already overflowed 360px once "Waiting on them" is spelled out. */
		overflow: auto hidden;
		/* A scrollbar across a five-item tab strip is louder than the strip. The
		   overflow is discoverable by dragging, which is how a phone is used. */
		scrollbar-width: none;
	}
	.tabs::-webkit-scrollbar {
		display: none;
	}
	/* Tabs share the strip evenly rather than bunching at the left with a long
	   empty tail — where there is room to share. Each is a full-height target,
	   which is what a thumb wants. */
	.tabs {
		display: flex;
		gap: 0.15rem;
		padding: 0 0.35rem;
		background: var(--surface-sunken);
	}
	.tab {
		/* Grows into spare room, never shrinks below its own label: `1 1 0` with
		   `min-width: 0` let a tab be narrower than the word inside it, which with
		   `nowrap` above means the word simply left the box. */
		flex: 1 1 auto;
		min-width: max-content;
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
		font-weight: 600;
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
		border-bottom-color: var(--brand-deep);
	}
	.tab:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -3px;
	}
	.tab-count {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--line);
		color: var(--fg-muted);
		font-size: 0.7rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	/* Pinned dark: yellow stays light in both themes. */
	.tab.on .tab-count {
		background: var(--brand);
		color: var(--on-brand);
	}
	/* Unanswered messages. The one count on this strip that is a notification
	   rather than an inventory, so it is the only one that carries the accent —
	   and it keeps it while the tab is selected, because selecting the tab is not
	   answering. Accent rather than --danger, matching every other waiting count
	   in the app: docs/adr/0009-waiting-counts-use-the-accent-not-danger.md. */
	.tab-count.as-pending,
	.tab.on .tab-count.as-pending {
		background: var(--brand);
		border-color: var(--brand-deep);
		color: var(--on-brand);
	}
	/* Quiet link in a panel's header row, across from its title. */
	.panel-link {
		flex: none;
		font-size: 0.78rem;
		font-weight: 500;
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
	   recognising a name. The mark on the left carries the on/off state. */ /* A staged, uncommitted toggle: dashed amber so it clearly isn't saved yet.
	   The header's "✓ Save N" is the other half of the signal. */

	/* The add box: the roster only ever appears as search matches under it. */
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
		border-color: var(--brand-deep);
		box-shadow: 0 0 0 3px var(--brand-glow);
		background: var(--field-bg-focus);
	}
	/* The header commit pair: discard as quiet text, save as a compact yellow
	   pill carrying the staged count. */
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
		outline: 2px solid var(--brand);
		outline-offset: 2px;
		border-radius: 8px;
	}

	/* ----------------------------------------------------- Editor cards
	   The panel shell itself lives in InlineEditor.svelte; what's left here is only
	   what goes *inside* one. */
	.editor-note {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--fg-muted);
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
	/* ------------------------------------------------------------ Phones */
	@media (max-width: 560px) {
		/* Phones were spending roughly 2rem of every row on chrome — 0.75rem of page
		   gutter each side plus 1.2rem of card padding — before any content got a
		   look in. On a 360px screen that is a sixth of the width given over to
		   whitespace around whitespace. The gutter and the card padding both come
		   in, and the stack tightens, so the page carries appreciably more per
		   screenful without anything actually feeling cramped. */
		.page {
			/* 0.8rem of gutter, not 0.6. The tighter figure was reclaiming width the
			   desktop chrome was spending, which is right for a list of cards and
			   wrong here: this page's blocks carry their own borders, and a bordered
			   card six pixels off the glass reads as a rendering fault rather than a
			   tight margin. Seven pixels of content width is a cheap price. */
			padding: 0.85rem 0.8rem 2rem;
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
		/* The blocks below it stack; at 0.9rem apart the follow-up and files
		   rows pushed the tabs off the bottom of the screen. */
		.order-head {
			gap: 0.6rem;
		}
		.oc-facts {
			gap: 0.3rem 0.75rem;
		}
		.fact {
			padding: 0.28rem 0.4rem 0.28rem 0.55rem;
		}
		/* Long project names shouldn't push the header sideways. */
		.order-title {
			font-size: 1.25rem;
			overflow-wrap: anywhere;
		}
		.pane {
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
		font-weight: 500;
		cursor: pointer;
	}
	.closeout-complete {
		border: none;
		background: var(--brand);
		color: var(--on-brand);
		box-shadow: var(--pop-shadow-sm);
	}
	.closeout-complete:hover {
		background: var(--brand-deep);
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
	/* ------------------------------------------------------------------ Details
	   What the job is, where and when. Reads as a short reference card; it is the
	   thing you check, not the thing you work in. */
	/* Reads like a page of an invoice rather than a form: hairline rules between
	   the three things it says, room to breathe between them, and labels that sit
	   quietly beside their values instead of announcing themselves.

	   What made this heavy was never the font weight — it was FOUR uppercase,
	   letter-spaced labels inside one small card (Details, Starts, Target, Site),
	   each drawing as much attention as the value it introduced. One eyebrow per
	   card is a signpost; four is shouting. */
	.det-scope {
		margin: 0;
		font-size: 0.95rem;
		/* Loose. This is the only real prose on the page and the thing most likely
		   to be read start to finish. */
		line-height: 1.65;
		color: var(--fg);
		white-space: pre-wrap;
	}
	/* The schedule. Two dates joined by a rule, so they read as one span of time
	   rather than as two facts filed next to each other. */
	.det-schedule {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.det-when {
		display: grid;
		gap: 0.05rem;
	}
	.det-when-label {
		font-size: 0.75rem;
		color: var(--fg-muted);
	}
	.det-when-value {
		font-size: 1.05rem;
		font-variant-numeric: tabular-nums;
		color: var(--fg);
	}
	/* The join. A rule rather than an arrow glyph: it does not need reading, it
	   needs to look like a span, and it is hidden from assistive tech because the
	   two labels already say which end is which. */
	.det-arrow {
		flex: 1;
		min-width: 1.5rem;
		height: 1px;
		margin-bottom: 0.6rem;
		background: var(--line);
	}
	.det-site {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		font-size: 0.92rem;
		line-height: 1.5;
		color: var(--fg);
	}
	.det-site-label {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--fg-muted);
	}
	.det-visit {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		font-size: 0.92rem;
	}
	.det-visit-value {
		margin-right: auto;
		color: var(--fg);
	}
	.det-visit-form {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.det-visit input[type='date'] {
		padding: 0.3rem 0.45rem;
		border: 1px solid var(--field-border);
		border-radius: 8px;
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.85rem;
	}
	.det-empty {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.45;
		color: var(--fg-muted);
	}
	.det-form {
		display: grid;
		gap: 0.6rem;
	}
	.det-form textarea {
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--field-border);
		border-radius: 8px;
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.9rem;
		line-height: 1.5;
		resize: vertical;
	}
	.det-dates,
	.det-site-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.det-dates .inv-field {
		flex: 1;
		min-width: 7rem;
	}
	.det-state input {
		width: 3.5rem;
		text-transform: uppercase;
	}
	.det-zip input {
		width: 5.5rem;
	}
	.det-check {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.86rem;
		color: var(--fg-muted);
		cursor: pointer;
	}

	/* ------------------------------------------------------------------ Invoice
	   The money card. Reads top to bottom as an account does: what it costs, what
	   came in, what is left — with the balance given the weight, because it is the
	   only line anyone opens this card to read. */
	.invoice {
		gap: 0.7rem;
	}
	.inv-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.inv-head h2 {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}
	.inv-preview {
		font-size: 0.82rem;
		font-weight: 500;
		color: var(--fg-muted);
		text-decoration: none;
		white-space: nowrap;
	}
	.inv-preview:hover {
		color: var(--fg);
		text-decoration: underline;
	}
	.inv-total-read,
	.inv-total-form {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.inv-total-label {
		font-size: 0.9rem;
		color: var(--fg-muted);
	}
	.inv-total-value {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--fg);
	}
	/* An unset total is a prompt, not a figure — it must not read as "$0.00". */
	.inv-total-value.unset {
		font-size: 0.9rem;
		font-weight: 400;
		color: var(--fg-muted);
	}
	.inv-total-read .inv-btn,
	.inv-total-form .inv-btn {
		margin-left: auto;
	}
	.inv-total-form .inv-btn + .inv-btn {
		margin-left: 0;
	}

	/* The payment lines. */
	.inv-lines {
		list-style: none;
		margin: 0;
		padding: 0.15rem 0 0;
		display: grid;
		gap: 0.1rem;
		border-top: 1px solid var(--line);
	}
	.inv-line {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--line);
	}
	.inv-line-text {
		flex: 1;
		min-width: 0;
	}
	.inv-line-label {
		display: block;
		font-size: 0.92rem;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.inv-line-date {
		display: block;
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.inv-line-amount {
		font-variant-numeric: tabular-nums;
		font-weight: 500;
		white-space: nowrap;
	}
	/* Sized and coloured to be findable but not inviting — removing a payment is a
	   correction, and corrections should take a deliberate click. */
	.inv-remove {
		flex-shrink: 0;
		width: 1.6rem;
		height: 1.6rem;
		display: grid;
		place-items: center;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 8px;
		background: none;
		color: var(--fg-muted);
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
	}
	.inv-remove:hover {
		border-color: var(--danger);
		color: var(--danger);
	}
	.inv-line-confirm {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.82rem;
		color: var(--danger);
		white-space: nowrap;
	}
	.inv-remove-yes {
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--danger);
		border-radius: 8px;
		background: var(--danger);
		color: #fff;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}

	/* ---- The breakdown. Rows are buttons: the whole line is the edit target, so
	   there is no pencil icon per row competing with the figures. */
	.inv-items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.1rem;
	}
	.inv-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.inv-item-read {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.35rem 0.4rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: none;
		color: inherit;
		font-family: inherit;
		font-size: 0.9rem;
		text-align: left;
		cursor: pointer;
	}
	.inv-item-read:hover {
		border-color: var(--line-strong);
		background: var(--surface-sunken);
	}
	.inv-item-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.inv-item-amount {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* A discount is a line like any other, but it should not read as a charge. */
	.inv-item-amount.credit {
		color: var(--ok-fg);
	}
	.inv-item-form {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.inv-item-label-input {
		flex: 1;
		min-width: 6rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--field-border);
		border-radius: 8px;
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.88rem;
	}
	.inv-amount.tight input {
		width: 5.5rem;
	}
	.inv-add-line {
		justify-self: start;
		padding: 0.25rem 0.5rem;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
	}
	.inv-add-line:hover {
		color: var(--fg);
		background: var(--surface-sunken);
	}

	/* ---- Paid-so-far. A track the width of the card with the paid portion filled;
	   the figures beneath it are what actually report the numbers. */
	.inv-progress {
		height: 6px;
		border-radius: 999px;
		/* A wash of the foreground rather than a surface token: the track sits on
		   the hero's own tint, and --surface-sunken on top of that is invisible. */
		background: color-mix(in srgb, var(--fg) 12%, transparent);
		overflow: hidden;
	}
	.inv-progress-fill {
		height: 100%;
		width: calc(var(--paid) * 100%);
		background: var(--brand);
		/* No text lives in here, so this is for the guard rather than for a reader:
		   theme.contrast.test.ts fails any brand fill that lets a flipping colour
		   token through, and the rule is worth keeping absolute rather than carving
		   out exceptions for the elements that happen to be empty today. */
		color: var(--on-brand);
		transition: width 0.3s ease;
	}
	/* Settled turns the bar the same green the verdict line wears, so the two
	   agree at a glance rather than one saying "done" over a brand-yellow bar. */
	.inv-progress.full .inv-progress-fill {
		background: var(--ok-fg);
	}

	/* ---- The headline. A tinted block at the top of the card carrying the one
	   figure the card exists to report, at a size nothing else on the page
	   competes with. The rest of the invoice is the working-out. */
	.inv-hero {
		display: grid;
		gap: 0.3rem;
		padding: 0.75rem 0.9rem 0.85rem;
		border-radius: 12px;
		border: 1px solid var(--line);
		background: var(--surface-sunken);
	}
	/* Money owed wears the brand accent, not --danger: an outstanding balance is
	   ordinary business, and ADR-0009 reserves red for faults and destruction. */
	.inv-hero.owed {
		border-color: var(--brand-deep);
		background: color-mix(in srgb, var(--brand) 12%, var(--surface));
	}
	.inv-hero.settled {
		border-color: var(--ok-line);
		background: var(--ok-bg);
	}
	.inv-hero-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-muted);
	}
	.inv-hero.settled .inv-hero-label,
	.inv-hero.settled .inv-hero-value {
		color: var(--ok-fg);
	}
	/* The number. Size and tabular figures do the work here — this is the one
	   place on the page allowed to be loud, and it earns it by being the only one. */
	.inv-hero-value {
		font-size: 2rem;
		font-weight: 700;
		line-height: 1.05;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		color: var(--fg);
	}
	/* Nothing recorded is a sentence, not a figure, and must not be set like one. */
	.inv-hero-value.unset {
		font-size: 0.95rem;
		font-weight: 400;
		color: var(--fg-muted);
	}
	.inv-hero-sub {
		font-size: 0.78rem;
		color: var(--fg-muted);
	}

	/* Record-a-payment. */
	.inv-record {
		justify-self: start;
		padding: 0.4rem 0.8rem;
		border: 1px dashed var(--line-strong);
		border-radius: 10px;
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.88rem;
		font-weight: 500;
		cursor: pointer;
	}
	.inv-record:hover {
		border-style: solid;
		border-color: var(--brand-deep);
		color: var(--fg);
	}
	.inv-pay-form {
		display: grid;
		gap: 0.6rem;
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--surface-sunken);
	}
	.inv-pay-row {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.inv-field {
		display: grid;
		gap: 0.2rem;
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.inv-field.grow {
		flex: 1;
		min-width: 8rem;
	}
	.inv-field input {
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--field-border);
		border-radius: 8px;
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.92rem;
		width: 100%;
		box-sizing: border-box;
	}
	.inv-amount {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-left: 0.5rem;
		border: 1px solid var(--field-border);
		border-radius: 8px;
		background: var(--field-bg);
	}
	.inv-amount input {
		border: none;
		background: none;
		padding-left: 0;
		width: 7rem;
	}
	.inv-amount input:focus {
		outline: none;
	}
	.inv-cur {
		color: var(--fg-muted);
		font-size: 0.92rem;
	}
	/* The radio groups render as chips: the native control is hidden from sight but
	   NOT from the accessibility tree, so the group is still a radiogroup to a
	   screen reader and still keyboard-navigable with the arrow keys. */
	.inv-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.28rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--fg-muted);
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
	}
	.inv-chip input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.inv-chip.on {
		border-color: var(--brand-deep);
		background: var(--brand);
		/* Pinned dark: yellow stays light in both themes. See app.css. */
		color: var(--on-brand);
	}
	.inv-chip:focus-within {
		outline: 2px solid var(--brand-deep);
		outline-offset: 2px;
	}
	.inv-pay-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.inv-btn {
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: 8px;
		background: var(--surface);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}
	.inv-btn:hover {
		border-color: var(--brand-deep);
	}
	.inv-btn.primary {
		background: var(--brand);
		border-color: var(--brand-deep);
		color: var(--on-brand);
	}
	.inv-notes {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--fg-muted);
		white-space: pre-wrap;
	}
	.co-preview {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--fg-muted);
		text-decoration: none;
	}
	.co-preview:hover {
		color: var(--fg);
		text-decoration: underline;
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
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
	}
	.cs-badge.done {
		background: var(--brand);
		color: var(--on-brand);
		border: 1px solid var(--brand-deep);
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
		font-weight: 500;
		color: var(--fg);
	}
	.cs-muted {
		color: var(--fg-muted);
		font-weight: 400;
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
		font-weight: 700;
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
		font-weight: 400;
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
		border-color: var(--brand-deep);
		box-shadow: 0 0 0 3px var(--brand-glow);
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
		border-color: var(--brand-deep);
		box-shadow: 0 0 0 3px var(--brand-glow);
	}
	.co-cur {
		font-size: 1.05rem;
		font-weight: 400;
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
		font-weight: 400;
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
		font-weight: 400;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.co-method.on {
		border-color: var(--brand-deep);
		background: var(--brand);
		color: var(--on-brand);
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
		background: var(--brand);
		color: var(--on-brand);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		padding: 0.55rem 1.2rem;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.co-save:hover {
		background: var(--brand-deep);
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
		font-weight: 500;
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
		font-weight: 600;
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
		color: var(--brand-deep);
	}

	/* The tab strip's actual mechanism now that all three panes are in the DOM at
	   once: the selected one shows, the other two are display:none — out of the
	   layout AND out of the accessibility tree, which is what a tab panel that is
	   not selected should be. Above 1100px the desktop block overrides this and
	   all three show at once. */
	/* Each pane carries its own card chrome. It used to inherit it from one
	   `.panel` wrapper that held all three; with the panes laid out separately
	   there is no shared box to inherit from. */
	.pane {
		display: grid;
		gap: 0.85rem;
		min-width: 0;
		padding: 1.1rem 1.2rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--surface);
		box-shadow: var(--card-shadow);
	}
	.pane:not(.on) {
		display: none;
	}
	/* The phone's Messages screen: a column of exactly the height `fitMessagesPane`
	   measured, with the thread taking whatever the heading and the composer leave.
	   Only ever set below 1100px — above it the class is cleared, because there the
	   pane is a column beside the rail and has a page to grow down.

	   `.on` is in the selector to outrank `.pane:not(.on) { display: none }` above,
	   which carries the same two-class weight and comes first. Without it this rule
	   would win on source order and DISPLAY the Messages pane while another tab is
	   selected. */
	.pane-messages.on.fill {
		height: var(--messages-fill);
		display: flex;
		flex-direction: column;
		/* Hand the sizing to the thread's own `flex: 1 1 auto` instead of the 26rem
		   below, which is what put the composer under the fold. */
		--thread-max-height: none;
	}

	/* The billing pane wraps a card that draws its own frame, so the pane must not
	   draw a second one around it. Every other pane IS the card. */
	.pane-billing {
		padding: 0;
		border: none;
		background: none;
		box-shadow: none;
	}

	/* These custom properties used to live on `.panel-body`, the one card that
	   wrapped all three tabs. The panes are their own cards now, so the properties
	   move onto each pane — MessageThread reads them from its nearest ancestor, and
	   left where they were they would have resolved to nothing and the thread would
	   have rendered uncoloured. */
	.pane {
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
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}
	.fu-current {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--fg);
	}
	.fu-current.unset {
		font-weight: 400;
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
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.fu-opt-label {
		font-size: 0.8rem;
		font-weight: 400;
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
		font-weight: 400;
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
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
	}
	.fu-btn:hover {
		border-color: var(--fg-muted);
		background: var(--surface-inset);
	}
	.fu-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	.fu-btn.primary {
		width: auto;
		flex: none;
		background: var(--brand);
		border-color: var(--brand-deep);
		color: var(--on-brand);
		font-weight: 600;
	}
	.fu-btn.primary:hover {
		background: var(--brand-deep);
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
	}
	:global(:root[data-theme='dark']) .tl-entry.internal::before {
		background: #e3b341;
	}
	:global(:root[data-theme='dark']) .tl-tag {
		color: #e3b341;
	}
	:global(:root[data-theme='dark']) .order-title {
		color: var(--fg);
	}

	/* ==================================================================
	   The workspace: one column on a phone, two from 1100px.

	   Real column ELEMENTS rather than placing every card directly on the page
	   grid. The difference matters: siblings on one grid share rows, so a tall
	   conversation beside a short details card left a hole under the short one —
	   which is what made every arrangement of this page feel gappy. Two grids that
	   each stack their own children have no such relationship.

	   Below 1100px all three wrappers are `display: contents`, so the cards fall
	   back into the page's single column and the tab strip does its old job.

	   WHY THE RAIL IS FIRST IN THE MARKUP. Details and Invoice are always on screen;
	   only the three panes are behind the tabs. With the rail written second, a phone
	   read `tabs → pane → Details → Invoice`, so the two always-on cards landed under
	   whichever tab was open — which is exactly how "the order's details" came to look
	   like part of the People tab. Writing the rail first puts them ABOVE the strip,
	   which leaves the strip and the one pane it selects touching, in every tab.
	   Desktop is unaffected: both columns are placed explicitly, so the source order
	   the phone needs costs the two-column layout nothing.
	   ================================================================== */
	.workspace,
	.col-main,
	.col-rail {
		display: contents;
	}

	@media (min-width: 1100px) {
		/* Nothing is behind a tab any more, so the control that switches between
		   them has no job. Scoped to this page's own strip — `:global(.tabs)` also
		   matches ContactPanel's channel tablist, which is how the composer once
		   silently lost its Email / Text / Call tabs. */
		.tabs {
			display: none;
		}
		.pane:not(.on) {
			display: grid;
		}
		.workspace {
			display: grid;
			/* The conversation gets the wider half. It is the working surface; the
			   rail is reference. */
			grid-template-columns: minmax(0, 1.5fr) minmax(21rem, 1fr);
			gap: var(--page-gap);
			align-items: start;
		}
		.col-main,
		.col-rail {
			display: grid;
			gap: var(--page-gap);
			align-content: start;
			min-width: 0;
		}
		/* Placed rather than flowed, because the markup order is the phone's (rail
		   first, see above) and the desktop's is the opposite. Both on row 1: neither
		   column spans the other's rows, so a tall conversation can never open a gap
		   in the rail beside it. */
		.col-main {
			grid-column: 1;
			grid-row: 1;
		}
		.col-rail {
			grid-column: 2;
			grid-row: 1;
		}
	}
	/* ------------------------------------------------------------------ Crew
	   Who is on this job and when. The visual weight sits on the ONE fact that
	   is actionable — who is here today — and everything else stays quiet. */
	.crew-today {
		margin: 0;
		padding: 0.45rem 0.65rem;
		border-radius: var(--radius-control);
		border: 1px solid color-mix(in srgb, var(--brand) 40%, var(--surface));
		background: color-mix(in srgb, var(--brand) 12%, var(--surface));
		color: var(--fg);
		font-size: 0.85rem;
		font-weight: 700;
	}
	.crew-error {
		margin: 0;
		color: var(--danger);
		font-size: 0.85rem;
		font-weight: 600;
	}
	/* ------------------------------------------------------- Waiting on them
	   Deliberately built from the crew panel's parts — the same row, the same
	   chips, the same two-step remove. They are the same KIND of thing (a small
	   list of records with an inline editor each), and a second visual language
	   for the second one is how a workspace stops feeling like one place. */
	/* The asks block, sitting above the history rather than behind a tab of its
	   own. Only its gap is set here — everything in it already had a style. */
	.asks {
		display: grid;
		gap: 0.55rem;
		margin-bottom: 0.9rem;
	}
	/* The blurb. Amber, which is this app's tone for waiting on somebody — the
	   same --wait-* trio the status chips wear, so "with the customer" reads the
	   same here as it does on a card in the orders list. NOT --danger: an
	   unanswered question is not a fault, per docs/adr/0009.

	   It replaced a dashed "They see …" quote box. Same sentence, but that one
	   was drawn as an aside about the portal when it is in fact the one line on
	   this panel that says whose turn it is. */
	.ask-banner {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.45rem;
		margin: 0;
		padding: 0.55rem 0.7rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--wait-line);
		background: var(--wait-bg);
		font-size: 0.88rem;
		font-weight: 600;
		line-height: 1.4;
		color: var(--fg);
	}
	.ask-banner-tag {
		flex: none;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-pill);
		background: var(--who-customer);
		color: var(--on-brand);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.ask-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.ask-item {
		border: 1px solid var(--line);
		border-left: 3px solid var(--who-customer);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		padding: 0.5rem 0.6rem;
		display: grid;
		gap: 0.4rem;
	}
	/* Past its date. The rim carries it, the way an overdue follow-up does on the
	   dashboard — a list where lateness is a word you have to read is a list where
	   you miss it. */
	.ask-item.late {
		border-left-color: var(--danger);
	}
	/* Done: the rim goes quiet rather than green. Finished work should recede, and
	   a row of ticks competing with the outstanding ones above defeats the panel. */
	.ask-list.done .ask-item {
		border-left-color: var(--line-strong);
		opacity: 0.75;
	}
	.ask-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.ask-text {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.15rem;
	}
	.ask-title {
		font-size: 0.9rem;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.ask-detail {
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--fg-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.ask-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}
	.ask-chip {
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line-strong);
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--fg-muted);
	}
	.ask-chip.late {
		border-color: var(--danger);
		color: var(--danger);
	}
	.ask-chip.hold {
		border-color: var(--wait-fg);
		color: var(--wait-fg);
	}
	.ask-form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.4rem 0.5rem;
		align-items: end;
		padding: 0.55rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
	}
	.ask-form label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--fg-muted);
	}
	.ask-form textarea {
		font-family: inherit;
		resize: vertical;
	}
	/* The checkbox reads left-to-right like a sentence, not like the stacked
	   label/field pairs beside it. */
	.ask-check {
		grid-column: 1 / -1;
		display: flex !important;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		color: var(--fg);
	}
	.ask-done {
		margin-top: 0.2rem;
	}
	.ask-done summary {
		cursor: pointer;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--fg-muted);
	}
	.ask-done-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.1rem;
		padding: 0 0.3rem;
		border-radius: var(--radius-pill);
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		font-size: 0.68rem;
	}
	.ask-list.done {
		margin-top: 0.45rem;
	}

	.crew-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.crew-item {
		border: 1px solid var(--line);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		padding: 0.5rem 0.6rem;
		display: grid;
		gap: 0.4rem;
		/* Transparent by default so the "here today" variant can colour the edge
		   without the contents shifting sideways when it does. */
		border-left: 3px solid transparent;
	}
	.crew-item.here {
		border-left-color: var(--brand);
	}
	.crew-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
	}
	.crew-face {
		width: 30px;
		height: 30px;
		flex: none;
		border-radius: var(--radius-round);
		object-fit: cover;
		border: 1px solid var(--line-strong);
	}
	.crew-face.placeholder {
		display: grid;
		place-items: center;
		background: var(--surface);
		color: var(--fg-muted);
		font-size: 0.68rem;
		font-weight: 800;
	}
	.crew-who {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.05rem;
	}
	.crew-name {
		font-size: 0.88rem;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Somebody who has left the crew but really did work this job. Stated, not
	   hidden — dropping them would rewrite the job's history. */
	.crew-gone {
		margin-left: 0.3rem;
		font-weight: 600;
		font-size: 0.72rem;
		color: var(--fg-muted);
	}
	.crew-meta {
		font-size: 0.74rem;
		color: var(--fg-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.crew-badge {
		flex: none;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-pill);
		background: var(--brand-sweep);
		color: var(--on-brand);
		font-size: 0.65rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.crew-note {
		margin: 0;
		font-size: 0.78rem;
		color: var(--fg-muted);
		white-space: pre-wrap;
	}
	.crew-btn,
	.crew-save {
		flex: none;
		padding: 0.28rem 0.6rem;
		border-radius: var(--radius-control);
		font-family: inherit;
		font-size: 0.76rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.crew-btn {
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg);
	}
	.crew-btn.danger {
		color: var(--danger);
		border-color: var(--danger);
	}
	.wide-btn {
		width: 100%;
	}
	.crew-save {
		border: none;
		background: var(--brand-sweep);
		color: var(--on-brand);
		box-shadow: 0 0 12px var(--brand-glow);
	}
	.crew-form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: 0.5rem;
		padding-top: 0.4rem;
		border-top: 1px solid var(--line);
	}
	.crew-form label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--fg-muted);
		min-width: 0;
	}
	.crew-wide {
		grid-column: 1 / -1;
	}
	.crew-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.crew-spacer {
		flex: 1;
	}
	.crew-confirm {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--danger);
	}
	.crew-add-open {
		justify-self: start;
		padding: 0.45rem 0.8rem;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-control);
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
	}
	.crew-add-open:hover {
		color: var(--fg);
		border-color: var(--brand);
	}
	/* Same dashed affordance as "Put someone on this job", one level in: it is the
	   same kind of offer — an empty outline you fill — and giving the inner one
	   solid button chrome made it look like the primary action of the panel when
	   picking an existing person is the commoner path by far. */
	.crew-new-open {
		justify-self: start;
		padding: 0.4rem 0.7rem;
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-control);
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 700;
		text-align: left;
		cursor: pointer;
	}
	.crew-new-open:hover {
		color: var(--fg);
		border-color: var(--brand);
	}
	/* The three fields, laid out like the dates form below it so the panel has one
	   grammar for "a small form inside a row" rather than two. */
	.crew-new {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.4rem 0.5rem;
		align-items: end;
		padding: 0.5rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
	}
	.crew-new label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--fg-muted);
	}
	.crew-add-box {
		display: grid;
		gap: 0.45rem;
		padding: 0.55rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
	}
	.crew-search-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.crew-search {
		flex: 1;
		min-width: 0;
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--field-border);
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.85rem;
	}
	.crew-picker {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
	}
	.crew-pick-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.45rem;
		border-radius: var(--radius-control);
		background: var(--surface);
		border: 1px solid var(--line);
	}
</style>
