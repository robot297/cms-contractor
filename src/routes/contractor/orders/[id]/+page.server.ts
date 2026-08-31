import { error, fail, redirect } from '@sveltejs/kit';
import {
	isContractorOrderState,
	isSnoozePreset,
	parseDateInput,
	parseDollarsToCents
} from '$lib/crm';
import { isPaymentKind } from '$lib/invoice';
import {
	addOrderNote,
	cancelOrder,
	completeOrder,
	createInvite,
	InviteStillOpenError,
	portalStanding,
	resendInvite,
	addLineItem,
	deleteLineItem,
	deleteOrder,
	deletePayment,
	getOrderDetail,
	setOrderDetails,
	setVisitDate,
	updateLineItem,
	recordPayment,
	setFollowUp,
	setOrderTotal,
	snoozeFollowUp,
	updateOrderState
} from '$lib/server/crm.server';
import {
	deleteDocument,
	listDocuments,
	markDocumentsRead,
	updateDocument,
	uploadDocuments,
	viewerFromLocals,
	type UploadInput
} from '$lib/server/documents.server';
import { assignSubcontractor, unassignSubcontractor } from '$lib/server/subcontractor.server';
import {
	EmptyMessageError,
	getThread,
	markThreadRead,
	sendMessage,
	ThreadForbiddenError
} from '$lib/server/messaging.server';
import type { Actions, PageServerLoad } from './$types';
import { withBillingErrors } from '$lib/server/billing.server';
import { sendEmailAction, sendFinalInvoiceEmail } from '$lib/server/email-action.server';
import { revokeInviteAction } from '$lib/server/invite-action.server';

/**
 * A line item's amount, which unlike every other money field in the app may be
 * NEGATIVE — a discount or a credit is a line, not a special case.
 * `parseDollarsToCents` rejects negatives on purpose (a negative payment or
 * invoice total is always a mistake), so this is its signed sibling rather than
 * a loosening of it.
 */
function parseSignedDollarsToCents(input: string | null | undefined): number | null {
	const raw = (input ?? '').trim();
	if (!raw) return null;
	const negative = raw.startsWith('-');
	const cents = parseDollarsToCents(negative ? raw.slice(1) : raw);
	if (cents == null) return null;
	return negative ? -cents : cents;
}

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

import { validateStint, workerSchema } from '$lib/worker';
import {
	createWorker,
	DuplicateWorkerEmailError,
	WorkerNotFoundError
} from '$lib/server/worker.server';
import { isPersonKind } from '$lib/people';
import { taskSchema } from '$lib/tasks';
import {
	completeTaskAsContractor,
	createTask,
	deleteTask,
	listTasks,
	reopenTask,
	TaskNotFoundError,
	updateTask
} from '$lib/server/tasks.server';
import {
	assignPerson,
	listOrderPeople,
	listPeople,
	unassignPerson
} from '$lib/server/people.server';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireContractor(locals);
	const detail = await getOrderDetail(params.id, user.id);
	if (!detail) error(404, 'Order not found');
	// One list for the panel, one for the picker. Both carry crew and subs — the
	// order page asks "who is on this job", which was never two questions.
	const [assignedPeople, roster, tasks] = await Promise.all([
		listOrderPeople(user.id, params.id),
		listPeople(user.id),
		// What this job is waiting on the CUSTOMER for. Loaded here rather than
		// behind its own fetch because the tab shows a count, and a count that
		// arrives late is a tab that changes width after you have looked at it.
		listTasks(params.id)
	]);
	const onJob = new Set(assignedPeople.map((p) => `${p.kind}-${p.id}`));

	// The conversation with the customer. Opening the order is what marks it read
	// for the contractor side — the customer's own unread state is untouched.
	const viewer = { role: 'contractor' as const, userId: user.id };
	const thread = (await getThread(params.id, viewer)) ?? [];
	await markThreadRead(params.id, viewer);

	// Read the list BEFORE marking it read, so this render still shows which
	// documents arrived unseen. Marking is also what closes the window on a
	// customer's withdrawal, so it happens on open and not on a later click.
	const documents = await listDocuments(viewer, params.id);
	await markDocumentsRead(viewer, params.id);

	// Whether the customer spoke last and is owed an answer. Decides which panel
	// this order opens on: arriving at a job someone is waiting on and landing in
	// the history means finding the conversation yourself. Computed from the
	// thread rather than from a query parameter so it is right however you got
	// here — the dashboard card, the orders list, or a bookmark.
	const owesReply = thread.at(-1)?.authorRole === 'customer';
	// How many the customer has sent since the contractor last said anything. The
	// tab used to print the whole thread length, so a four-message conversation
	// with two unanswered read as "Messages 4" — a number that looks like a
	// notification and means something else entirely.
	let pendingReplies = 0;
	for (let i = thread.length - 1; i >= 0; i--) {
		if (thread[i].authorRole === 'contractor') break;
		pendingReplies++;
	}

	return {
		...detail,
		documents,
		owesReply,
		pendingReplies,
		assignedPeople,
		tasks,
		// The contractor's own name, for the preview of what their CUSTOMER is
		// being told. The portal writes the sentence with it, so the preview has
		// to have it too or the two would differ in the one word that says who is
		// waiting.
		contractorName: user.name,
		// Not yet on this job, offered in the picker. Archived people are already
		// excluded by `listPeople`, so somebody who has left cannot be newly
		// assigned — but the ones already on it stay in `assignedPeople`, because
		// they really did work it.
		availablePeople: roster.filter((p) => !onJob.has(`${p.kind}-${p.id}`)),
		thread,
		// An unlinked customer has no portal to read a reply in, so the composer
		// says so rather than storing a message nobody can see.
		customerLinked: !!detail.customer?.userId,
		portal: await portalStanding(user.id, detail.customer?.id ?? null, !!detail.customer?.userId)
	};
};

