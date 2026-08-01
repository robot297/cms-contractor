import { error, fail, redirect } from '@sveltejs/kit';
import {
	MAX_ATTACHMENT_BYTES,
	formatBytes,
	isAllowedAttachmentType,
	isContractorOrderState,
	isSnoozePreset,
	parseTags
} from '$lib/crm';
import {
	addAttachment,
	addOrderNote,
	createInvite,
	deleteAttachment,
	deleteOrder,
	getOrderDetail,
	setFollowUp,
	setOrderTags,
	snoozeFollowUp,
	updateOrderState
} from '$lib/server/crm.server';
import {
	assignSubcontractor,
	listOrderSubcontractors,
	listSubcontractors,
	unassignSubcontractor
} from '$lib/server/subcontractor.server';
import type { Actions, PageServerLoad } from './$types';
import { withBillingErrors } from '$lib/server/billing.server';

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
	return {
		...detail,
		assignedSubs,
		// Subs not yet on this job, offered in the assign picker.
		availableSubs: roster.filter((s) => !assignedIds.has(s.id))
	};
};

// Wrapped so a billing refusal from any guarded write returns a 402 the form
// can render, rather than a 500. See withBillingErrors.
export const actions: Actions = withBillingErrors({
	updateStatus: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const state = form.get('state')?.toString() ?? '';
		const note = form.get('note')?.toString() || undefined;
		if (!isContractorOrderState(state)) return fail(400, { message: 'Invalid state' });
		await updateOrderState(params.id, user.id, state, note);
		return { success: true };
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
		const date = raw ? new Date(raw) : null;
		if (date && Number.isNaN(date.getTime())) return fail(400, { message: 'Invalid date' });
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

	uploadAttachment: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { message: 'Choose a file to upload' });
		if (file.size > MAX_ATTACHMENT_BYTES)
			return fail(400, { message: `File is too large (max ${formatBytes(MAX_ATTACHMENT_BYTES)})` });
		if (!isAllowedAttachmentType(file.type))
			return fail(400, { message: 'Unsupported file type (images or PDF only)' });
		const data = Buffer.from(await file.arrayBuffer());
		await addAttachment(params.id, user.id, {
			filename: file.name,
			mimeType: file.type,
			size: file.size,
			data
		});
		return { success: true };
	},

	deleteAttachment: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const attachmentId = form.get('attachmentId')?.toString() ?? '';
		if (!attachmentId) return fail(400, { message: 'Attachment is required' });
		await deleteAttachment(attachmentId, user.id);
		return { success: true };
	},

	sendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const customerId = form.get('customerId')?.toString() ?? '';
		if (!customerId) return fail(400, { message: 'A customer is required' });
		await createInvite(user.id, customerId);
		return { success: true };
	},

	assignSub: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const subcontractorId = form.get('subcontractorId')?.toString() ?? '';
		if (!subcontractorId) return fail(400, { message: 'A subcontractor is required' });
		await assignSubcontractor(user.id, params.id, subcontractorId);
		return { success: true };
	},

	unassignSub: async ({ request, locals, params }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const subcontractorId = form.get('subcontractorId')?.toString() ?? '';
		if (!subcontractorId) return fail(400, { message: 'A subcontractor is required' });
		await unassignSubcontractor(user.id, params.id, subcontractorId);
		return { success: true };
	},

	deleteOrder: async ({ locals, params }) => {
		const user = requireContractor(locals);
		await deleteOrder(params.id, user.id);
		redirect(303, '/contractor/orders');
	}
});
