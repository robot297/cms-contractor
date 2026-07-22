import { error, fail, redirect } from '@sveltejs/kit';
import {
	MAX_ATTACHMENT_BYTES,
	formatBytes,
	isAllowedAttachmentType
} from '$lib/crm';
import {
	addSubcontractorAttachment,
	addSubcontractorNote,
	GuestWriteForbiddenError,
	subcontractorOrderView
} from '$lib/server/subcontractor.server';
import type { Actions, PageServerLoad } from './$types';

function requireSubcontractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'subcontractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireSubcontractor(locals);
	// Tier-scoped: for a Guest, the customer contact block is redacted server-side
	// (never present in this payload). Null when the sub isn't assigned to it.
	const view = await subcontractorOrderView(user.id, params.id);
	if (!view) error(404, 'Job not found');
	return { view };
};

export const actions: Actions = {
	addNote: async ({ request, locals, params }) => {
		const user = requireSubcontractor(locals);
		const form = await request.formData();
		const note = form.get('note')?.toString().trim() ?? '';
		if (!note) return fail(400, { message: 'Note cannot be empty' });
		try {
			await addSubcontractorNote(user.id, params.id, note);
		} catch (err) {
			if (err instanceof GuestWriteForbiddenError) return fail(403, { message: err.message });
			throw err;
		}
		return { success: true };
	},

	uploadPhoto: async ({ request, locals, params }) => {
		const user = requireSubcontractor(locals);
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { message: 'Choose a photo to upload' });
		if (file.size > MAX_ATTACHMENT_BYTES)
			return fail(400, { message: `File is too large (max ${formatBytes(MAX_ATTACHMENT_BYTES)})` });
		if (!isAllowedAttachmentType(file.type))
			return fail(400, { message: 'Unsupported file type (images or PDF only)' });
		const data = Buffer.from(await file.arrayBuffer());
		try {
			await addSubcontractorAttachment(user.id, params.id, {
				filename: file.name,
				mimeType: file.type,
				size: file.size,
				data
			});
		} catch (err) {
			if (err instanceof GuestWriteForbiddenError) return fail(403, { message: err.message });
			throw err;
		}
		return { success: true };
	}
};
