import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { isContractorOrderState } from '$lib/crm';
import {
	createInvite,
	createOrder,
	listContractorOrders,
	listInvites,
	listNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	resendInvite,
	revokeInvite,
	updateOrderState
} from '$lib/server/crm.server';
import type { Actions, PageServerLoad } from './$types';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/customer');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireContractor(locals);
	const [orders, notifications, invites] = await Promise.all([
		listContractorOrders(user.id),
		listNotifications(user.id),
		listInvites(user.id)
	]);
	return { orders, notifications, invites, userName: user.name };
};

export const actions: Actions = {
	quickUpdate: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		const state = form.get('state')?.toString() ?? '';
		const note = form.get('note')?.toString() || undefined;
		if (!isContractorOrderState(state)) return fail(400, { message: 'Invalid state' });
		await updateOrderState(orderId, user.id, state, note);
		return { success: true };
	},

	createOrder: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const customerName = form.get('customerName')?.toString().trim() ?? '';
		const customerEmail = form.get('customerEmail')?.toString().trim() ?? '';
		if (!customerName || !customerEmail) return fail(400, { message: 'Name and email are required' });
		await createOrder(user.id, { customerName, customerEmail });
		return { success: true };
	},

	sendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		const customerEmail = form.get('customerEmail')?.toString().trim() ?? '';
		if (!orderId || !customerEmail) return fail(400, { message: 'Order and email are required' });
		await createInvite(user.id, orderId, customerEmail);
		return { success: true };
	},

	resendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await resendInvite(form.get('inviteId')?.toString() ?? '', user.id);
		return { success: true };
	},

	revokeInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await revokeInvite(form.get('inviteId')?.toString() ?? '', user.id);
		return { success: true };
	},

	markRead: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await markNotificationRead(form.get('id')?.toString() ?? '', user.id);
		return { success: true };
	},

	markAllRead: async ({ locals }) => {
		const user = requireContractor(locals);
		await markAllNotificationsRead(user.id);
		return { success: true };
	},

	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		redirect(302, '/login');
	}
};
