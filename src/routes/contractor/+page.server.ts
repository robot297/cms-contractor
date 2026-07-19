import { fail, redirect } from '@sveltejs/kit';
import { isContractorOrderState } from '$lib/crm';
import {
	createInvite,
	createOrder,
	deleteInvite,
	deleteOrder,
	listContractorOrders,
	listCustomers,
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
	const [orders, customers, notifications, invites] = await Promise.all([
		listContractorOrders(user.id),
		listCustomers(user.id),
		listNotifications(user.id),
		listInvites(user.id)
	]);
	return { orders, customers, notifications, invites, userName: user.name };
};

export const actions: Actions = {
	createOrder: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const customerId = form.get('customerId')?.toString() ?? '';
		if (!customerId) return fail(400, { message: 'Pick a customer for the order' });
		await createOrder(user.id, { customerId });
		return { success: true };
	},

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

	sendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const customerId = form.get('customerId')?.toString() ?? '';
		if (!customerId) return fail(400, { message: 'A customer is required' });
		await createInvite(user.id, customerId);
		return { success: true };
	},

	deleteOrder: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await deleteOrder(form.get('orderId')?.toString() ?? '', user.id);
		return { success: true };
	},

	resendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await resendInvite(form.get('inviteId')?.toString() ?? '', user.id);
		return { success: true };
	},

	deleteInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await deleteInvite(form.get('inviteId')?.toString() ?? '', user.id);
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
	}
};
