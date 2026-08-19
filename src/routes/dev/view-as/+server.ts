import { error, redirect } from '@sveltejs/kit';
import {
	clearViewAsCookie,
	isViewAsEnabled,
	ownsCustomer,
	portalHasOrder,
	setViewAsCookie
} from '$lib/server/view-as.server';
import type { RequestHandler } from './$types';

/**
 * Enter and leave the development-only customer-portal view.
 *
 * POST-only and its own route because the control lives in the layout, and a
 * layout cannot host form actions. Every refusal here is a 404 rather than a
 * 403: with the flag off this route should be indistinguishable from one that
 * was never deployed.
 *
 * An optional `orderId` lands the switch on the SAME job on the other side,
 * which is the whole reason to flip. It is a hint, never a grant — the ownership
 * check below is what decides, and an order the destination cannot see falls
 * back to the root rather than becoming a 404.
 */
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	if (!isViewAsEnabled()) {
		// Clear on the way out too — the flag going off must not leave a live
		// selection sitting in someone's browser.
		clearViewAsCookie(cookies);
		error(404, 'Not found');
	}
	if (locals.user?.role !== 'contractor') error(404, 'Not found');

	const form = await request.formData();
	const customerId = form.get('customerId')?.toString() ?? '';
	const orderId = form.get('orderId')?.toString() ?? '';

	// No customer id means "exit" — back to the contractor's own surface, on the
	// same job where that is where they were.
	if (!customerId) {
		clearViewAsCookie(cookies);
		redirect(303, orderId ? `/contractor/orders/${orderId}` : '/contractor');
	}

	// Ownership is the whole guard. Checked here on entry and again on every
	// request by resolveViewAs, so a customer archived mid-session drops out.
	const owned = await ownsCustomer(locals.user.id, customerId);
	if (!owned) error(404, 'Not found');

	setViewAsCookie(cookies, owned.customerId);
	const sameJob = orderId && (await portalHasOrder(owned.customerId, orderId));
	redirect(303, sameJob ? `/customer/orders/${orderId}` : '/customer');
};
