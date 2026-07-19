import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import {
	addCustomerRequest,
	bindCustomerByEmail,
	bindInviteToken,
	CustomerAlreadyLinkedError,
	getCustomerPortal
} from '$lib/server/crm.server';
import type { Actions, PageServerLoad } from './$types';

function requireCustomer(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'customer') redirect(302, '/contractor');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireCustomer(locals);
	// Prefer token binding (honors the contractor's explicit invite over a coincidental
	// email match); fall back to linking any customer records that match this email.
	const token = url.searchParams.get('token');
	if (token) {
		try {
			await bindInviteToken(user.id, token);
		} catch (error) {
			if (!(error instanceof CustomerAlreadyLinkedError)) throw error;
		}
	}
	await bindCustomerByEmail(user.id, user.email);
	const portal = await getCustomerPortal(user.id);
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
		await addCustomerRequest(
			orderId,
			{ id: user.id },
			type as 'question' | 'service' | 'issue',
			detail
		);
		return { success: true };
	},

	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		redirect(302, '/login');
	}
};
