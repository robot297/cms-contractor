import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { customer, order, user } from '$lib/server/db/schema';
import { DEV_CUSTOMER_LOGIN, DEV_LOGIN, isDevLoginEnabled } from '$lib/server/dev-login.server';
import { clearViewAsCookie, isViewAsEnabled } from '$lib/server/view-as.server';
import type { RequestHandler } from './$types';

/**
 * Development-only: swap the real session between the two seeded logins.
 *
 * This is the other half of the switch. `view-as` answers "does this render
 * right" without leaving the contractor's session; this answers "does the
 * customer's own session actually work" — real auth, real role, writes enabled —
 * which impersonation deliberately cannot, because every write is refused there
 * (ADR-0008).
 *
 * It is NOT a general "become another user" primitive, and the shape is what
 * keeps it from becoming one:
 *
 *  - It only ever targets the two accounts `SEED_DEV_LOGIN` provisions. The
 *    target is chosen from a two-value enum, never from a user id in the
 *    request, so there is no input that could name a third account.
 *  - It signs in through the ordinary password path with the seeded password.
 *    It mints nothing and forges nothing: the session it produces is exactly the
 *    session typing those credentials into the login form produces, and it grants
 *    no access that knowing the (public, hard-coded) password would not.
 *  - It needs BOTH dev flags. `SEED_DEV_LOGIN` because without it these accounts
 *    do not exist, and `CUSTOMER_PORTAL_DEV_TOOLS` because this is the same
 *    affordance as the switch beside it and should die with the same flag.
 *  - Refusals are 404, like its sibling: a 403 confirms the route is deployed.
 */
const TARGETS = {
	contractor: { login: DEV_LOGIN, home: '/contractor' },
	customer: { login: DEV_CUSTOMER_LOGIN, home: '/customer' }
} as const;

/**
 * Whether the seeded customer login can see this order, for the same-job landing.
 *
 * The user id is read back from the database by the seeded email rather than
 * from the session we just created — a `Set-Cookie` on a response is not a
 * `Cookie` on a request, so the new session cannot be introspected here. The
 * email is the same join the rest of the dev tooling uses.
 */
async function customerSeesOrder(orderId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: order.id })
		.from(order)
		.innerJoin(customer, eq(order.customerId, customer.id))
		.innerJoin(user, eq(customer.userId, user.id))
		.where(
			and(eq(order.id, orderId), eq(user.email, DEV_CUSTOMER_LOGIN.email), isNull(order.deletedAt))
		)
		.limit(1);
	return !!row;
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!isDevLoginEnabled() || !isViewAsEnabled()) error(404, 'Not found');

	const form = await request.formData();
	const as = form.get('as')?.toString() ?? '';
	if (as !== 'contractor' && as !== 'customer') error(404, 'Not found');
	const target = TARGETS[as];
	const orderId = form.get('orderId')?.toString() ?? '';

	// A real session swap must not leave an impersonation cookie behind: viewing
	// as a customer while signed in AS that customer is a state with no meaning,
	// and the portal would pick the cookie's subject over the session's.
	clearViewAsCookie(cookies);

	const signIn = await auth.api.signInEmail({
		body: { email: target.login.email, password: target.login.password },
		asResponse: true
	});
	// Most likely cause is the seeder never having run on this database. Nothing
	// to say about it that is not also a hint that the route exists.
	if (!signIn.ok) error(404, 'Not found');

	// Forward Better Auth's own Set-Cookie headers onto the redirect, so the
	// session is established by exactly the mechanism a normal sign-in uses.
	// `getSetCookie()` rather than `get('set-cookie')`: there can be more than
	// one, and reading it as a single header silently keeps only the first.
	const headers = new Headers();
	for (const cookie of signIn.headers.getSetCookie()) headers.append('set-cookie', cookie);

	let location: string = target.home;
	if (orderId) {
		if (as === 'contractor') location = `/contractor/orders/${orderId}`;
		else if (await customerSeesOrder(orderId)) location = `/customer/orders/${orderId}`;
	}
	headers.set('location', location);
	// 303 so the browser follows with a GET rather than re-posting this form.
	return new Response(null, { status: 303, headers });
};
