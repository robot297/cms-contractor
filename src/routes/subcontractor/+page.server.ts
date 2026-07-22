import { redirect } from '@sveltejs/kit';
import {
	bindSubcontractorByEmail,
	bindSubcontractorInviteToken,
	listAssignedOrdersForUser,
	RoleConflictError,
	SubcontractorAlreadyLinkedError
} from '$lib/server/subcontractor.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	if (!user) redirect(302, '/login');

	// Invite acceptance: bind by the invite token first (honors the contractor's
	// explicit invite over a coincidental email match), then fall back to email.
	// A clear collision message is surfaced instead of a silent empty portal.
	const token = url.searchParams.get('token');
	let bindError: string | null = null;
	if (token) {
		try {
			await bindSubcontractorInviteToken(user.id, token);
		} catch (error) {
			if (error instanceof RoleConflictError || error instanceof SubcontractorAlreadyLinkedError) {
				bindError = error.message;
			} else {
				throw error;
			}
		}
	}
	if (!bindError) await bindSubcontractorByEmail(user.id, user.email);

	const assigned = await listAssignedOrdersForUser(user.id);
	if (!assigned) {
		// The user isn't linked to any subcontractor record. If acceptance was
		// refused, show why; otherwise route them to whatever home they do have.
		if (bindError) return { bindError, tier: null, orders: [], userName: user.name };
		redirect(302, '/');
	}

	return { bindError, tier: assigned.tier, orders: assigned.orders, userName: user.name };
};
