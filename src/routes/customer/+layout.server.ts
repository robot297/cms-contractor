import { redirect } from '@sveltejs/kit';
import {
	bindCustomerByEmail,
	bindInviteToken,
	CustomerAlreadyLinkedError,
	listPortalOrders,
	type PortalSubject
} from '$lib/server/crm.server';
import { awaitingReplyForCustomer } from '$lib/server/messaging.server';
import { isViewAsEnabled } from '$lib/server/view-as.server';
import { isDevLoginEnabled } from '$lib/server/dev-login.server';
import type { LayoutServerLoad } from './$types';

/**
 * The portal's one place for "who is this for, and what may they see".
 *
 * Invite binding runs here rather than on the index page so arriving at any
 * portal URL with a token still links the account — a contractor sends a link to
 * a specific order as often as to the portal root.
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) redirect(302, '/login');

	// Development view-as pins the portal to one customer record. `locals.user` is
	// still the contractor's own session; only the subject changes.
	const viewAs = locals.viewAs ?? null;
	if (!viewAs && user.role !== 'customer') redirect(302, '/');

	let bindError: string | null = null;
	if (!viewAs) {
		// Prefer token binding (honors the contractor's explicit invite over a
		// coincidental email match); fall back to linking records matching this email.
		const token = url.searchParams.get('token');
		if (token) {
			try {
				await bindInviteToken(user.id, token);
			} catch (error) {
				if (error instanceof CustomerAlreadyLinkedError) bindError = error.message;
				else throw error;
			}
		}
		if (!bindError) await bindCustomerByEmail(user.id, user.email);
	}

	const subject: PortalSubject = viewAs
		? { kind: 'customer', customerId: viewAs.customerId }
		: { kind: 'user', userId: user.id };

	const orders = await listPortalOrders(subject);
	// Projects where the contractor spoke last and the customer has not answered.
	// NOT unread: opening a project marks its thread read, so an unread badge
	// disappeared the moment they looked — including when they looked, meant to
	// reply, and got distracted. Under view-as there is nobody who owes a reply,
	// so the rail shows none rather than a real customer's obligations.
	const owed = viewAs ? [] : await awaitingReplyForCustomer(user.id);
	const owedByOrder = new Map(owed.map((o) => [o.orderId, o.pending]));

	return {
		viewAs,
		// The switcher is offered on this side too, so getting back is the same
		// control as getting here rather than a different one in a different place.
		devSignInEnabled: isViewAsEnabled() && isDevLoginEnabled(),
		bindError,
		userName: viewAs ? viewAs.customerName : user.name,
		awaitingReply: owed.length,
		active: orders
			.filter((o) => o.active)
			.map((o) => ({ ...o, unread: owedByOrder.get(o.id) ?? 0 })),
		past: orders.filter((o) => !o.active).map((o) => ({ ...o, unread: owedByOrder.get(o.id) ?? 0 }))
	};
};
