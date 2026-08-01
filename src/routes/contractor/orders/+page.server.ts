import { fail, redirect } from '@sveltejs/kit';
import { parseTags, validateOrderSetup } from '$lib/crm';
import {
	addOrderNote,
	createInvite,
	createOrder,
	deleteOrder,
	listContractorOrders,
	listCustomers,
	listOrderNotes,
	type OrderNote
} from '$lib/server/crm.server';
import type { Actions, PageServerLoad } from './$types';
import { withBillingErrors } from '$lib/server/billing.server';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireContractor(locals);
	const [orders, customers, notes] = await Promise.all([
		listContractorOrders(user.id),
		listCustomers(user.id),
		listOrderNotes(user.id)
	]);
	// Group internal notes by order for per-card display.
	const notesByOrder: Record<string, OrderNote[]> = {};
	for (const note of notes) (notesByOrder[note.orderId] ??= []).push(note);
	return {
		orders,
		customers,
		notesByOrder,
		// Optional deep-links: pre-select a customer, or open on the Due filter.
		presetCustomerId: url.searchParams.get('customer') ?? '',
		initialView: ((v): 'active' | 'completed' | 'cancelled' =>
			v === 'completed' || v === 'cancelled' ? v : 'active')(url.searchParams.get('view'))
	};
};

// Wrapped so a billing refusal from any guarded write returns a 402 the form
// can render, rather than a 500. See withBillingErrors.
export const actions: Actions = withBillingErrors({
	createOrder: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const setup = validateOrderSetup({
			customerId: form.get('customerId')?.toString(),
			projectName: form.get('projectName')?.toString(),
			projectType: form.get('projectType')?.toString(),
			projectTypeOther: form.get('projectTypeOther')?.toString()
		});
		if (!setup.ok)
			return fail(400, { action: 'create', field: setup.field, message: setup.message });
		await createOrder(user.id, {
			...setup.value,
			tags: parseTags(form.get('tags')?.toString() ?? '')
		});
		return { success: true };
	},

	addNote: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		const note = form.get('note')?.toString().trim() ?? '';
		if (!orderId) return fail(400, { message: 'Order is required' });
		if (!note) return fail(400, { message: 'Note cannot be empty' });
		await addOrderNote(orderId, user.id, note);
		return { success: true };
	},

	deleteOrder: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await deleteOrder(form.get('orderId')?.toString() ?? '', user.id);
		return { success: true };
	},

	sendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const customerId = form.get('customerId')?.toString() ?? '';
		if (!customerId) return fail(400, { message: 'A customer is required' });
		await createInvite(user.id, customerId);
		return { success: true };
	}
});
