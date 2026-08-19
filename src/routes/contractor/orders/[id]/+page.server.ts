import { error, fail, redirect } from '@sveltejs/kit';
import {
	isContractorOrderState,
	isSnoozePreset,
	parseDateInput,
	parseDollarsToCents,
	parseTags
} from '$lib/crm';
import {
	addOrderNote,
	cancelOrder,
	completeOrder,
	createInvite,
	InviteStillOpenError,
	portalStanding,
	resendInvite,
	deleteOrder,
	getOrderDetail,
	setFollowUp,
	setOrderTags,
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
import {
	assignSubcontractor,
	listOrderSubcontractors,
	listSubcontractors,
	unassignSubcontractor
} from '$lib/server/subcontractor.server';
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

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireContractor(locals);
	const detail = await getOrderDetail(params.id, user.id);
	if (!detail) error(404, 'Order not found');
	const [assignedSubs, roster] = await Promise.all([
		listOrderSubcontractors(user.id, params.id),
		listSubcontractors(user.id)
	]);
	const assignedIds = new Set(assignedSubs.map((s) => s.id));

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
		assignedSubs,
		// Subs not yet on this job, offered in the assign picker.
		availableSubs: roster.filter((s) => !assignedIds.has(s.id)),
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

		let invoiceEmail: 'sent' | 'skipped' | null = null;
		if (sendInvoice) {
			const detail = await getOrderDetail(params.id, user.id);
			invoiceEmail = detail?.order.customerEmail
				? await sendFinalInvoiceEmail(
						{ id: user.id, name: user.name, email: user.email },
						{
							id: params.id,
							projectName: detail.order.projectName,
							customerName: detail.order.customerName,
							customerEmail: detail.order.customerEmail
						},
						{ amountCents, notes }
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

	setTags: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await setOrderTags(params.id, user.id, parseTags(form.get('tags')?.toString() ?? ''));
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

	/** What a document is, in the contractor's words, plus how they file it. */
	updateDocument: async ({ request, locals }) => {
		requireContractor(locals);
		const form = await request.formData();
		const documentId = form.get('documentId')?.toString() ?? '';
		if (!documentId) return fail(400, { message: 'A document is required' });
		await updateDocument(viewerFromLocals(locals)!, documentId, {
			note: form.get('note')?.toString() ?? '',
			tags: form.get('tags')?.toString() ?? ''
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

	deleteOrder: async ({ locals, params }) => {
		const user = requireContractor(locals);
		await deleteOrder(params.id, user.id);
		redirect(303, '/contractor/orders');
	}
});
