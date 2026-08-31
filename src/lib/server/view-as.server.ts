import { and, eq, isNull } from 'drizzle-orm';
import { ENV } from 'varlock/env';
import type { Cookies } from '@sveltejs/kit';
import { db } from './db';
import { customer, order } from './db/schema';
import { DEV_CUSTOMER_LOGIN } from './dev-login.server';

/**
 * Development-only "view as customer".
 *
 * The customer portal is the one surface that cannot be reached from a dev login:
 * seeing it means holding a customer-role account bound to a real customer row.
 * That friction is why it stayed unfinished. This lets a contractor open one of
 * their OWN customers' portals in the same session.
 *
 * Three properties make it safe enough to exist:
 *
 *  1. The signed-in user's role is never touched. A user holds exactly one global
 *     role (docs/adr/0002-one-role-per-user.md); faking a customer by mutating
 *     `session.user.role` would corrupt that invariant in the session store.
 *  2. Ownership is re-read from the database on every request, never trusted from
 *     the cookie — so archiving or losing a customer revokes it immediately.
 *  3. Every write is refused while it is active. See ADR-0008.
 *
 * Off unless explicitly enabled, and when off the cookie is CLEARED rather than
 * ignored: a build that ships with the flag off must behave as if the feature was
 * never there, even for a browser holding a stale selection.
 */

/** The cookie holding the impersonated customer id. */
export const VIEW_AS_COOKIE = 'dev_view_as';

export type ViewAs = { customerId: string; customerName: string };

/**
 * Read through varlock's typed ENV like the other dev flags. The flag must be
 * declared in .env.schema: varlock treats undeclared vars as sensitive, and its
 * leak scanner then flags the value "true" wherever it appears in a response.
 *
 * Stringified before comparing because varlock coerces an UNQUOTED `FLAG=true`
 * in a .env file to a real boolean, while `FLAG="true"` stays a string. A bare
 * `=== 'true'` therefore silently ignores half the ways you'd write it, and the
 * feature just doesn't appear with no error to explain why. Only the exact word
 * "true" enables it either way — `1`, `yes` and `TRUE` remain off.
 */
export function isViewAsEnabled(): boolean {
	return String(ENV.CUSTOMER_PORTAL_DEV_TOOLS) === 'true';
}

/** Drop the selection cookie. Used on exit, and whenever the flag is off. */
export function clearViewAsCookie(cookies: Cookies): void {
	cookies.delete(VIEW_AS_COOKIE, { path: '/' });
}

/** Set the selection cookie. Host-only, http-only, and lax — it is not a session. */
export function setViewAsCookie(cookies: Cookies, customerId: string): void {
	cookies.set(VIEW_AS_COOKIE, customerId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// Deliberately short: a dev affordance should not outlive the afternoon.
		maxAge: 60 * 60 * 8
	});
}

/**
 * Whether this contractor owns this customer. The single ownership question the
 * whole feature turns on, asked against the database on every request.
 */
export async function ownsCustomer(
	contractorId: string,
	customerId: string
): Promise<ViewAs | null> {
	const [row] = await db
		.select({ customerId: customer.id, customerName: customer.name })
		.from(customer)
		.where(and(eq(customer.id, customerId), eq(customer.contractorId, contractorId)))
		.limit(1);
	return row ?? null;
}

/**
 * What to do with a request's view-as cookie, decided before any database work.
 *
 * - `none`  — nothing selected; leave the request alone.
 * - `clear` — refuse AND delete the cookie. Every refusal clears, so a stale
 *             selection can never survive the flag being turned off.
 * - `check` — the caller may proceed to the ownership lookup.
 *
 * Pure, so the guard's decision tree is testable without a database — which is
 * where a mistake would hand one contractor another's customer.
 */
export function viewAsDecision(
	selected: string | undefined,
	enabled: boolean,
	user: { id: string; role: string } | undefined
): 'none' | 'clear' | 'check' {
	if (!selected) return 'none';
	if (!enabled) return 'clear';
	// Only a contractor can view as their own customer. Anyone else holding this
	// cookie — including a real customer — gets it taken away.
	if (!user || user.role !== 'contractor') return 'clear';
	return 'check';
}

/**
 * Resolve the active view-as selection for a request, or null.
 *
 * Returns null — and clears the cookie — when the flag is off, so a stale
 * selection cannot survive the feature being turned off.
 */
export async function resolveViewAs(
	cookies: Cookies,
	user: { id: string; role: string } | undefined
): Promise<ViewAs | null> {
	const selected = cookies.get(VIEW_AS_COOKIE);
	const decision = viewAsDecision(selected, isViewAsEnabled(), user);
	if (decision === 'none') return null;
	if (decision === 'clear') {
		clearViewAsCookie(cookies);
		return null;
	}

	// Re-read on every request, never trusted from the cookie, so a customer
	// archived or reassigned mid-session drops out immediately.
	const owned = await ownsCustomer(user!.id, selected!);
	if (!owned) {
		clearViewAsCookie(cookies);
		return null;
	}
	return owned;
}

/**
 * Whether this customer record has this order, so the switcher can land on the
 * SAME job rather than on the portal root.
 *
 * Seeing both sides of one order is the entire point of the switch; dumping you
 * at the root and making you find it again is most of the friction it exists to
 * remove. Checked rather than assumed, because a contractor can be looking at an
 * order belonging to a different customer entirely — in which case the caller
 * falls back to the root instead of handing over a 404.
 */
export async function portalHasOrder(customerId: string, orderId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: order.id })
		.from(order)
		.where(and(eq(order.id, orderId), eq(order.customerId, customerId), isNull(order.deletedAt)))
		.limit(1);
	return !!row;
}

/**
 * The seeded dev customer belonging to this contractor, if there is one.
 *
 * The switch is one button rather than a customer picker: the point is to reach
 * the portal, not to choose whose portal. `SEED_DEV_LOGIN` provisions this record
 * along with a real customer login, so the same portal is reachable either by
 * switching here or by signing in as it. Null — and therefore no button — when
 * the seeder has not run for this contractor.
 */
export function findDevCustomer(
	contractorId: string
): Promise<{ id: string; name: string } | undefined> {
	return db.query.customer.findFirst({
		where: and(
			eq(customer.contractorId, contractorId),
			eq(customer.email, DEV_CUSTOMER_LOGIN.email),
			isNull(customer.archivedAt)
		),
		columns: { id: true, name: true }
	});
}
