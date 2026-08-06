import { fail, redirect } from '@sveltejs/kit';
import { validateCustomerContact } from '$lib/crm';
import {
	archiveCustomer,
	createCustomer,
	createInvite,
	CustomerEmailLockedError,
	deleteInvite,
	DuplicateCustomerEmailError,
	editCustomer,
	InvalidAvatarError,
	listCustomers,
	listInvites,
	resendInvite,
	revokeInvite,
	setCustomerAvatar
} from '$lib/server/crm.server';
import type { Actions, PageServerLoad } from './$types';
import { withBillingErrors } from '$lib/server/billing.server';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireContractor(locals);
	// Load the full directory; search is filtered live on the client.
	const [customers, invites] = await Promise.all([listCustomers(user.id), listInvites(user.id)]);
	return { customers, invites, userName: user.name };
};

// Wrapped so a billing refusal from any guarded write returns a 402 the form
// can render, rather than a 500. See withBillingErrors.
export const actions: Actions = withBillingErrors({
	addCustomer: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const contact = validateCustomerContact({
			name: form.get('name')?.toString(),
			email: form.get('email')?.toString(),
			phone: form.get('phone')?.toString(),
			address: form.get('address')?.toString(),
			city: form.get('city')?.toString(),
			state: form.get('state')?.toString(),
			postalCode: form.get('postalCode')?.toString(),
			notes: form.get('notes')?.toString(),
			preferredContact: form.get('preferredContact')?.toString()
		});
		if (!contact.ok)
			return fail(400, { action: 'add', field: contact.field, message: contact.message });
		// `next=order` comes from the "Add & create order" button: the contractor is
		// adding this customer *in order to* book work for them, so hand them straight
		// to the new-order form with the customer already chosen rather than making
		// them find it again.
		const next = form.get('next')?.toString();
		let created;
		try {
			created = await createCustomer(user.id, contact.value);
		} catch (error) {
			if (error instanceof DuplicateCustomerEmailError)
				return fail(400, { action: 'add', field: 'email', message: error.message });
			throw error;
		}
		if (next === 'order') redirect(303, `/contractor/orders?customer=${created.id}`);
		return { success: true };
	},

	editCustomer: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString() ?? '';
		if (!id) return fail(400, { action: 'edit', message: 'Customer is required' });
		const contact = validateCustomerContact({
			name: form.get('name')?.toString(),
			email: form.get('email')?.toString(),
			phone: form.get('phone')?.toString(),
			address: form.get('address')?.toString(),
			city: form.get('city')?.toString(),
			state: form.get('state')?.toString(),
			postalCode: form.get('postalCode')?.toString(),
			notes: form.get('notes')?.toString(),
			preferredContact: form.get('preferredContact')?.toString()
		});
		if (!contact.ok)
			return fail(400, { action: 'edit', id, field: contact.field, message: contact.message });
		try {
			await editCustomer(user.id, id, contact.value);
		} catch (error) {
			if (error instanceof DuplicateCustomerEmailError)
				return fail(400, { action: 'edit', id, field: 'email', message: error.message });
			if (error instanceof CustomerEmailLockedError)
				return fail(400, { action: 'edit', id, field: 'email', message: error.message });
			throw error;
		}
		return { success: true };
	},

	archiveCustomer: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString() ?? '';
		if (!id) return fail(400, { action: 'archive', message: 'Customer is required' });
		await archiveCustomer(user.id, id);
		return { success: true };
	},

	sendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString() ?? '';
		if (!id) return fail(400, { action: 'invite', message: 'Customer is required' });
		await createInvite(user.id, id);
		return { success: true };
	},

	resendInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await resendInvite(form.get('inviteId')?.toString() ?? '', user.id);
		return { success: true };
	},

	revokeInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await revokeInvite(form.get('inviteId')?.toString() ?? '', user.id);
		return { success: true };
	},

	deleteInvite: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await deleteInvite(form.get('inviteId')?.toString() ?? '', user.id);
		return { success: true };
	},

	setAvatar: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString() ?? '';
		const avatar = form.get('avatar')?.toString() ?? '';
		if (!id) return fail(400, { action: 'avatar', message: 'Customer is required' });
		try {
			await setCustomerAvatar(user.id, id, avatar || null);
		} catch (error) {
			if (error instanceof InvalidAvatarError)
				return fail(400, { action: 'avatar', id, message: error.message });
			throw error;
		}
		return { success: true };
	}
});
