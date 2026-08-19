import { redirect } from '@sveltejs/kit';
import { awaitingReplyForCustomer } from '$lib/server/messaging.server';
import type { PageServerLoad } from './$types';

/**
 * The portal root is a signpost, not a page. Everything it needs — the subject,
 * the order list, invite binding — was resolved by the layout, so this only picks
 * where to land.
 *
 * A project with an unanswered reply wins: the customer opened the portal
 * because someone got back to them, and landing on a different job means finding
 * the message themselves. Otherwise it is the most recently updated order,
 * preferring active work, and when there are none it falls through to the empty
 * state.
 *
 * Deliberately still a redirect rather than an inbox. A customer typically has
 * one live job; a list of one is a page that exists to be clicked through.
 */
export const load: PageServerLoad = async ({ parent, locals }) => {
	const { active, past, viewAs } = await parent();

	// Skipped under view-as: the developer looking is not the person who owes an
	// answer, and routing them by a real customer's obligations is misleading.
	if (!viewAs && locals.user) {
		const waiting = await awaitingReplyForCustomer(locals.user.id);
		if (waiting.length > 0) redirect(302, `/customer/orders/${waiting[0].orderId}`);
	}

	const landing = active[0] ?? past[0];
	if (landing) redirect(302, `/customer/orders/${landing.id}`);
	return {};
};
