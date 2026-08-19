import { fail, redirect } from '@sveltejs/kit';
import { validateCustomerContact } from '$lib/crm';
import {
	archiveCustomer,
	createCustomer,
	CustomerEmailLockedError,
	deleteInvite,
	DuplicateCustomerEmailError,
	editCustomer,
	importCustomers,
	listContractorOrders,
	InvalidAvatarError,
	listCustomers,
	listInvites,
	resendInvite,
	revokeInvite,
	setCustomerAvatar
} from '$lib/server/crm.server';
import type { Actions, PageServerLoad } from './$types';
import { withBillingErrors } from '$lib/server/billing.server';
import {
	EmptyMessageError,
	sendMessage,
	ThreadForbiddenError,
	threadsForOrders
} from '$lib/server/messaging.server';
import { sendEmailAction } from '$lib/server/email-action.server';
import { sendInviteAction } from '$lib/server/invite-action.server';

/** Most contacts a single import request may carry. Mirrored in ContactImport. */
const IMPORT_MAX = 200;

/** How much of each conversation the directory carries. The rest is on the order. */
const THREAD_PREVIEW = 20;

type ConversationView = {
	orderId: string;
	projectName: string | null;
	thread: { id: string; authorRole: string; body: string; createdAt: Date }[];
};

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireContractor(locals);
	// Load the full directory; search is filtered live on the client.
	const [customers, invites, orders] = await Promise.all([
		listCustomers(user.id),
		listInvites(user.id),
		listContractorOrders(user.id)
	]);

	// The directory offers the same four-channel panel as everywhere else, and
	// Chat needs an order to attach a message to — a thread belongs to a job, not
	// to a person. A customer with three jobs in flight therefore has three
	// conversations, and the panel lets the contractor pick which one.
	//
	// Threads are fetched only for LINKED customers: an unlinked one has no portal
	// to have said anything through, so loading their (empty) conversations would
	// be a query per row for nothing.
	const linked = new Set(customers.filter((c) => c.userId != null).map((c) => c.id));
	const chatOrders = orders.filter((o) => o.customerId != null && linked.has(o.customerId));
	const threads = await threadsForOrders(chatOrders.map((o) => o.id));

	const conversations: Record<string, ConversationView[]> = {};
	for (const o of chatOrders) {
		(conversations[o.customerId!] ??= []).push({
			orderId: o.id,
			projectName: o.projectName,
			// Newest first for the picker, but each thread reads oldest-first.
			thread: (threads.get(o.id) ?? []).slice(-THREAD_PREVIEW).map((m) => ({
				id: m.id,
				authorRole: m.authorRole,
				body: m.body,
				createdAt: m.createdAt
			}))
		});
	}

	return { customers, invites, conversations, userName: user.name };
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

	/**
	 * Reply in a customer's portal, from the directory. Same shape as the
	 * dashboard's: the order is a form field rather than a route param, and
	 * `sendMessage` re-checks that it belongs to this contractor.
	 */
	replyToCustomer: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		if (!orderId) return fail(400, { message: 'Order is required' });
		try {
			await sendMessage(
				orderId,
				{ role: 'contractor', userId: user.id },
				form.get('body')?.toString() ?? ''
			);
		} catch (err) {
			if (err instanceof EmptyMessageError) return fail(400, { message: err.message });
			if (err instanceof ThreadForbiddenError) return fail(404, { message: 'Order not found' });
			throw err;
		}
		return { success: true };
	},

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
		// `next=order` comes from the "Create an order for them next" checkbox on the
		// add form — an unticked checkbox submits nothing at all. The contractor is
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

	/**
	 * Bulk create from the contact-import review list.
	 *
	 * The payload is JSON rather than repeated form fields: it is a variable-length
	 * list of records the client has already reviewed, and flattening it into
	 * `contact[3][city]` keys would buy nothing. Every entry still goes through the
	 * same `validateCustomerContact` as a typed one — the client-side review is a
	 * convenience, never the check.
	 */
	importCustomers: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();

		let raw: unknown;
		try {
			raw = JSON.parse(form.get('contacts')?.toString() ?? '');
		} catch {
			return fail(400, { action: 'import', message: 'That import could not be read' });
		}
		if (!Array.isArray(raw) || raw.length === 0)
			return fail(400, { action: 'import', message: 'Choose at least one contact to import' });
		// A cap on one request, not on the feature: a phone book can run to
		// thousands, and a single action creating them one row at a time would sit
		// past any sensible request timeout. The picker limits selection to match.
		if (raw.length > IMPORT_MAX)
			return fail(400, {
				action: 'import',
				message: `Import up to ${IMPORT_MAX} contacts at a time`
			});

		const valid = [];
		const rejected: { name: string; message: string }[] = [];
		for (const entry of raw) {
			const row = (entry ?? {}) as Record<string, unknown>;
			const str = (key: string) =>
				typeof row[key] === 'string' ? (row[key] as string) : undefined;
			const contact = validateCustomerContact({
				name: str('name'),
				email: str('email'),
				phone: str('phone'),
				address: str('address'),
				city: str('city'),
				state: str('state'),
				postalCode: str('postalCode')
			});
			if (contact.ok) valid.push(contact.value);
			else rejected.push({ name: str('name') || 'Unnamed contact', message: contact.message });
		}

		const summary = await importCustomers(user.id, valid);
		return {
			action: 'import' as const,
			...summary,
			rejected: [...rejected, ...summary.rejected]
		};
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

	// Portal invite from the contact panel — the shared action reads `customerId`
	// and enforces the one-open-invite rule.
	sendInvite: sendInviteAction,

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
