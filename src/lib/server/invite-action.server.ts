import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { createInvite, InviteStillOpenError, resendInvite, revokeInvite } from './crm.server';

/**
 * The one portal-invite action, shared by every contractor surface that offers to
 * invite a customer from the contact panel (dashboard, orders list, order detail,
 * customers directory).
 *
 * It lives here so the one-open-invite rule and the resend-vs-create branch can't
 * drift between pages. Each page re-exports it under `actions.sendInvite`, inside
 * its existing `withBillingErrors` wrapper (`createInvite` asserts write access).
 *
 * Fields: `customerId` (required), and an optional `inviteId` — present only when
 * re-sending an expired invite, in which case the existing invite is refreshed
 * rather than a second one created.
 */
function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export async function sendInviteAction({ request, locals }: RequestEvent) {
	const user = requireContractor(locals);
	const form = await request.formData();
	const customerId = form.get('customerId')?.toString() ?? '';
	if (!customerId) return fail(400, { action: 'invite', message: 'A customer is required' });
	const inviteId = form.get('inviteId')?.toString();
	try {
		if (inviteId) await resendInvite(inviteId, user.id);
		else await createInvite(user.id, customerId);
	} catch (err) {
		// One open invite at a time — surface the block as a plain message, since
		// nothing actually went wrong.
		if (err instanceof InviteStillOpenError) {
			return fail(409, {
				action: 'invite',
				message: `An invite is already open — you can send another after it expires on ${err.expiresAt.toLocaleDateString()}.`
			});
		}
		throw err;
	}
	return { action: 'invite' as const, sent: true, resent: Boolean(inviteId) };
}

/**
 * Withdraw a pending invite — the "changed my mind / wrong address" counterpart to
 * sending one. Shared for the same reason `sendInviteAction` is. Reads `inviteId`;
 * `revokeInvite` re-checks the invite belongs to this contractor.
 */
export async function revokeInviteAction({ request, locals }: RequestEvent) {
	const user = requireContractor(locals);
	const form = await request.formData();
	const inviteId = form.get('inviteId')?.toString() ?? '';
	if (!inviteId) return fail(400, { action: 'invite', message: 'An invite is required' });
	await revokeInvite(inviteId, user.id);
	return { action: 'invite' as const, revoked: true };
}
