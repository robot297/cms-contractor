import { error, fail, redirect } from '@sveltejs/kit';
import { getPortalOrder, type PortalSubject } from '$lib/server/crm.server';
import {
	DocumentAlreadyReadError,
	DocumentWriteForbiddenError,
	listDocuments,
	uploadDocuments,
	viewerFromLocals,
	withdrawDocument,
	type UploadInput
} from '$lib/server/documents.server';
import {
	EmptyMessageError,
	getThread,
	markThreadRead,
	sendMessage,
	ThreadForbiddenError
} from '$lib/server/messaging.server';
import { completeTaskAsCustomer, TaskNotFoundError } from '$lib/server/tasks.server';
import { listReviewLinks } from '$lib/server/reviews.server';
import type { Actions, PageServerLoad } from './$types';

/** The portal's subject for this request, and whether it is an impersonated view. */
function portalSubject(locals: App.Locals): { subject: PortalSubject; viewing: boolean } {
	if (!locals.user) redirect(302, '/login');
	if (locals.viewAs) {
		return { subject: { kind: 'customer', customerId: locals.viewAs.customerId }, viewing: true };
	}
	if (locals.user.role !== 'customer') redirect(302, '/');
	return { subject: { kind: 'user', userId: locals.user.id }, viewing: false };
}

/**
 * Read the picked files off a multi-file upload, pairing each with the name the
 * customer gave it.
 *
 * The two fields are index-aligned because the confirm step appends them in
 * lockstep, so a removed file takes its name with it. Only the stem is theirs to
 * set — the extension comes from the uploaded file, so a rename can never leave a
 * document that won't open.
 */
async function pickedFiles(form: FormData): Promise<UploadInput[]> {
	const files = form.getAll('file');
	const stems = form.getAll('filename');
	const out: UploadInput[] = [];
	for (const [i, entry] of files.entries()) {
		if (!(entry instanceof File) || entry.size === 0) continue;
		const stem = stems[i]?.toString().trim();
		const dot = entry.name.lastIndexOf('.');
		const ext = dot > 0 ? entry.name.slice(dot) : '';
		out.push({
			// Sanitizing is `uploadDocuments`' job, not this route's — that is the
			// point of there being one upload path.
			filename: stem ? stem + ext : entry.name,
			mimeType: entry.type,
			size: entry.size,
			data: Buffer.from(await entry.arrayBuffer())
		});
	}
	return out;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const { subject, viewing } = portalSubject(locals);

	// Scoped to the subject, so another customer's order is a 404 rather than a
	// redirect — the portal should not confirm the order exists at all.
	const order = await getPortalOrder(subject, params.id);
	if (!order) error(404, 'Project not found');

	// Under view-as there is no customer-side reader, so the thread is read
	// without marking anything: a developer looking must not clear a real
	// customer's unread state.
	const viewer = { role: 'customer' as const, userId: locals.user!.id };
	const thread = viewing
		? ((await getThread(params.id, { role: 'contractor', userId: locals.user!.id })) ?? [])
		: ((await getThread(params.id, viewer)) ?? []);
	// Counted BEFORE marking read, which is the only moment it can be counted: the
	// next line is what makes them read. The page previously counted every
	// contractor message instead, so "3 from Dana" was the size of the whole
	// conversation and said "3" forever.
	const unreadReplies = thread.filter(
		(m) => m.authorRole === 'contractor' && !m.readByCustomerAt
	).length;
	// Whether THEY owe an answer — the contractor spoke last. Survives reading, so
	// the prompt is still there when they come back to the page having meant to
	// reply and not done it. Cleared by replying, and by nothing else.
	const owesReply = thread.at(-1)?.authorRole === 'contractor';
	if (!viewing) await markThreadRead(params.id, viewer);

	// Documents come through the shared module, which scopes a customer to their
	// own uploads — the same rule the download endpoint applies, rather than a
	// second copy of it living here.
	const documents = await listDocuments(viewerFromLocals(locals)!, params.id);

	// Where this contractor can be reviewed — loaded ONLY for a finished job.
	//
	// Not a display condition: an unfinished job must not carry the links to the
	// browser at all. A review ask that appears mid-job is worse than no ask,
	// and "we send it but hide it" is one CSS mistake away from doing exactly
	// that. Nothing is queried on the other nine states.
	//
	// Read unguarded by billing on purpose: a lapsed contractor cannot ADD a link
	// (that check is in reviews.server.ts) but the ones already there keep
	// working, because nothing about lapsing may reach a customer — ADR-0005.
	const reviewLinks =
		order.customerVisibleState === 'Completed' ? await listReviewLinks(order.contractorId) : [];

	return { order, thread, documents, viewing, unreadReplies, owesReply, reviewLinks };
};

