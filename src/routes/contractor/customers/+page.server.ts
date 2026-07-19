import { fail, redirect } from '@sveltejs/kit';
import { validateCustomerContact } from '$lib/crm';
import {
	archiveCustomer,
	createCustomer,
	createInvite,
	CustomerEmailLockedError,
	DuplicateCustomerEmailError,
	editCustomer,
	listCustomers
} from '$lib/server/crm.server';
import type { Actions, PageServerLoad } from './$types';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/customer');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireContractor(locals);
	// Load the full directory; search is filtered live on the client.
	const customers = await listCustomers(user.id);
	return { customers, userName: user.name };
};

export const actions: Actions = {
	addCustomer: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const contact = validateCustomerContact({
			name: form.get('name')?.toString(),
			email: form.get('email')?.toString(),
			phone: form.get('phone')?.toString(),
			address: form.get('address')?.toString(),
			notes: form.get('notes')?.toString(),
			tags: form.get('tags')?.toString()
		});
		if (!contact.ok)
			return fail(400, { action: 'add', field: contact.field, message: contact.message });
		try {
			await createCustomer(user.id, contact.value);
		} catch (error) {
			if (error instanceof DuplicateCustomerEmailError)
				return fail(400, { action: 'add', field: 'email', message: error.message });
			throw error;
		}
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
			notes: form.get('notes')?.toString(),
			tags: form.get('tags')?.toString()
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
	}
};
