import { redirect } from '@sveltejs/kit';
import {
	deleteInvite,
	listContractorOrders,
	listInvites,
	listNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	resendInvite,
	revokeInvite
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
	// Only the due-follow-up count is shown here; the list lives on /contractor/orders.
	const dueCount = orders.filter((o) => o.followUpDue).length;
	return { dueCount, notifications, invites, userName: user.name };
};

export const actions: Actions = {
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
