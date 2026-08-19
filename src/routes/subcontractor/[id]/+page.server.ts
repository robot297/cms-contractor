import { error, fail, redirect } from '@sveltejs/kit';
import {
	addSubcontractorNote,
	GuestWriteForbiddenError,
	subcontractorOrderView
} from '$lib/server/subcontractor.server';
import {
	DocumentWriteForbiddenError,
	listDocuments,
	uploadDocuments,
	viewerFromLocals,
	type UploadInput
} from '$lib/server/documents.server';
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
	// Both Tiers read the Documents on a job they are assigned to. Only Trusted
	// may add one — the same rule `orderAccess` applies to the write path, rather
	// than a second copy of it living on this page.
	const documents = await listDocuments(viewerFromLocals(locals)!, params.id);
	return { view, documents };
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

	/**
	 * Job photos and files, through the same upload path as everyone else's.
	 * Never billing-guarded: a subcontractor's write is not a contractor's
	 * (docs/adr/0005-lapsing-never-reaches-customers.md).
	 */
	uploadDocuments: async ({ request, locals, params }) => {
		requireSubcontractor(locals);
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
		if (files.length === 0) return fail(400, { message: 'Choose a photo or file to upload' });

		try {
			const outcomes = await uploadDocuments(viewerFromLocals(locals)!, params.id, files);
			const stored = outcomes.filter((o) => o.ok).length;
			const message = [
				stored > 0 ? `${stored} uploaded` : '',
				...outcomes
					.filter((o) => !o.ok)
					.map((r) => `${r.filename} was ${'reason' in r ? r.reason : 'refused'}`)
			]
				.filter(Boolean)
				.join(' · ');
			if (stored === 0) return fail(400, { message });
			return { success: true, message };
		} catch (err) {
			// A Guest's Tier is what refuses this, exactly as it refuses a note.
			if (err instanceof DocumentWriteForbiddenError) return fail(403, { message: err.message });
			throw err;
		}
	}
};
