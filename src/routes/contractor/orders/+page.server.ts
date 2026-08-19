import { fail, redirect } from '@sveltejs/kit';
import { parseTags, validateOrderSetup } from '$lib/crm';
import {
	createOrder,
	listContractorOrders,
	listCustomers,
	listInvites
} from '$lib/server/crm.server';
import {
	awaitingReplyForContractor,
	EmptyMessageError,
	sendMessage,
	ThreadForbiddenError,
	threadsForOrders
} from '$lib/server/messaging.server';
import type { Actions, PageServerLoad } from './$types';
import { withBillingErrors } from '$lib/server/billing.server';
import { sendEmailAction } from '$lib/server/email-action.server';
import { revokeInviteAction, sendInviteAction } from '$lib/server/invite-action.server';

/** How much of each conversation the contact dialog carries. Rest is on the order. */
const THREAD_PREVIEW = 20;

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireContractor(locals);
	const [orders, customers, owed, invites] = await Promise.all([
		listContractorOrders(user.id),
		listCustomers(user.id),
		// Conversations where the customer spoke last — the at-a-glance signal that
		// one is waiting, without opening every job. Not "unread": opening an order
		// marks its thread read, so an unread badge cleared itself the moment you
		// looked, whether or not you answered.
		awaitingReplyForContractor(user.id),
		// The contractor's portal invites, so the contact dialog's Chat tab can offer
		// (or report) an invite for a customer who isn't linked yet.
		listInvites(user.id)
	]);
	const unread = Object.fromEntries(owed.map((o) => [o.orderId, o.pending]));

	// The conversation on each linked order, so the card's 💬 opens on the Chat tab
	// with what was actually said — the same panel the dashboard shows. Only linked
	// customers have a portal thread to deliver to, so only they need one loaded.
	const threadMap = await threadsForOrders(orders.filter((o) => o.customerLinked).map((o) => o.id));
	const threads: Record<
		string,
		{ id: string; authorRole: string; body: string; createdAt: Date }[]
	> = {};
	for (const [orderId, msgs] of threadMap) {
		threads[orderId] = msgs.slice(-THREAD_PREVIEW).map((m) => ({
			id: m.id,
			authorRole: m.authorRole,
			body: m.body,
			createdAt: m.createdAt
		}));
	}

	return {
		orders,
		customers,
		unread,
		threads,
		invites,
		// Optional deep-links: pre-select a customer, or open on the Due filter.
		presetCustomerId: url.searchParams.get('customer') ?? '',
		initialView: ((v): 'active' | 'completed' | 'cancelled' =>
			v === 'completed' || v === 'cancelled' ? v : 'active')(url.searchParams.get('view'))
	};
};

// Wrapped so a billing refusal from any guarded write returns a 402 the form
// can render, rather than a 500. See withBillingErrors.
export const actions: Actions = withBillingErrors({
	/**
	 * Sending a composed message. Shared by every surface that mounts the
	 * composer — the implementation lives in one file so the rule about when a
	 * send is recorded on a timeline can't drift between pages.
	 */
	sendEmail: sendEmailAction,

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

	/**
	 * Reply in the customer's portal from the list's contact dialog — the same
	 * action the dashboard and order workspace expose, so the Chat tab in the
	 * shared ContactPanel behaves identically here. The order id is a form field;
	 * `sendMessage` re-checks it belongs to this contractor.
	 */
	replyToCustomer: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		if (!orderId) return fail(400, { message: 'Order is required' });
		try {
			await sendMessage(
				orderId,
				{ role: 'contractor', userId: user.id },
				form.get('body')?.toString() ?? ''
			);
		} catch (err) {
			if (err instanceof EmptyMessageError) return fail(400, { message: err.message });
			if (err instanceof ThreadForbiddenError) return fail(404, { message: 'Order not found' });
			throw err;
		}
		return { success: true };
	},

	// Portal invite from the contact dialog's Chat tab, for a customer who isn't
	// linked yet. Shared with every other surface that mounts the contact panel.
	sendInvite: sendInviteAction,
	revokeInvite: revokeInviteAction
	// Notes and delete are edited from the order detail page.
});
