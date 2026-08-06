import { fail, redirect } from '@sveltejs/kit';
import { isSubcontractorTier, validateSubcontractorContact } from '$lib/crm';
import {
	archiveSubcontractor,
	createSubcontractor,
	createSubcontractorInvite,
	DuplicateSubcontractorEmailError,
	editSubcontractor,
	listSubcontractorInvites,
	listSubcontractorOrders,
	listSubcontractors,
	resendSubcontractorInvite,
	revokeSubcontractorInvite,
	setSubcontractorAvatar,
	setSubcontractorTier,
	subcontractorLinkStatus,
	SubcontractorEmailLockedError
} from '$lib/server/subcontractor.server';
import { InvalidAvatarError } from '$lib/server/crm.server';
import type { Actions, PageServerLoad } from './$types';
import { withBillingErrors } from '$lib/server/billing.server';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

/** Pull the shared, validated profile fields off a form submission. */
function readProfile(form: FormData) {
	return {
		name: form.get('name')?.toString(),
		email: form.get('email')?.toString(),
		phone: form.get('phone')?.toString(),
		address: form.get('address')?.toString(),
		company: form.get('company')?.toString(),
		trade: form.get('trade')?.toString(),
		tier: form.get('tier')?.toString(),
		licenseNumber: form.get('licenseNumber')?.toString(),
		insuranceCarrier: form.get('insuranceCarrier')?.toString(),
		insuranceExpiresAt: form.get('insuranceExpiresAt')?.toString(),
		notes: form.get('notes')?.toString(),
		tags: form.get('tags')?.toString()
	};
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireContractor(locals);
	const search = url.searchParams.get('q') ?? '';
	const [subs, invites] = await Promise.all([
		listSubcontractors(user.id, search),
		listSubcontractorInvites(user.id)
	]);
	const pendingBySubId = new Set(
		invites
			.filter((i) => i.status === 'pending' && i.subcontractorId)
			.map((i) => i.subcontractorId!)
	);
	const inviteIdBySubId = new Map(
		invites
			.filter((i) => i.status === 'pending' && i.subcontractorId)
			.map((i) => [i.subcontractorId!, i.id])
	);
	// Enrich each sub with its link status + assigned orders (for the profile).
	const roster = await Promise.all(
		subs.map(async (s) => ({
			...s,
			status: subcontractorLinkStatus(s, pendingBySubId.has(s.id)),
			pendingInviteId: inviteIdBySubId.get(s.id) ?? null,
			assignedOrders: await listSubcontractorOrders(user.id, s.id)
		}))
	);
	return {
		subcontractors: roster,
		search,
		// Open the add form on arrival when there is nothing else to do here: an
		// empty roster, or a deliberate `?new` from the getting-started guide. The
		// search-miss case is excluded — that page isn't empty, it's filtered.
		openAdd: url.searchParams.has('new') || (roster.length === 0 && search === '')
	};
};

// Wrapped so a billing refusal from any guarded write returns a 402 the form
// can render, rather than a 500. See withBillingErrors.
export const actions: Actions = withBillingErrors({
	addSubcontractor: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const parsed = validateSubcontractorContact(readProfile(form));
		if (!parsed.ok)
			return fail(400, { action: 'add', field: parsed.field, message: parsed.message });
		try {
			await createSubcontractor(user.id, parsed.value);
		} catch (error) {
			if (error instanceof DuplicateSubcontractorEmailError)
				return fail(400, { action: 'add', field: 'email', message: error.message });
			throw error;
		}
		return { success: true };
	},

	editSubcontractor: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString() ?? '';
		if (!id) return fail(400, { action: 'edit', message: 'Subcontractor is required' });
		const parsed = validateSubcontractorContact(readProfile(form));
		if (!parsed.ok)
			return fail(400, { action: 'edit', id, field: parsed.field, message: parsed.message });
		try {
			await editSubcontractor(user.id, id, parsed.value);
		} catch (error) {
			if (error instanceof DuplicateSubcontractorEmailError)
				return fail(400, { action: 'edit', id, field: 'email', message: error.message });
			if (error instanceof SubcontractorEmailLockedError)
				return fail(400, { action: 'edit', id, field: 'email', message: error.message });
			throw error;
		}
		return { success: true };
	},

	setTier: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString() ?? '';
		const tier = form.get('tier')?.toString() ?? '';
		if (!id || !isSubcontractorTier(tier))
			return fail(400, { action: 'tier', message: 'Invalid tier' });
		await setSubcontractorTier(user.id, id, tier);
		return { success: true };
	},

	archiveSubcontractor: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString() ?? '';
		if (!id) return fail(400, { action: 'archive', message: 'Subcontractor is required' });
		await archiveSubcontractor(user.id, id);
		return { success: true };
	},

	sendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString() ?? '';
		if (!id) return fail(400, { action: 'invite', message: 'Subcontractor is required' });
		await createSubcontractorInvite(user.id, id);
		return { success: true };
	},

	resendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const inviteId = form.get('inviteId')?.toString() ?? '';
		if (!inviteId) return fail(400, { action: 'invite', message: 'Invite is required' });
		await resendSubcontractorInvite(inviteId, user.id);
		return { success: true };
	},

	revokeInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const inviteId = form.get('inviteId')?.toString() ?? '';
		if (!inviteId) return fail(400, { action: 'invite', message: 'Invite is required' });
		await revokeSubcontractorInvite(inviteId, user.id);
		return { success: true };
	},

	setAvatar: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString() ?? '';
		const avatar = form.get('avatar')?.toString() ?? '';
		if (!id) return fail(400, { action: 'avatar', message: 'Subcontractor is required' });
		try {
			await setSubcontractorAvatar(user.id, id, avatar || null);
		} catch (error) {
			if (error instanceof InvalidAvatarError)
				return fail(400, { action: 'avatar', id, message: error.message });
			throw error;
		}
		return { success: true };
	}
});
