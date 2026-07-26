import { fail, redirect } from '@sveltejs/kit';
import { formatLocation, isOrderIcon, isSnoozePreset } from '$lib/crm';
import { listContractorOrders, setOrderIcon, snoozeFollowUp } from '$lib/server/crm.server';
import type { Actions, PageServerLoad } from './$types';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireContractor(locals);
	const orders = await listContractorOrders(user.id);
	// Orders whose next follow-up is due, soonest first — the dashboard's default tab.
	const dueOrders = orders
		.filter((o) => o.followUpDue)
		.sort((a, b) => {
			const av = a.nextFollowUpAt ? new Date(a.nextFollowUpAt).getTime() : Infinity;
			const bv = b.nextFollowUpAt ? new Date(b.nextFollowUpAt).getTime() : Infinity;
			return av - bv;
		})
		.map((o) => ({
			id: o.id,
			customerName: o.customerName,
			customerEmail: o.customerEmail,
			customerPhone: o.customerPhone,
			customerLocation: formatLocation(o.customerAddress),
			customerPreferredContact: o.customerPreferredContact,
			projectName: o.projectName,
			projectType: o.projectType,
			icon: o.icon,
			nextFollowUpAt: o.nextFollowUpAt
		}));
	return { dueOrders, userName: user.name };
};

export const actions: Actions = {
	setOrderIcon: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		const raw = form.get('icon')?.toString() ?? '';
		if (!orderId) return fail(400, { message: 'Order is required' });
		// Empty clears the icon; any other value must be one of the fixed set.
		if (raw !== '' && !isOrderIcon(raw)) return fail(400, { message: 'Unknown icon' });
		await setOrderIcon(orderId, user.id, raw === '' ? null : raw);
		return { success: true };
	},

	// Snooze a due follow-up straight from the dashboard, so it drops off the list.
	snoozeFollowUp: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		const preset = form.get('preset')?.toString() ?? '';
		if (!orderId) return fail(400, { message: 'Order is required' });
		if (!isSnoozePreset(preset)) return fail(400, { message: 'Invalid snooze' });
		await snoozeFollowUp(orderId, user.id, preset);
		return { success: true };
	}
};
