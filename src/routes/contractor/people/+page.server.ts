import { fail, redirect } from '@sveltejs/kit';
import {
	isActiveState,
	validateCustomerContact,
	validateSubcontractorContact,
	type ContractorOrderState
} from '$lib/crm';
import { isPersonRole, type PersonRole } from '$lib/people';
import { workerSchema } from '$lib/worker';
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
	listInvites,
	resendInvite,
	revokeInvite,
	setCustomerAvatar
} from '$lib/server/crm.server';
import {
	archiveWorker,
	createWorker,
	DuplicateWorkerEmailError,
	importWorkers,
	listWorkerJobs,
	setWorkerAvatar,
	updateWorker,
	WorkerNotFoundError
} from '$lib/server/worker.server';
import {
	archiveSubcontractor,
	createSubcontractor,
	DuplicateSubcontractorEmailError,
	importSubcontractors,
	setSubcontractorAvatar
} from '$lib/server/subcontractor.server';
import { listDirectory } from '$lib/server/people.server';
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

/** One job a customer owns, reduced to what the Work tab links to it with. */
type CustomerJobView = {
	id: string;
	projectName: string | null;
	/** The contractor-facing state, so the row says where the job stands. */
	state: string;
	active: boolean;
};

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

/**
 * The one directory: everyone this contractor knows, whatever they are to them.
 *
 * Customers, crew and subcontractors are three tables because they carry three
 * different capabilities — an Order points at a customer, an Assignment at a
 * crew or subcontractor record, and only a subcontractor holds a tier, insurance
 * or a portal login of their own. What they are NOT is three kinds of person,
 * and this page is the surface that stopped pretending otherwise: `listDirectory`
 * matches records by email within the contractor and hands back one row per
 * human, carrying whichever records they hold. See `mergeDirectory`.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const user = requireContractor(locals);
	// Load the full directory; search is filtered live on the client.
	const [people, invites, orders] = await Promise.all([
		listDirectory(user.id),
		listInvites(user.id),
		listContractorOrders(user.id)
	]);
	const customers = people
		.map((p) => p.customer)
		.filter((c): c is NonNullable<typeof c> => c !== null);

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

	// `person.jobs` carries the COUNTS — one grouped query, cheap enough to ride on
	// every directory row. This carries the jobs themselves, for the Work tab to
	// link to one by one. Folded out of the `orders` list already in hand rather
	// than queried again, and keyed by customer so the tab is a lookup.
	//
	// Every customer, not just linked ones: `conversations` above is limited to the
	// portal-linked because a thread needs a portal, but a job to open exists
	// whether or not its customer ever signed in.
	const customerJobs: Record<string, CustomerJobView[]> = {};
	for (const o of orders) {
		if (!o.customerId) continue;
		(customerJobs[o.customerId] ??= []).push({
			id: o.id,
			projectName: o.projectName,
			state: o.state,
			active: isActiveState(o.state as ContractorOrderState)
		});
	}

	return { people, invites, conversations, customerJobs, userName: user.name };
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

	/**
	 * A photo is a fact about the PERSON, so it is written to every record they
	 * hold. Three tables carry an avatar column and the directory shows one face;
	 * setting only the record the click happened to come from is how the same
	 * person ends up with two different photos depending on which list you opened.
	 */
	setAvatar: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const avatar = form.get('avatar')?.toString() ?? '';
		const customerId = form.get('customerId')?.toString() ?? '';
		const crewId = form.get('crewId')?.toString() ?? '';
		const subId = form.get('subId')?.toString() ?? '';
		if (!customerId && !crewId && !subId)
			return fail(400, { action: 'avatar', message: 'A person is required' });
		try {
			if (customerId) await setCustomerAvatar(user.id, customerId, avatar || null);
			if (crewId) await setWorkerAvatar(user.id, crewId, avatar || null);
			if (subId) await setSubcontractorAvatar(user.id, subId, avatar || null);
		} catch (error) {
			if (error instanceof InvalidAvatarError)
				return fail(400, { action: 'avatar', message: error.message });
			throw error;
		}
		return { success: true };
	},

	// ------------------------------------------------------------------- Crew
	// Crew are managed entirely here. A subcontractor's tier, insurance and portal
	// invite are capabilities crew do not have, so those stay one click deeper on
	// the subcontractor page rather than on every row of this one.

	addCrew: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const parsed = workerSchema.safeParse({
			name: form.get('name')?.toString() ?? '',
			email: form.get('email')?.toString() ?? '',
			phone: form.get('phone')?.toString() ?? '',
			role: form.get('role')?.toString() ?? '',
			company: form.get('company')?.toString() ?? '',
			notes: form.get('notes')?.toString() ?? ''
		});
		if (!parsed.success)
			return fail(400, {
				action: 'add',
				message: parsed.error.issues[0]?.message ?? 'Check the details'
			});
		try {
			await createWorker(user.id, parsed.data);
		} catch (err) {
			if (err instanceof DuplicateWorkerEmailError)
				return fail(400, { action: 'add', message: err.message });
			throw err;
		}
		return { success: true };
	},

	editCrew: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString() ?? '';
		if (!id) return fail(400, { action: 'edit', message: 'A person is required' });
		const parsed = workerSchema.safeParse({
			name: form.get('name')?.toString() ?? '',
			email: form.get('email')?.toString() ?? '',
			phone: form.get('phone')?.toString() ?? '',
			role: form.get('role')?.toString() ?? '',
			company: form.get('company')?.toString() ?? '',
			notes: form.get('notes')?.toString() ?? ''
		});
		if (!parsed.success)
			return fail(400, {
				action: 'edit',
				id,
				message: parsed.error.issues[0]?.message ?? 'Check the details'
			});
		try {
			await updateWorker(user.id, id, parsed.data);
		} catch (err) {
			if (err instanceof DuplicateWorkerEmailError)
				return fail(400, { action: 'edit', id, message: err.message });
			if (err instanceof WorkerNotFoundError)
				return fail(404, { action: 'edit', id, message: err.message });
			throw err;
		}
		return { success: true };
	},

	archiveCrew: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const id = (await request.formData()).get('id')?.toString() ?? '';
		if (!id) return fail(400, { message: 'A person is required' });
		try {
			await archiveWorker(user.id, id);
		} catch (err) {
			if (err instanceof WorkerNotFoundError) return fail(404, { message: err.message });
			throw err;
		}
		return { success: true };
	},

	/** Which jobs one crew member is on — loaded on demand when a row expands. */
	crewJobs: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const id = (await request.formData()).get('id')?.toString() ?? '';
		if (!id) return fail(400, { message: 'A person is required' });
		return { jobs: await listWorkerJobs(user.id, id) };
	},

	// ------------------------------------------------------------------ Roles
	//
	// What somebody IS to this contractor is a set, not a choice: the customer
	// whose deck you rebuilt can be the hand you call when you are short, and can
	// later set up on his own and be the firm you engage. Adding a role creates the
	// record that carries that capability, from the details already on file;
	// removing one archives it, which is what every other "delete" in this app
	// means — the record and its history survive, it just leaves the directory.

	addRole: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const role = form.get('role')?.toString();
		if (!isPersonRole(role)) return fail(400, { action: 'role', message: 'Unknown role' });
		const details = {
			name: form.get('name')?.toString() ?? '',
			email: form.get('email')?.toString() ?? '',
			phone: form.get('phone')?.toString() ?? '',
			company: form.get('company')?.toString() ?? ''
		};
		// What they do on site. Called `workRole` on the wire because `role` is
		// already taken by which role is being ADDED — two different senses of the
		// word that would otherwise collide in one form.
		const workRole = form.get('workRole')?.toString() ?? '';

		try {
			if (role === 'customer') {
				// A customer is identified by their email — it is the invite channel and
				// the uniqueness key — so this is the one role that cannot be added to
				// somebody the address book gave no address for.
				const contact = validateCustomerContact(details);
				if (!contact.ok)
					return fail(400, {
						action: 'role',
						role,
						field: contact.field,
						message: contact.message
					});
				await createCustomer(user.id, contact.value);
			} else if (role === 'crew') {
				const parsed = workerSchema.safeParse({ ...details, role: workRole, notes: '' });
				if (!parsed.success)
					return fail(400, {
						action: 'role',
						role,
						message: parsed.error.issues[0]?.message ?? 'Check the details'
					});
				await createWorker(user.id, parsed.data);
			} else {
				// Tier, trade and insurance are not in an address book and are not
				// guessed at here: the record starts at `guest` (least privilege) with
				// the rest blank, and is finished on the subcontractor page.
				const contact = validateSubcontractorContact({ ...details, trade: workRole });
				if (!contact.ok)
					return fail(400, {
						action: 'role',
						role,
						field: contact.field,
						message: contact.message
					});
				await createSubcontractor(user.id, contact.value);
			}
		} catch (err) {
			if (
				err instanceof DuplicateCustomerEmailError ||
				err instanceof DuplicateWorkerEmailError ||
				err instanceof DuplicateSubcontractorEmailError
			)
				return fail(400, { action: 'role', role, message: err.message });
			throw err;
		}
		return { success: true, action: 'role' as const, role };
	},

	removeRole: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const role = form.get('role')?.toString();
		const id = form.get('id')?.toString() ?? '';
		if (!isPersonRole(role) || !id)
			return fail(400, { action: 'role', message: 'A role is required' });
		try {
			if (role === 'customer') await archiveCustomer(user.id, id);
			else if (role === 'crew') await archiveWorker(user.id, id);
			else await archiveSubcontractor(user.id, id);
		} catch (err) {
			if (err instanceof WorkerNotFoundError) return fail(404, { message: err.message });
			throw err;
		}
		return { success: true, action: 'role' as const, role: role as PersonRole };
	},

	/**
	 * Bulk create from the contact-import review list.
	 *
	 * Each row says what it becomes, because an address book is a flat list of
	 * people and what any of them is to this contractor is not written in it.
	 * Customer is the default here — this is the directory a contractor fills from
	 * their phone when they start using the app, and most of those names are the
	 * people they work for.
	 */
	importPeople: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		let raw: unknown;
		try {
			raw = JSON.parse(form.get('contacts')?.toString() ?? '[]');
		} catch {
			return fail(400, { action: 'import', message: 'That import could not be read.' });
		}
		if (!Array.isArray(raw))
			return fail(400, { action: 'import', message: 'That import could not be read.' });
		if (raw.length > IMPORT_MAX)
			return fail(400, { action: 'import', message: `Up to ${IMPORT_MAX} contacts at a time.` });

		const customers = [];
		const crew = [];
		const subs = [];
		const rejected: { name: string; message: string }[] = [];
		for (const entry of raw) {
			const row = (entry ?? {}) as Record<string, unknown>;
			const str = (key: string) =>
				typeof row[key] === 'string' ? (row[key] as string) : undefined;
			const details = {
				name: str('name'),
				email: str('email'),
				phone: str('phone'),
				address: str('address'),
				city: str('city'),
				state: str('state'),
				postalCode: str('postalCode')
			};

			// A row that cannot be parsed is skipped rather than failing the batch — an
			// address book always has a few entries that are not people.
			if (row.kind === 'crew') {
				const parsed = workerSchema.safeParse({
					name: details.name ?? '',
					email: details.email ?? '',
					phone: details.phone ?? ''
				});
				if (parsed.success) crew.push(parsed.data);
				else
					rejected.push({ name: details.name || 'Unnamed contact', message: 'Check the details' });
				continue;
			}
			if (row.kind === 'sub') {
				const contact = validateSubcontractorContact({
					name: details.name ?? '',
					email: details.email ?? '',
					phone: details.phone ?? ''
				});
				if (contact.ok) subs.push(contact.value);
				else rejected.push({ name: details.name || 'Unnamed contact', message: contact.message });
				continue;
			}
			const contact = validateCustomerContact(details);
			if (contact.ok) customers.push(contact.value);
			else rejected.push({ name: details.name || 'Unnamed contact', message: contact.message });
		}
		if (customers.length === 0 && crew.length === 0 && subs.length === 0)
			return fail(400, {
				action: 'import',
				message: 'Nothing in that selection could be imported.'
			});

		// Sequential, not parallel: all three paths count against the same trial
		// capacity, and concurrent runs would each read the room the others are using.
		const a = await importCustomers(user.id, customers);
		const b = await importWorkers(user.id, crew);
		const c = await importSubcontractors(user.id, subs);
		return {
			action: 'import' as const,
			imported: a.imported + b.imported + c.imported,
			duplicates: a.duplicates + b.duplicates + c.duplicates,
			stoppedAt: a.stoppedAt ?? null,
			rejected: [...rejected, ...a.rejected, ...b.rejected, ...c.rejected]
		};
	}
});
