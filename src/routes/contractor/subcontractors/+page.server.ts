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
import { assertCanWrite, withBillingErrors } from '$lib/server/billing.server';
import { sendEmailAction } from '$lib/server/email-action.server';
import {
	extractIdFromImage,
	isIdScanDevToolsEnabled,
	isIdScanVisionConfigured
} from '$lib/server/id-scan.server';

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
		licenseExpiresAt: form.get('licenseExpiresAt')?.toString(),
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
		// What the scanner may offer. The barcode path is on-device and always
		// available; only reading a card that has no barcode needs a provider.
		idScan: {
			visionConfigured: isIdScanVisionConfigured(),
			devTools: isIdScanDevToolsEnabled()
		},
		// Open the add form on arrival ONLY when explicitly asked to — the `?new`
		// the getting-started guide links with.
		//
		// It used to open on an empty roster too, on the reasoning that there was
		// nothing else to do here. That is wrong: someone opening Subcontractors is
		// not necessarily trying to add one, and landing in a form nobody asked for
		// means the first thing you do on the page is dismiss it. The empty state
		// offers the button instead, which is the same journey with the decision
		// left where it belongs.
		openAdd: url.searchParams.has('new')
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

	/**
	 * Read a photographed card that has no barcode.
	 *
	 * Reads nothing and writes nothing — it turns an image into field values the
	 * contractor then reviews and saves through `addSubcontractor` /
	 * `editSubcontractor` like any typed entry. It is still behind the write
	 * guard: a lapsed contractor cannot save the result, so letting them spend a
	 * provider call producing it would only be a slower refusal.
	 *
	 * The image is not stored, and neither is the result — it goes back in the
	 * response and lives in the browser until the form is saved or dismissed.
	 */
	scanId: async ({ request, locals }) => {
		const user = requireContractor(locals);
		await assertCanWrite(user.id);
		const form = await request.formData();
		const image = form.get('image')?.toString() ?? '';
		if (!image) return fail(400, { action: 'scan', reason: 'invalid' });

		const result = await extractIdFromImage(image);
		if (!result.ok) return fail(422, { action: 'scan', reason: result.reason });
		return { success: true, scan: result.scan };
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