// Wrapped so a billing refusal from any guarded write returns a 402 the form
// can render, rather than a 500. See withBillingErrors.
export const actions: Actions = withBillingErrors({
	/**
	 * Sending a composed message. Shared by every surface that mounts the
	 * composer — the implementation lives in one file so the rule about when a
	 * send is recorded on a timeline can't drift between pages.
	 */
	sendEmail: sendEmailAction,

	/**
	 * Reply to the customer in the order's thread. Guarded like every other
	 * contractor write — `sendMessage` calls the billing gate on this branch only,
	 * never on the customer's side of the same thread.
	 */
	replyToCustomer: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const body = form.get('body')?.toString() ?? '';
		try {
			await sendMessage(params.id, { role: 'contractor', userId: user.id }, body);
		} catch (err) {
			if (err instanceof EmptyMessageError) return fail(400, { message: err.message });
			if (err instanceof ThreadForbiddenError) error(404, 'Order not found');
			throw err;
		}
		return { success: true };
	},

	updateStatus: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const state = form.get('state')?.toString() ?? '';
		const note = form.get('note')?.toString() || undefined;
		if (!isContractorOrderState(state)) return fail(400, { message: 'Invalid state' });
		await updateOrderState(params.id, user.id, state, note);
		return { success: true };
	},

	// Close the order out as complete: record the final invoice + payment, and
	// optionally email the invoice to the customer.
	completeOrder: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const amountCents = parseDollarsToCents(form.get('amount')?.toString());
		const notes = form.get('notes')?.toString().trim() || null;
		const paymentMethod = form.get('paymentMethod')?.toString() || null;
		const markPaid = form.get('markPaid') != null;
		const sendInvoice = form.get('sendInvoice') != null;

		await completeOrder(params.id, user.id, { amountCents, notes, paymentMethod, markPaid });

		let invoiceEmail: 'sent' | 'simulated' | 'skipped' | null = null;
		if (sendInvoice) {
			// Re-read AFTER completing, so the emailed invoice carries the payment
			// close-out just recorded. Composing from the form values instead would
			// send a customer a balance that was already settled by the time they
			// read it.
			const detail = await getOrderDetail(params.id, user.id);
			invoiceEmail = detail?.order.customerEmail
				? await sendFinalInvoiceEmail(
						{ id: user.id, name: user.name, email: user.email },
						{
							id: params.id,
							projectName: detail.order.projectName,
							customerName: detail.order.customerName,
							customerEmail: detail.order.customerEmail,
							finalNotes: detail.order.finalNotes
						},
						detail.invoice
					)
				: 'skipped';
		}
		return { success: true, action: 'complete' as const, invoiceEmail };
	},

	// Cancel the order: record the reason (kept internal) and optionally notify.
	cancelOrder: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const reason = form.get('reason')?.toString().trim() || null;
		const notify = form.get('notify') != null;
		await cancelOrder(params.id, user.id, { reason, notify });
		return { success: true, action: 'cancel' as const };
	},

	// What the job costs. Separate from close-out because a deposit needs a total
	// to be half OF, and that is agreed at quote time — see `setOrderTotal`.
	setOrderTotal: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const raw = form.get('total')?.toString() ?? '';
		// A blank field clears the total; a filled-but-unparseable one is a typo and
		// must not silently clear it. `parseDollarsToCents` returns null for both, so
		// the two cases are told apart here rather than there.
		const totalCents = parseDollarsToCents(raw);
		if (raw.trim() && totalCents == null)
			return fail(400, { message: 'Enter a dollar amount, e.g. 4800 or 4,800.00' });
		await setOrderTotal(params.id, user.id, totalCents);
		return { success: true };
	},

	// Money in. The contractor is the only one who can say this happened — they are
	// the only one who saw it (ADR-0010: record, never process).
	recordPayment: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const amountCents = parseDollarsToCents(form.get('amount')?.toString());
		if (amountCents == null || amountCents === 0)
			return fail(400, { message: 'Enter the amount received' });

		const kindInput = form.get('kind')?.toString() ?? 'progress';
		const kind = isPaymentKind(kindInput) ? kindInput : 'progress';
		const method = form.get('method')?.toString() || null;
		const note = form.get('note')?.toString() ?? null;
		// The date the money changed hands, which the contractor may backdate. An
		// unparseable date falls back to now rather than refusing the payment — the
		// amount is the fact worth keeping.
		const receivedAt = parseDateInput(form.get('receivedAt')?.toString() ?? '');

		await recordPayment(params.id, user.id, { kind, amountCents, method, note, receivedAt });
		return { success: true };
	},

	deletePayment: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const paymentId = form.get('paymentId')?.toString() ?? '';
		if (!paymentId) return fail(400, { message: 'No payment selected' });
		await deletePayment(paymentId, params.id, user.id);
		return { success: true };
	},

	// The job's own details, saved as one panel rather than five fields.
	setOrderDetails: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await setOrderDetails(params.id, user.id, {
			description: form.get('description')?.toString() ?? null,
			siteAddress: form.get('siteAddress')?.toString() ?? null,
			siteCity: form.get('siteCity')?.toString() ?? null,
			siteState: form.get('siteState')?.toString() ?? null,
			sitePostalCode: form.get('sitePostalCode')?.toString() ?? null,
			startDate: parseDateInput(form.get('startDate')?.toString() ?? ''),
			targetDate: parseDateInput(form.get('targetDate')?.toString() ?? '')
		});
		return { success: true };
	},

	// One charge on the invoice. A blank amount is refused rather than treated as
	// zero — a line with no price is a typo, not a freebie.
	addLineItem: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const label = form.get('label')?.toString().trim() ?? '';
		const amountCents = parseSignedDollarsToCents(form.get('amount')?.toString());
		if (!label) return fail(400, { message: 'Give the line a name' });
		if (amountCents == null) return fail(400, { message: 'Enter an amount for this line' });
		await addLineItem(params.id, user.id, { label, amountCents });
		return { success: true };
	},

	updateLineItem: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const itemId = form.get('itemId')?.toString() ?? '';
		const label = form.get('label')?.toString().trim() ?? '';
		const amountCents = parseSignedDollarsToCents(form.get('amount')?.toString());
		if (!itemId) return fail(400, { message: 'No line selected' });
		if (!label) return fail(400, { message: 'Give the line a name' });
		if (amountCents == null) return fail(400, { message: 'Enter an amount for this line' });
		await updateLineItem(itemId, params.id, user.id, { label, amountCents });
		return { success: true };
	},

	// The day the crew is on site. Its own action for the same reason it is its
	// own control: it changes on the morning it applies to.
	setVisitDate: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const raw = form.get('date')?.toString() ?? '';
		const date = parseDateInput(raw);
		if (raw.trim() && !date) return fail(400, { message: 'That date could not be read' });
		await setVisitDate(params.id, user.id, date);
		return { success: true };
	},

	deleteLineItem: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const itemId = form.get('itemId')?.toString() ?? '';
		if (!itemId) return fail(400, { message: 'No line selected' });
		await deleteLineItem(itemId, params.id, user.id);
		return { success: true };
	},

	addNote: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const note = form.get('note')?.toString().trim() ?? '';
		if (!note) return fail(400, { message: 'Note cannot be empty' });
		await addOrderNote(params.id, user.id, note);
		return { success: true };
	},

	setFollowUp: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const raw = form.get('date')?.toString() ?? '';
		const date = raw ? parseDateInput(raw) : null;
		if (raw && !date) return fail(400, { message: 'Invalid date' });
		await setFollowUp(params.id, user.id, date);
		return { success: true };
	},

	snoozeFollowUp: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const preset = form.get('preset')?.toString() ?? '';
		if (!isSnoozePreset(preset)) return fail(400, { message: 'Invalid snooze' });
		await snoozeFollowUp(params.id, user.id, preset);
		return { success: true };
	},

	clearFollowUp: async ({ locals, params }) => {
		const user = requireContractor(locals);
		await setFollowUp(params.id, user.id, null);
		return { success: true };
	},

	/**
	 * Files the contractor puts on the job. Same path, same validation and same
	 * naming rules as a customer's or a subcontractor's upload — what differs is
	 * only the billing guard, which `uploadDocuments` applies on this branch alone.
	 */
	uploadDocuments: async ({ request, locals, params }) => {
		requireContractor(locals);
		const form = await request.formData();
		const files: UploadInput[] = [];
		for (const entry of form.getAll('file')) {
			if (!(entry instanceof File) || entry.size === 0) continue;
			files.push({
				filename: entry.name,
				mimeType: entry.type,
				size: entry.size,
				data: Buffer.from(await entry.arrayBuffer())
			});
		}
		if (files.length === 0) return fail(400, { message: 'Choose a file to upload' });

		const outcomes = await uploadDocuments(viewerFromLocals(locals)!, params.id, files);
		const stored = outcomes.filter((o) => o.ok).length;
		const refused = outcomes.filter((o) => !o.ok);
		// Named, not swallowed: one oversized file in a batch of five must not read
		// as "all five went" or as "nothing went".
		const message = [
			stored > 0 ? `${stored} uploaded` : '',
			...refused.map((r) => `${r.filename} was ${'reason' in r ? r.reason : 'refused'}`)
		]
			.filter(Boolean)
			.join(' · ');
		if (stored === 0) return fail(400, { message });
		return { success: true, message };
	},

	deleteDocument: async ({ request, locals }) => {
		requireContractor(locals);
		const form = await request.formData();
		const documentId = form.get('documentId')?.toString() ?? '';
		if (!documentId) return fail(400, { message: 'A document is required' });
		await deleteDocument(viewerFromLocals(locals)!, documentId);
		return { success: true };
	},

	/** What a document is, in the contractor's words. */
	updateDocument: async ({ request, locals }) => {
		requireContractor(locals);
		const form = await request.formData();
		const documentId = form.get('documentId')?.toString() ?? '';
		if (!documentId) return fail(400, { message: 'A document is required' });
		await updateDocument(viewerFromLocals(locals)!, documentId, {
			note: form.get('note')?.toString() ?? ''
		});
		return { success: true };
	},

	/**
	 * Send a portal invite, or re-send the one already outstanding.
	 *
	 * Answers with `action: 'invite'` either way so the page can say what happened.
	 * It used to return a bare `{ success: true }` that nothing rendered, so
	 * pressing the button produced no visible change at all — and the only way to
	 * find out whether it had worked was to ask the customer.
	 */
	sendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const customerId = form.get('customerId')?.toString() ?? '';
		if (!customerId) return fail(400, { action: 'invite', message: 'A customer is required' });
		const inviteId = form.get('inviteId')?.toString();
		try {
			if (inviteId) await resendInvite(inviteId, user.id);
			else await createInvite(user.id, customerId);
		} catch (err) {
			// A still-open invite blocks a new one until it expires — surface that as
			// a plain message rather than a failure, since nothing actually went wrong.
			if (err instanceof InviteStillOpenError) {
				return fail(409, {
					action: 'invite',
					message: `An invite is already open — you can send another after it expires on ${err.expiresAt.toLocaleDateString()}.`
				});
			}
			console.error('[order] invite failed:', err);
			return fail(500, {
				action: 'invite',
				message: 'That invite could not be sent. Try again in a moment.'
			});
		}
		return { action: 'invite' as const, sent: true, resent: Boolean(inviteId) };
	},

	// Withdraw a pending invite from the contact panel. Shared with the other surfaces.
	revokeInvite: revokeInviteAction,

	/**
	 * Apply a staged set of crew changes in one commit. The picker collects
	 * toggles client-side and only posts on an explicit save: every assignment
	 * writes to the job's history, so a tap should never commit by itself. One
	 * batched action is also the single seam to hang subcontractor notifications
	 * on later — one "you're on this job" per save, not one per tap.
	 */
	saveSubs: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const ids = (field: string) =>
			(form.get(field)?.toString() ?? '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		const assign = ids('assign');
		const unassign = ids('unassign');
		if (assign.length === 0 && unassign.length === 0)
			return fail(400, { message: 'No crew changes to save' });
		// Sequential on purpose: each call re-checks ownership and writes its own
		// timeline entry, and the lists are a handful of people, not thousands.
		for (const subcontractorId of assign)
			await assignSubcontractor(user.id, params.id, subcontractorId);
		for (const subcontractorId of unassign)
			await unassignSubcontractor(user.id, params.id, subcontractorId);
		return { success: true };
	},

	/**
	 * Put somebody on this job, or change the dates of somebody already on it.
	 *
	 * ONE action for crew and subcontractors alike, because the panel is one list
	 * — "who is on this job" was never two questions. `kind` says which table the
	 * id belongs to; it arrives from a hidden field, so it is validated rather
	 * than trusted, and `assignPerson` re-checks ownership on whichever branch it
	 * takes.
	 *
	 * Also the edit path: the underlying writes are upserts, because assigning
	 * somebody already here almost always means "change their dates", and a
	 * separate action would differ only in which of the two it refused.
	 */
	assignPerson: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const personId = form.get('personId')?.toString() ?? '';
		const kind = form.get('kind')?.toString() ?? '';
		if (!personId || !isPersonKind(kind))
			return fail(400, { action: 'crew', message: 'A person is required' });

		const stint = validateStint({
			startsOn: form.get('startsOn')?.toString(),
			endsOn: form.get('endsOn')?.toString()
		});
		if (!stint.ok) return fail(400, { action: 'crew', field: stint.field, message: stint.message });

		try {
			await assignPerson(user.id, params.id, kind, personId, {
				...stint.value,
				role: form.get('role')?.toString()?.trim() || null,
				notes: form.get('notes')?.toString()?.trim() || null
			});
		} catch (err) {
			if (err instanceof WorkerNotFoundError)
				return fail(404, { action: 'crew', message: err.message });
			throw err;
		}
		return { success: true };
	},

	/**
	 * Add somebody who isn't on the books yet, and put them straight on this job.
	 *
	 * The panel could only pick from people who already existed, so hiring a hand
	 * on Tuesday morning meant leaving the job, crossing to the people page,
	 * filling a full record, coming back and finding the job again — five screens
	 * to answer "Dave is here today". The picker now creates as well as searches.
	 *
	 * THREE FIELDS, and that is the point. The people page is where a full record
	 * is kept (email, company, notes, insurance, tiers, a portal login); this is
	 * the field version of it, where a name and what they do is genuinely all that
	 * is known at the moment somebody turns up. Everything else can be filled in
	 * later from the record this creates.
	 *
	 * It creates CREW, never a subcontractor. A sub carries an access tier,
	 * insurance and possibly a portal login — decisions with consequences beyond
	 * this job, which is the wrong thing to make as a side effect of staffing a
	 * Tuesday. A firm you are engaging is still set up on the people page.
	 */
	createAndAssignPerson: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const parsed = workerSchema.safeParse({
			name: form.get('name')?.toString() ?? '',
			phone: form.get('phone')?.toString() ?? '',
			role: form.get('role')?.toString() ?? '',
			email: '',
			company: '',
			notes: ''
		});
		if (!parsed.success)
			return fail(400, {
				action: 'crew',
				message: parsed.error.issues[0]?.message ?? 'Check the details'
			});

		// Validated before the record is written, so a bad date cannot leave a new
		// person on the books who never made it onto the job they were added for.
		const stint = validateStint({ startsOn: form.get('startsOn')?.toString() });
		if (!stint.ok) return fail(400, { action: 'crew', field: stint.field, message: stint.message });

		let created;
		try {
			created = await createWorker(user.id, parsed.data);
		} catch (err) {
			if (err instanceof DuplicateWorkerEmailError)
				return fail(400, { action: 'crew', message: err.message });
			throw err;
		}

		await assignPerson(user.id, params.id, 'crew', created.id, {
			...stint.value,
			// What they are doing HERE starts as what they do generally. Both stay
			// editable from the row once they are on.
			role: parsed.data.role ?? null,
			notes: null
		});
		return { success: true };
	},

	/**
	 * Ask the customer for something.
	 *
	 * The gap this closes: the only thing this product could previously ask a
	 * customer for was money, and only by moving the whole order into Deposit
	 * Pending or Final Payment Pending. Anything else — a colour, a signature, a
	 * gate code, being home on Thursday — had to go in a Message, where it read
	 * as conversation and scrolled away while the portal reported "In progress".
	 */
	addTask: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const parsed = taskSchema.safeParse({
			title: form.get('title')?.toString() ?? '',
			detail: form.get('detail')?.toString() ?? '',
			dueOn: form.get('dueOn')?.toString() ?? '',
			blocking: form.get('blocking') != null
		});
		if (!parsed.success)
			return fail(400, {
				action: 'task',
				message: parsed.error.issues[0]?.message ?? 'Check the details'
			});
		try {
			await createTask(user.id, params.id, parsed.data);
		} catch (err) {
			if (err instanceof TaskNotFoundError)
				return fail(404, { action: 'task', message: err.message });
			throw err;
		}
		return { success: true };
	},

	editTask: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const taskId = form.get('taskId')?.toString() ?? '';
		if (!taskId) return fail(400, { action: 'task', message: 'A task is required' });
		const parsed = taskSchema.safeParse({
			title: form.get('title')?.toString() ?? '',
			detail: form.get('detail')?.toString() ?? '',
			dueOn: form.get('dueOn')?.toString() ?? '',
			blocking: form.get('blocking') != null
		});
		if (!parsed.success)
			return fail(400, {
				action: 'task',
				message: parsed.error.issues[0]?.message ?? 'Check the details'
			});
		try {
			await updateTask(user.id, taskId, parsed.data);
		} catch (err) {
			if (err instanceof TaskNotFoundError)
				return fail(404, { action: 'task', message: err.message });
			throw err;
		}
		return { success: true };
	},

	/**
	 * Tick it off on the customer's behalf.
	 *
	 * Not a redundant copy of the customer's own button: cash changes hands on
	 * site, a permit is handed over in person, and a contractor who cannot record
	 * that is left with a portal telling their customer they still owe something
	 * they have already done. The Timeline records WHICH side ticked it.
	 */
	completeTask: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const taskId = form.get('taskId')?.toString() ?? '';
		if (!taskId) return fail(400, { action: 'task', message: 'A task is required' });
		try {
			await completeTaskAsContractor(user.id, taskId);
		} catch (err) {
			if (err instanceof TaskNotFoundError)
				return fail(404, { action: 'task', message: err.message });
			throw err;
		}
		return { success: true };
	},

	reopenTask: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const taskId = form.get('taskId')?.toString() ?? '';
		if (!taskId) return fail(400, { action: 'task', message: 'A task is required' });
		try {
			await reopenTask(user.id, taskId);
		} catch (err) {
			if (err instanceof TaskNotFoundError)
				return fail(404, { action: 'task', message: err.message });
			throw err;
		}
		return { success: true };
	},

	/** Take the ask back. What happened — that it was asked — stays on the history. */
	deleteTask: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const taskId = form.get('taskId')?.toString() ?? '';
		if (!taskId) return fail(400, { action: 'task', message: 'A task is required' });
		try {
			await deleteTask(user.id, taskId);
		} catch (err) {
			if (err instanceof TaskNotFoundError)
				return fail(404, { action: 'task', message: err.message });
			throw err;
		}
		return { success: true };
	},

	unassignPerson: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const personId = form.get('personId')?.toString() ?? '';
		const kind = form.get('kind')?.toString() ?? '';
		if (!personId || !isPersonKind(kind))
			return fail(400, { action: 'crew', message: 'A person is required' });
		await unassignPerson(user.id, params.id, kind, personId);
		return { success: true };
	},

	deleteOrder: async ({ locals, params }) => {
		const user = requireContractor(locals);
		await deleteOrder(params.id, user.id);
		redirect(303, '/contractor/orders');
	}
});