export const actions: Actions = {
	/**
	 * "Done" on something the contractor asked for.
	 *
	 * The only write a customer may make to a Task, and deliberately: a Task is an
	 * ask FROM the contractor, so a customer who could author or edit one would be
	 * filing work against somebody else's business. Scoped by the SESSION rather
	 * than by an order id in the form — `completeTaskAsCustomer` resolves the task
	 * through this user's own customer record, so a task id belonging to someone
	 * else is a 404 rather than a write.
	 *
	 * Refused under view-as for the same reason a message is: ticking it off would
	 * record the customer as having done something they have not. See ADR-0008.
	 */
	completeTask: async ({ request, locals }) => {
		const { viewing } = portalSubject(locals);
		if (viewing) {
			return fail(403, {
				message: 'Read-only: you are viewing this portal as the customer, not as them.'
			});
		}
		const form = await request.formData();
		const taskId = form.get('taskId')?.toString() ?? '';
		if (!taskId) return fail(400, { message: 'A task is required' });
		try {
			await completeTaskAsCustomer(locals.user!.id, taskId);
		} catch (err) {
			if (err instanceof TaskNotFoundError) return fail(404, { message: err.message });
			throw err;
		}
		return { success: true };
	},

	send: async ({ request, locals, params }) => {
		const { viewing } = portalSubject(locals);
		// Every write is refused in the impersonated view: a message stored here
		// would claim a customer said something they did not. See ADR-0008.
		if (viewing) {
			return fail(403, {
				message: 'Read-only: you are viewing this portal as the customer, not as them.'
			});
		}

		const form = await request.formData();
		const body = form.get('body')?.toString() ?? '';
		// Which quick action was used. Normalized server-side, so an unknown value
		// files as `general` rather than refusing the message.
		const topic = form.get('topic')?.toString() ?? 'general';
		try {
			await sendMessage(params.id, { role: 'customer', userId: locals.user!.id }, body, topic);
		} catch (err) {
			if (err instanceof EmptyMessageError) return fail(400, { message: err.message });
			if (err instanceof ThreadForbiddenError) error(404, 'Project not found');
			throw err;
		}
		return { success: true };
	},

	/**
	 * Documents the customer sends up to their contractor. Not billing-guarded:
	 * a customer write never depends on their contractor's subscription
	 * (docs/adr/0005-lapsing-never-reaches-customers.md).
	 *
	 * Validation is `uploadDocuments`' job and happens per file, so one refused
	 * file does not cost the rest of the batch. What comes back is reported per
	 * file rather than collapsed into a single "something went wrong".
	 */
	upload: async ({ request, locals, params }) => {
		const { viewing } = portalSubject(locals);
		if (viewing) {
			return fail(403, {
				upload: true,
				message: 'Read-only: you are viewing this portal as the customer, not as them.'
			});
		}

		const form = await request.formData();
		const files = await pickedFiles(form);
		if (files.length === 0) {
			return fail(400, { upload: true, message: 'Choose a file to send.' });
		}

		const outcomes = await uploadDocuments(viewerFromLocals(locals)!, params.id, files);
		const refused = outcomes.some((o) => !o.ok);
		const message = uploadSummary(outcomes);
		// Everything refused is a failure; anything stored is a success that still
		// says what was left behind. Reported either way, and by name.
		if (!outcomes.some((o) => o.ok)) {
			return fail(400, { upload: true, refused: true, message });
		}
		return { success: true, upload: true, refused, message };
	},

	/**
	 * Taking back something they sent — but only until the contractor has read it.
	 * A document that has been seen is a record of what was exchanged, not a
	 * draft, so the refusal says so rather than the control quietly vanishing.
	 */
	withdraw: async ({ request, locals }) => {
		const { viewing } = portalSubject(locals);
		if (viewing) {
			return fail(403, {
				upload: true,
				message: 'Read-only: you are viewing this portal as the customer, not as them.'
			});
		}
		const form = await request.formData();
		const documentId = form.get('documentId')?.toString() ?? '';
		if (!documentId) return fail(400, { upload: true, message: 'Which document?' });
		try {
			await withdrawDocument(viewerFromLocals(locals)!, documentId);
		} catch (err) {
			if (err instanceof DocumentAlreadyReadError || err instanceof DocumentWriteForbiddenError) {
				return fail(403, { upload: true, message: err.message });
			}
			throw err;
		}
		return { success: true };
	}
};

/** "3 sent · roof-survey.tiff was an unsupported type" — both halves, always. */
function uploadSummary(outcomes: { ok: boolean; filename: string; reason?: string }[]): string {
	const sent = outcomes.filter((o) => o.ok).length;
	const refused = outcomes.filter((o) => !o.ok);
	const parts: string[] = [];
	if (sent > 0) parts.push(`${sent} sent`);
	for (const r of refused) parts.push(`${r.filename} was ${r.reason}`);
	return parts.join(' · ');
}
