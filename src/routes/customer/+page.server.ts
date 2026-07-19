import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { addCustomerRequest, getCustomerPortal, linkCustomerByEmail } from '$lib/server/crm.server';
import type { Actions, PageServerLoad } from './$types';

function requireCustomer(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'customer') redirect(302, '/contractor');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireCustomer(locals);
	// Attach any orders/invites created for this email before signup.
	await linkCustomerByEmail(user.id, user.email);
	const portal = await getCustomerPortal(user.id, user.email);
	return { ...portal, userName: user.name };
};

const REQUEST_TYPES = new Set(['question', 'service', 'issue']);

export const actions: Actions = {
	request: async ({ request, locals }) => {
		const user = requireCustomer(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		const type = form.get('type')?.toString() ?? '';
		const detail = form.get('detail')?.toString().trim() ?? '';
		if (!orderId || !REQUEST_TYPES.has(type)) return fail(400, { message: 'Invalid request' });
		if (!detail) return fail(400, { message: 'Please add a short message' });
		await addCustomerRequest(orderId, { id: user.id, email: user.email }, type as 'question' | 'service' | 'issue', detail);
		return { success: true };
	},

	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		redirect(302, '/login');
	}
};
