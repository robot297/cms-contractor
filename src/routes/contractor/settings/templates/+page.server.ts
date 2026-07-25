import { fail, redirect } from '@sveltejs/kit';
import {
	createEmailTemplate,
	deleteEmailTemplate,
	getContractorSettings,
	listEmailTemplates,
	reorderEmailTemplates,
	saveContractorSettings,
	updateEmailTemplate
} from '$lib/server/templates.server';
import type { Actions, PageServerLoad } from './$types';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireContractor(locals);
	const [templates, settings] = await Promise.all([
		listEmailTemplates(user.id),
		getContractorSettings(user.id)
	]);
	return {
		templates: templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body })),
		signature: settings.signature,
		businessName: settings.businessName
	};
};

/** Pull + trim a template's fields from a submitted form. Name is required. */
function readTemplate(form: FormData): { name: string; subject: string; body: string } | null {
	const name = (form.get('name')?.toString() ?? '').trim();
	if (!name) return null;
	return {
		name,
		subject: (form.get('subject')?.toString() ?? '').trim(),
		body: (form.get('body')?.toString() ?? '').trim()
	};
}

export const actions: Actions = {
	createTemplate: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const input = readTemplate(await request.formData());
		if (!input) return fail(400, { action: 'create', message: 'A template name is required' });
		await createEmailTemplate(user.id, input);
		return { success: true };
	},

	updateTemplate: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString();
		const input = readTemplate(form);
		if (!id) return fail(400, { action: 'update', message: 'Missing template' });
		if (!input) return fail(400, { action: 'update', id, message: 'A template name is required' });
		await updateEmailTemplate(id, user.id, input);
		return { success: true };
	},

	deleteTemplate: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const id = (await request.formData()).get('id')?.toString();
		if (!id) return fail(400, { action: 'delete', message: 'Missing template' });
		await deleteEmailTemplate(id, user.id);
		return { success: true };
	},

	reorderTemplate: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString();
		const direction = form.get('direction')?.toString();
		if (!id || (direction !== 'up' && direction !== 'down'))
			return fail(400, { action: 'reorder', message: 'Bad reorder request' });

		const ids = (await listEmailTemplates(user.id)).map((t) => t.id);
		const from = ids.indexOf(id);
		if (from === -1) return fail(404, { action: 'reorder', message: 'Template not found' });
		const to = direction === 'up' ? from - 1 : from + 1;
		if (to < 0 || to >= ids.length) return { success: true }; // already at an edge
		[ids[from], ids[to]] = [ids[to], ids[from]];
		await reorderEmailTemplates(user.id, ids);
		return { success: true };
	},

	saveSignature: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await saveContractorSettings(user.id, {
			businessName: (form.get('businessName')?.toString() ?? '').trim(),
			signature: (form.get('signature')?.toString() ?? '').trim()
		});
		return { success: true, saved: 'signature' };
	}
};
