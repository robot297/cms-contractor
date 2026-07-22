import { fail, redirect } from '@sveltejs/kit';
import { validateFeedback } from '$lib/crm';
import { isSupportConfigured, submitFeedback, SupportError } from '$lib/server/support.server';
import type { Actions, PageServerLoad } from './$types';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = ({ locals }) => {
	requireContractor(locals);
	return { configured: isSupportConfigured() };
};

export const actions: Actions = {
	submit: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const parsed = validateFeedback({
			type: form.get('type')?.toString(),
			title: form.get('title')?.toString(),
			detail: form.get('detail')?.toString()
		});
		if (!parsed.ok) return fail(400, { field: parsed.field, message: parsed.message });

		try {
			const issue = await submitFeedback(parsed.value, { name: user.name, email: user.email });
			return {
				success: true,
				issueUrl: issue.url,
				issueNumber: issue.number,
				type: parsed.value.type
			};
		} catch (error) {
			if (error instanceof SupportError) return fail(502, { message: error.message });
			throw error;
		}
	}
};
