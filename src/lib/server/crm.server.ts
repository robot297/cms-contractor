import { and, desc, eq, gt, gte, isNull, lt, ne } from 'drizzle-orm';
import { db } from './db';
import {
	customer,
	customerInvite,
	lineItem,
	notification,
	order,
	payment,
	timelineEntry,
	user
} from './db/schema';
import {
	defaultFollowUp,
	customerStateLabel,
	getVisibleCustomerState,
	isCustomerActionState,
	isActiveState,
	isCustomerLinked,
	isFollowUpDue,
	isValidAvatarDataUrl,
	formatCents,
	normalizeEmail,
	normalizePreferredContact,
	paymentMethodLabel,
	snoozeDate,
	type ContractorOrderState,
	type PreferredContact,
	type SnoozePreset
} from '$lib/crm';
import {
	invoiceSummary,
	paymentKindLabel,
	type InvoiceSummary,
	type LineItem,
	type PaymentRecord
} from '$lib/invoice';
// Billing gate. Every contractor-initiated mutation below calls one of these
// before touching the database. It is deliberately NOT a single guard on the
// /contractor layout: a lapsed contractor must still be able to read everything
// they built. See docs/adr/0005-lapsing-never-reaches-customers.md.
import { assertCanCreate, assertCanWrite, isBillingError } from './billing.server';
import { listTasks, openTaskCounts } from './tasks.server';
import type { CustomerTaskView } from '$lib/tasks';
// A new order's first follow-up lands at the contractor's own interval, so
// creating one has to read their settings.
import { getContractorSettings } from './templates.server';
// ZIP → coordinates for the day's run. Cached per process; see geo.server.ts.

/** How long a customer invite / magic link stays valid. */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export type OrderRow = typeof order.$inferSelect;
export type CustomerRow = typeof customer.$inferSelect;
export type TimelineRow = typeof timelineEntry.$inferSelect;
export type NotificationRow = typeof notification.$inferSelect;
export type InviteRow = typeof customerInvite.$inferSelect;
export type PaymentRow = typeof payment.$inferSelect;
export type LineItemRow = typeof lineItem.$inferSelect;

export type ContractorOrderView = OrderRow & {
	customerName: string;
	customerEmail: string;
	customerPhone: string | null;
	customerAddress: string | null;
	customerCity: string | null;
	customerState: string | null;
	/** Where the job is, precisely enough to look up a forecast for it. */
	customerPostalCode: string | null;
	customerPreferredContact: PreferredContact;
	customerVisibleState: string;
	/** Whether a portal reply can reach them — see the note in toContractorView. */
	customerLinked: boolean;
	followUpDue: boolean;
};

/** Typed errors so route actions can render friendly messages. */
export class DuplicateCustomerEmailError extends Error {
	constructor() {
		super('You already have a customer with this email');
		this.name = 'DuplicateCustomerEmailError';
	}
}
export class CustomerEmailLockedError extends Error {
	constructor() {
		super('This customer has accepted an invite; their email can no longer be changed');
		this.name = 'CustomerEmailLockedError';
	}
}
export class CustomerAlreadyLinkedError extends Error {
	constructor() {
		super('This account is already linked to one of your customers');
		this.name = 'CustomerAlreadyLinkedError';
	}
}

function toContractorView(row: OrderRow, cust: CustomerRow | null): ContractorOrderView {
	return {
		...row,
		customerName: cust?.name ?? 'Unknown customer',
		customerEmail: cust?.email ?? '',
		customerPhone: cust?.phone ?? null,
		customerAddress: cust?.address ?? null,
		customerCity: cust?.city ?? null,
		customerState: cust?.state ?? null,
		customerPostalCode: cust?.postalCode ?? null,
		customerPreferredContact: normalizePreferredContact(cust?.preferredContact),
		customerVisibleState: getVisibleCustomerState(row.state as ContractorOrderState),
		// Whether there is a portal to deliver a reply to. A customer with no login
		// behind them can still be emailed or called — they just cannot be answered
		// in the thread, and a surface offering that would be lying.
		customerLinked: cust?.userId != null,
		followUpDue: isFollowUpDue(row.nextFollowUpAt)
	};
}

// ---------------------------------------------------------------- Customers

/** The contractor's own non-archived customers, optionally filtered by name/email. */
export async function listCustomers(contractorId: string, search?: string): Promise<CustomerRow[]> {
	const rows = await db
		.select()
		.from(customer)
		.where(and(eq(customer.contractorId, contractorId), isNull(customer.archivedAt)))
		.orderBy(desc(customer.updatedAt));
	const term = search?.trim().toLowerCase();
	if (!term) return rows;
	return rows.filter((c) => c.name.toLowerCase().includes(term) || c.email.includes(term));
}

/** Returns the customer only if it belongs to the given contractor. */
async function ownedCustomer(contractorId: string, id: string): Promise<CustomerRow | undefined> {
	const [row] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.id, id), eq(customer.contractorId, contractorId)))
		.limit(1);
	return row;
}

export type CustomerDetailsInput = {
	name: string;
	email: string;
	phone?: string | null;
	/** Street line only; city/state/postalCode are captured separately. */
	address?: string | null;
	city?: string | null;
	state?: string | null;
	postalCode?: string | null;
	notes?: string | null;
	preferredContact?: PreferredContact;
};

export async function createCustomer(
	contractorId: string,
	input: CustomerDetailsInput
): Promise<CustomerRow> {
	await assertCanCreate(contractorId, 'customer');
	const name = input.name.trim();
	const email = normalizeEmail(input.email);
	const [existing] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.contractorId, contractorId), eq(customer.email, email)))
		.limit(1);
	if (existing) throw new DuplicateCustomerEmailError();
	const [row] = await db
		.insert(customer)
		.values({
			contractorId,
			name,
			email,
			phone: input.phone ?? null,
			address: input.address ?? null,
			city: input.city ?? null,
			state: input.state ?? null,
			postalCode: input.postalCode ?? null,
			notes: input.notes ?? null,
			preferredContact: input.preferredContact ?? 'email'
		})
		.returning();
	return row;
}

/** What a bulk import did, per contact and in total. */
export type ImportSummary = {
	imported: number;
	/** Contacts already in the directory under the same email. */
	duplicates: number;
	/** Contacts that couldn't be created, and why — named so they can be found. */
	rejected: { name: string; message: string }[];
	/**
	 * Set when a trial limit stopped the run partway. Everything before it was
	 * still created: an import that rolled back forty good contacts because the
	 * forty-first hit a cap would be a worse outcome than a partial one it
	 * reports honestly.
	 */
	stoppedAt: string | null;
};

/**
 * Create many customers in one go, from the contact-import review list.
 *
 * Deliberately not a transaction, and deliberately tolerant. The input is
 * somebody's address book: a few entries in it will be malformed, already
 * present, or beyond what a trial allows, and none of those is a reason to
 * refuse the rest. Every contact is attempted on its own and the outcome is
 * reported back per row.
 */
export async function importCustomers(
	contractorId: string,
	contacts: CustomerDetailsInput[]
): Promise<ImportSummary> {
	const summary: ImportSummary = { imported: 0, duplicates: 0, rejected: [], stoppedAt: null };
	for (const contact of contacts) {
		try {
			await createCustomer(contractorId, contact);
			summary.imported++;
		} catch (err) {
			if (err instanceof DuplicateCustomerEmailError) {
				summary.duplicates++;
				continue;
			}
			// A billing refusal applies to every remaining contact too, so stop
			// rather than grinding through the rest collecting the same message.
			if (isBillingError(err)) {
				summary.stoppedAt = err.message;
				break;
			}
			summary.rejected.push({
				name: contact.name,
				message: err instanceof Error ? err.message : 'Could not be saved'
			});
		}
	}
	return summary;
}

export async function editCustomer(
	contractorId: string,
	id: string,
	input: CustomerDetailsInput
): Promise<CustomerRow> {
	await assertCanWrite(contractorId);
	const current = await ownedCustomer(contractorId, id);
	if (!current) throw new Error('Customer not found');
	const name = input.name.trim();
	const email = normalizeEmail(input.email);
	const emailChanged = email !== current.email;
	// A linked customer's email is backed by a real login and is read-only.
	if (emailChanged && isCustomerLinked(current)) throw new CustomerEmailLockedError();
	if (emailChanged) {
		const [dupe] = await db
			.select()
			.from(customer)
			.where(
				and(eq(customer.contractorId, contractorId), eq(customer.email, email), ne(customer.id, id))
			)
			.limit(1);
		if (dupe) throw new DuplicateCustomerEmailError();
	}
	const [row] = await db
		.update(customer)
		.set({
			name,
			// A linked customer keeps its email; unlinked customers may change it.
			email: emailChanged ? email : current.email,
			phone: input.phone ?? null,
			address: input.address ?? null,
			city: input.city ?? null,
			state: input.state ?? null,
			postalCode: input.postalCode ?? null,
			notes: input.notes ?? null,
			preferredContact: input.preferredContact ?? 'email'
		})
		.where(eq(customer.id, id))
		.returning();
	// Editing the email invalidates any pending invite so a stale magic link can't bind.
	if (emailChanged) {
		await db
			.update(customerInvite)
			.set({ status: 'revoked' })
			.where(and(eq(customerInvite.customerId, id), eq(customerInvite.status, 'pending')));
	}
	return row;
}

/** Archive a customer — always a soft-archive (state change), never a delete. */
export async function archiveCustomer(contractorId: string, id: string): Promise<void> {
	await assertCanWrite(contractorId);
	const current = await ownedCustomer(contractorId, id);
	if (!current) throw new Error('Customer not found');
	await db.update(customer).set({ archivedAt: new Date() }).where(eq(customer.id, id));
}

export class InvalidAvatarError extends Error {
	constructor() {
		super('That photo could not be saved (not an image or too large)');
		this.name = 'InvalidAvatarError';
	}
}

/** Set or clear (null) a customer's avatar. Validates the data URL + size. */
export async function setCustomerAvatar(
	contractorId: string,
	customerId: string,
	dataUrl: string | null
): Promise<void> {
	await assertCanWrite(contractorId);
	const owned = await ownedCustomer(contractorId, customerId);
	if (!owned) throw new Error('Customer not found');
	if (dataUrl !== null && !isValidAvatarDataUrl(dataUrl)) throw new InvalidAvatarError();
	await db.update(customer).set({ avatar: dataUrl }).where(eq(customer.id, customerId));
}

// ---------------------------------------------------------- Invite binding

/** The customer a user is already linked to for a given contractor, if any. */
async function userLinkedCustomer(
	userId: string,
	contractorId: string
): Promise<CustomerRow | undefined> {
	const [row] = await db
		.select()
		.from(customer)
		.where(and(eq(customer.userId, userId), eq(customer.contractorId, contractorId)))
		.limit(1);
	return row;
}

/**
 * Bind a freshly-authenticated user to the customer referenced by an invite token,
 * regardless of the email they authenticated with. Falls back to email matching for
 * legacy invites with no customer record. Returns null on an invalid/expired token.
 */
export async function bindInviteToken(userId: string, token: string): Promise<CustomerRow | null> {
	const [invite] = await db
		.select()
		.from(customerInvite)
		.where(eq(customerInvite.token, token))
		.limit(1);
	if (!invite || invite.status !== 'pending' || invite.expiresAt.getTime() <= Date.now()) {
		return null;
	}
	if (!invite.customerId) {
		await db.update(customerInvite).set({ status: 'used' }).where(eq(customerInvite.id, invite.id));
		return bindCustomerByEmail(userId, invite.customerEmail);
	}
	const [target] = await db
		.select()
		.from(customer)
		.where(eq(customer.id, invite.customerId))
		.limit(1);
	if (!target) return null;
	// Guard: a user may link to at most one customer per contractor.
	const existing = await userLinkedCustomer(userId, target.contractorId);
	if (existing && existing.id !== target.id) throw new CustomerAlreadyLinkedError();
	const [linked] = await db
		.update(customer)
		.set({ userId })
		.where(eq(customer.id, target.id))
		.returning();
	await db.update(customerInvite).set({ status: 'used' }).where(eq(customerInvite.id, invite.id));
	return linked;
}

/**
 * Fallback binding by email: link a signed-in user to any unlinked customer records
 * that match their email, respecting the one-user-per-contractor guard.
 */
export async function bindCustomerByEmail(
	userId: string,
	email: string
): Promise<CustomerRow | null> {
	const normalized = normalizeEmail(email);
	const matches = await db
		.select()
		.from(customer)
		.where(and(eq(customer.email, normalized), isNull(customer.userId)));
	let bound: CustomerRow | null = null;
	for (const c of matches) {
		if (await userLinkedCustomer(userId, c.contractorId)) continue;
		const [row] = await db
			.update(customer)
			.set({ userId })
			.where(and(eq(customer.id, c.id), isNull(customer.userId)))
			.returning();
		if (row) {
			bound = row;
			await db
				.update(customerInvite)
				.set({ status: 'used' })
				.where(and(eq(customerInvite.customerId, c.id), eq(customerInvite.status, 'pending')));
		}
	}
	return bound;
}

// ---------------------------------------------------------------- Contractor

export async function listContractorOrders(contractorId: string): Promise<ContractorOrderView[]> {
	const rows = await db
		.select()
		.from(order)
		.leftJoin(customer, eq(order.customerId, customer.id))
		.where(and(eq(order.contractorId, contractorId), isNull(order.deletedAt)))
		.orderBy(desc(order.updatedAt));
	return rows.map((r) => toContractorView(r.order, r.customer));
}

export type CreateOrderInput = {
	customerId: string;
	projectName?: string;
	projectType?: string;
	state?: ContractorOrderState;
};

export async function createOrder(
	contractorId: string,
	input: CreateOrderInput
): Promise<OrderRow> {
	await assertCanCreate(contractorId, 'order');
	const [owned, settings] = await Promise.all([
		ownedCustomer(contractorId, input.customerId),
		getContractorSettings(contractorId)
	]);
	if (!owned) throw new Error('Customer not found');
	const [row] = await db
		.insert(order)
		.values({
			contractorId,
			customerId: owned.id,
			projectName: input.projectName ?? null,
			projectType: input.projectType ?? null,
			state: input.state ?? 'Inquiry',
			// New orders get a follow-up at the contractor's default interval.
			nextFollowUpAt: defaultFollowUp(settings.followUpDays)
		})
		.returning();

	// Open the timeline with the order's own creation, so it never starts blank and
	// the first status is anchored to a date. Customer-visible: "we've got your job"
	// is exactly the kind of thing the portal exists to say.
	await db.insert(timelineEntry).values({
		orderId: row.id,
		kind: 'status',
		title: 'Order created',
		detail: row.projectName ? `${row.projectName} added for ${owned.name}.` : '',
		authorRole: 'contractor',
		internal: false
	});

	return row;
}

/** Set (or clear, with null) an order's next follow-up date. */
export async function setFollowUp(
	orderId: string,
	contractorId: string,
	date: Date | null
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');
	await db.update(order).set({ nextFollowUpAt: date }).where(eq(order.id, orderId));
}

/**
 * Push an order's follow-up out by the contractor's own cadence, because they
 * have just been in touch with the customer.
 *
 * The point of a follow-up is "nobody has spoken to this person lately". The
 * moment somebody does, the reminder has served its purpose and asking for it
 * again tomorrow is noise — so every path that represents the contractor
 * communicating (a status update, an email we sent, a portal reply) ends here.
 *
 * Unconditional, not "only if the new date is later". A contractor who set a
 * date for tomorrow and then emailed the customer today has answered the thing
 * they were reminding themselves to do; keeping the earlier date would chase
 * them for a conversation that already happened. Their own date is one click
 * away in the follow-up panel if they meant it as something else.
 *
 * Quiet by design: it never throws. A follow-up failing to move is not a reason
 * to fail the send that has already gone out.
 */
export async function bumpFollowUpAfterContact(
	orderId: string,
	contractorId: string
): Promise<void> {
	try {
		const settings = await getContractorSettings(contractorId);
		await db
			.update(order)
			.set({ nextFollowUpAt: defaultFollowUp(settings.followUpDays) })
			.where(and(eq(order.id, orderId), eq(order.contractorId, contractorId)));
	} catch (err) {
		console.warn(`[follow-up] could not reschedule order ${orderId}:`, err);
	}
}

/** Snooze an order's follow-up forward by a preset, from now. */
/** Billing-guarded via `setFollowUp`; deliberately not double-checked here. */
export async function snoozeFollowUp(
	orderId: string,
	contractorId: string,
	preset: SnoozePreset
): Promise<void> {
	await setFollowUp(orderId, contractorId, snoozeDate(preset));
}

/** Returns the order only if it belongs to the given contractor. */
async function contractorOrder(
	orderId: string,
	contractorId: string
): Promise<OrderRow | undefined> {
	const [row] = await db
		.select()
		.from(order)
		.where(
			and(eq(order.id, orderId), eq(order.contractorId, contractorId), isNull(order.deletedAt))
		)
		.limit(1);
	return row;
}

export async function updateOrderState(
	orderId: string,
	contractorId: string,
	newState: ContractorOrderState,
	note?: string
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');

	// A status change is customer-visible and notifies them; the note (if any) is
	// recorded separately as an internal, timestamped entry the customer never sees.
	if (newState !== existing.state) {
		await db.update(order).set({ state: newState }).where(eq(order.id, orderId));
		const milestone = newState === 'Work Complete' || newState === 'Work Cancelled';
		await db.insert(timelineEntry).values({
			orderId,
			kind: milestone ? 'milestone' : 'status',
			title: newState,
			// Record the transition, not just the destination — otherwise the history
			// reads as a bare list of states with no way to see what actually moved.
			detail: `Status changed from ${existing.state} to ${newState}`,
			authorRole: 'contractor',
			internal: false
		});
		if (existing.customerId) {
			const [cust] = await db
				.select()
				.from(customer)
				.where(eq(customer.id, existing.customerId))
				.limit(1);
			if (cust?.userId) {
				await createNotification({
					userId: cust.userId,
					orderId,
					title: `Order update: ${newState}`,
					priority: milestone ? 'high' : 'standard'
				});
			}
		}
	}

	const trimmedNote = note?.trim();
	if (trimmedNote) {
		await db.insert(timelineEntry).values({
			orderId,
			kind: 'note',
			// Title the note after the state it accompanies so the internal-notes
			// surface shows which status change it explains.
			title: newState !== existing.state ? `Note · ${newState}` : 'Note',
			detail: trimmedNote,
			authorRole: 'contractor',
			internal: true
		});
	}

	// A status change is an update the customer sees, so it counts as being in
	// touch. An internal note alone does not — that is the contractor talking to
	// themselves, and it should not silence a reminder to call someone.
	if (newState !== existing.state) await bumpFollowUpAfterContact(orderId, contractorId);
}

/** Notify a linked customer (no-op when the order has no linked portal account). */
async function notifyLinkedCustomer(
	customerId: string | null,
	orderId: string,
	title: string,
	priority: 'standard' | 'high'
): Promise<void> {
	if (!customerId) return;
	const [cust] = await db.select().from(customer).where(eq(customer.id, customerId)).limit(1);
	if (cust?.userId) await createNotification({ userId: cust.userId, orderId, title, priority });
}

// ------------------------------------------------------------------ Payments
//
// ADR-0010 said the app records money and never processes it. These functions are
// that rule with the arithmetic finished: a job carries a total, payments are
// recorded against it, and the balance is derived. Nothing here reaches a payment
// rail, and nothing here can be triggered by a customer — the contractor is the
// only one who can say money arrived, because they are the only one who saw it.

/** The charges on one order, in the contractor's order. */
export async function listLineItems(orderId: string): Promise<LineItem[]> {
	const rows = await db
		.select()
		.from(lineItem)
		.where(eq(lineItem.orderId, orderId))
		.orderBy(lineItem.position, lineItem.createdAt);
	return rows.map((r) => ({ id: r.id, label: r.label, amountCents: r.amountCents }));
}

/**
 * Add a charge.
 *
 * Appends: the new row's position is one past the current last, so a line lands
 * where the contractor just typed it rather than at the top. Adding the FIRST
 * line is what flips an order from a lump total to an itemised one, and the
 * timeline says so, because the customer's total may change as a result.
 */
export async function addLineItem(
	orderId: string,
	contractorId: string,
	input: { label: string; amountCents: number }
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');

	const current = await listLineItems(orderId);
	const [last] = await db
		.select({ position: lineItem.position })
		.from(lineItem)
		.where(eq(lineItem.orderId, orderId))
		.orderBy(desc(lineItem.position))
		.limit(1);

	const label = input.label.trim();
	await db.insert(lineItem).values({
		orderId,
		label,
		amountCents: input.amountCents,
		position: (last?.position ?? 0) + 1
	});

	await noteLineChange(
		orderId,
		current.length === 0 ? 'Invoice itemised' : 'Line added',
		`${label} — ${formatCents(input.amountCents)}`
	);
}

/** Rename or re-price a charge. */
export async function updateLineItem(
	itemId: string,
	orderId: string,
	contractorId: string,
	input: { label: string; amountCents: number }
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');

	// Read the old row first. `.returning()` on an update hands back the NEW
	// values, and a history entry that cannot say what the figure used to be is
	// most of the reason to write one at all.
	const [before] = await db
		.select()
		.from(lineItem)
		.where(and(eq(lineItem.id, itemId), eq(lineItem.orderId, orderId)))
		.limit(1);
	if (!before) return;

	const label = input.label.trim();
	await db
		.update(lineItem)
		.set({ label, amountCents: input.amountCents })
		.where(and(eq(lineItem.id, itemId), eq(lineItem.orderId, orderId)));

	// Say only what actually moved. A renamed line and a re-priced one are
	// different events, and reporting both every time makes the history unreadable.
	const parts: string[] = [];
	if (before.label !== label) parts.push(`${before.label} → ${label}`);
	if (before.amountCents !== input.amountCents) {
		parts.push(`${formatCents(before.amountCents)} → ${formatCents(input.amountCents)}`);
	}
	if (parts.length === 0) return;
	await noteLineChange(orderId, 'Line updated', `${label} · ${parts.join(' · ')}`);
}

/**
 * Remove a charge.
 *
 * Removing the LAST one hands the total back to the stored `finalAmountCents`,
 * which is whatever was typed before the breakdown existed — possibly nothing.
 * That is the honest outcome: an order with no lines has no itemised total, and
 * inventing one from the rows just deleted would be worse.
 */
export async function deleteLineItem(
	itemId: string,
	orderId: string,
	contractorId: string
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');
	const [removed] = await db
		.delete(lineItem)
		.where(and(eq(lineItem.id, itemId), eq(lineItem.orderId, orderId)))
		.returning();
	if (!removed) return;
	await noteLineChange(
		orderId,
		'Line removed',
		`${removed.label} — ${formatCents(removed.amountCents)}`
	);
}

/**
 * Record a change to the invoice, in the customer's history.
 *
 * Says WHAT changed and then what it adds up to — "Labour — $4,600.00 · Total
 * $18,000.00". The first version of this wrote only the total, which meant a
 * contractor adding six charges produced six identical "Invoice updated" rows
 * and the history could not answer the one question it was there for: what got
 * added, and for how much.
 *
 * The total is read back AFTER the write rather than computed from the caller's
 * arguments, so this can never report a figure the invoice does not show.
 *
 * Not internal: what a job costs is the customer's business, and a line appearing
 * on their invoice with no corresponding history entry is how a surprise charge
 * looks from their side.
 */
async function noteLineChange(orderId: string, title: string, what: string): Promise<void> {
	const [row] = await db
		.select({ finalAmountCents: order.finalAmountCents })
		.from(order)
		.where(eq(order.id, orderId))
		.limit(1);
	const summary = invoiceSummary(
		{ finalAmountCents: row?.finalAmountCents ?? null },
		[],
		await listLineItems(orderId)
	);
	const total = summary.totalCents == null ? '' : ` · Total ${formatCents(summary.totalCents)}`;
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'invoice',
		title,
		detail: `${what}${total}`,
		authorRole: 'contractor',
		internal: false
	});
}

/**
 * Put a job on a day's schedule, or take it off.
 *
 * Its own action rather than part of `setOrderDetails`, because this is the one
 * date a contractor changes from the dashboard mid-morning — "we're not getting
 * to the Alder Street job today" — and making that a trip through the whole
 * details form would guarantee it never happened.
 *
 * Not written to the timeline. Which day the crew turns up is planning, and it
 * moves; a customer's history filling with "visit moved to Thursday, visit moved
 * to Friday" would bury the entries that record what actually happened.
 */
export async function setVisitDate(
	orderId: string,
	contractorId: string,
	visitDate: Date | null
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');
	await db.update(order).set({ visitDate }).where(eq(order.id, orderId));
}

/** One job on today's run, with enough to place it on a map. */
export type ScheduledVisit = {
	id: string;
	projectName: string | null;
	customerName: string;
	icon: string | null;
	state: string;
	/** Where the work is, in words. */
	siteLabel: string;
};

/**
 * Everything scheduled for one calendar day, in the order it should be driven.
 *
 * This used to resolve each site's coordinates from its ZIP so the dashboard
 * could say how far away each job was. That feature is gone, and so is the ZIP
 * lookup that fed it — which also means this no longer makes a network call per
 * distinct postcode just to render a list of today's jobs.
 *
 * A lookup that fails leaves the job on the list with null coordinates rather
 * than dropping it. A job you cannot estimate the drive to is still a job you are
 * doing today, and silently omitting it is the worst thing this could do.
 */
export async function visitsOn(contractorId: string, day: Date): Promise<ScheduledVisit[]> {
	const start = new Date(day);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);

	const rows = await db
		.select({ order, customer })
		.from(order)
		.leftJoin(customer, eq(order.customerId, customer.id))
		.where(
			and(
				eq(order.contractorId, contractorId),
				isNull(order.deletedAt),
				gte(order.visitDate, start),
				lt(order.visitDate, end)
			)
		)
		.orderBy(order.visitDate, order.createdAt);

	return rows.map((r) => {
		const city = r.order.siteCity ?? r.customer?.city ?? null;
		const state = r.order.siteState ?? r.customer?.state ?? null;
		const street = r.order.siteAddress ?? r.customer?.address ?? null;

		return {
			id: r.order.id,
			projectName: r.order.projectName,
			customerName: r.customer?.name ?? 'Unknown customer',
			icon: r.order.icon,
			state: r.order.state,
			siteLabel: [street, [city, state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
		};
	});
}

/**
 * The job's own details: what the work is, where it happens, and when.
 *
 * One action rather than five, because these are edited together in one panel
 * and a contractor filling in a job should not generate five timeline entries.
 * Nothing here is customer-facing news, so nothing is written to the timeline —
 * the portal reads the current values, and "the description was reworded" is not
 * an event anyone needs a record of.
 */
export async function setOrderDetails(
	orderId: string,
	contractorId: string,
	input: {
		description: string | null;
		siteAddress: string | null;
		siteCity: string | null;
		siteState: string | null;
		sitePostalCode: string | null;
		startDate: Date | null;
		targetDate: Date | null;
	}
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');
	await db
		.update(order)
		.set({
			description: input.description?.trim() || null,
			siteAddress: input.siteAddress?.trim() || null,
			siteCity: input.siteCity?.trim() || null,
			siteState: input.siteState?.trim() || null,
			sitePostalCode: input.sitePostalCode?.trim() || null,
			startDate: input.startDate,
			targetDate: input.targetDate
		})
		.where(eq(order.id, orderId));
}

/** Payments on one order, oldest-first. Shape shared with the browser via `PaymentRecord`. */
export async function listPayments(orderId: string): Promise<PaymentRecord[]> {
	const rows = await db
		.select()
		.from(payment)
		.where(eq(payment.orderId, orderId))
		.orderBy(payment.receivedAt);
	return rows.map(toPaymentRecord);
}

function toPaymentRecord(row: PaymentRow): PaymentRecord {
	return {
		id: row.id,
		kind: row.kind,
		amountCents: row.amountCents,
		method: row.method,
		note: row.note,
		receivedAt: row.receivedAt
	};
}

/**
 * Set what the job costs.
 *
 * Separate from close-out on purpose. `finalAmountCents` was written only when an
 * order was completed, which made a deposit impossible to reason about — half of
 * an unknown total is not a number. The total is agreed when the quote is, so it
 * is settable from the moment there is one, and completing an order still writes
 * the same column.
 *
 * The timeline records it, because a customer who is about to be asked for a
 * deposit is entitled to see where the figure came from.
 */
export async function setOrderTotal(
	orderId: string,
	contractorId: string,
	totalCents: number | null
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');
	if (existing.finalAmountCents === totalCents) return;

	await db.update(order).set({ finalAmountCents: totalCents }).where(eq(order.id, orderId));
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'invoice',
		title: totalCents == null ? 'Project total cleared' : 'Project total set',
		detail: totalCents == null ? '' : formatCents(totalCents),
		authorRole: 'contractor',
		internal: false
	});
}

/**
 * Record money received.
 *
 * `receivedAt` is the contractor's to state — Friday's cheque banked on Monday
 * belongs on Friday's line of the invoice — and defaults to now when they don't
 * say. The timeline entry is customer-visible: being told their deposit landed is
 * the whole point, and a payment the customer can't see is a payment they will
 * email to ask about.
 */
export async function recordPayment(
	orderId: string,
	contractorId: string,
	input: {
		kind: string;
		amountCents: number;
		method: string | null;
		note: string | null;
		receivedAt?: Date | null;
	}
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');

	const [row] = await db
		.insert(payment)
		.values({
			orderId,
			kind: input.kind,
			amountCents: input.amountCents,
			method: input.method,
			note: input.note?.trim() || null,
			receivedAt: input.receivedAt ?? new Date()
		})
		.returning();

	await db.insert(timelineEntry).values({
		orderId,
		kind: 'invoice',
		title: `${paymentKindLabel(row.kind)} received`,
		detail: `${formatCents(row.amountCents)}${
			paymentMethodLabel(row.method) ? ` · ${paymentMethodLabel(row.method)}` : ''
		}${row.note ? ` — ${row.note}` : ''}`,
		authorRole: 'contractor',
		internal: false
	});

	// What they owe changed, so tell them what it changed TO rather than making
	// them open the portal to find out.
	const summary = await orderInvoice(orderId, existing.finalAmountCents);
	const standing =
		summary.status === 'settled'
			? 'paid in full'
			: summary.status === 'open'
				? `${formatCents(summary.balanceCents)} remaining`
				: summary.status === 'overpaid'
					? `${formatCents(-(summary.balanceCents ?? 0))} overpaid`
					: `${formatCents(summary.paidCents)} received`;
	await notifyLinkedCustomer(
		existing.customerId,
		orderId,
		`${paymentKindLabel(row.kind)} received — ${standing}`,
		'standard'
	);
	// Money arriving is contact. It should quiet the follow-up reminder exactly as
	// a status change does.
	await bumpFollowUpAfterContact(orderId, contractorId);
}

/**
 * Remove a recorded payment.
 *
 * A correction, not an erasure: the timeline keeps the original "received" entry
 * and gains a reversal beside it, because a customer who was told their deposit
 * landed must not find that line quietly gone. Only the arithmetic is undone.
 */
export async function deletePayment(
	paymentId: string,
	orderId: string,
	contractorId: string
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');

	const [row] = await db
		.delete(payment)
		.where(and(eq(payment.id, paymentId), eq(payment.orderId, orderId)))
		.returning();
	if (!row) return;

	await db.insert(timelineEntry).values({
		orderId,
		kind: 'invoice',
		title: `${paymentKindLabel(row.kind)} removed`,
		detail: `${formatCents(row.amountCents)} — recorded in error`,
		authorRole: 'contractor',
		internal: false
	});
}

/** The invoice for one order: its total, its payments, and what is left. */
export async function orderInvoice(
	orderId: string,
	finalAmountCents: number | null
): Promise<InvoiceSummary> {
	return invoiceSummary(
		{ finalAmountCents },
		await listPayments(orderId),
		await listLineItems(orderId)
	);
}

/**
 * Close an order out as complete, recording the final invoice and payment.
 *
 * The app RECORDS money here but never processes it (ADR-0010): the contractor
 * keys in the invoice total and how the customer paid. The figures land on the
 * order (customer-visible on the portal) and on the timeline, and the customer is
 * notified. Cents in, whole cents stored.
 *
 * What changed when payments became rows: `markPaid` now means "the REMAINING
 * balance was received", not "the whole total was". On a job with a deposit
 * already recorded it writes a final payment for what was actually outstanding,
 * which is the number the contractor was handed. Stamping the full total here —
 * what the single-payment version did — would have counted the deposit twice the
 * moment deposits existed.
 */
export async function completeOrder(
	orderId: string,
	contractorId: string,
	opts: {
		amountCents: number | null;
		notes: string | null;
		paymentMethod: string | null;
		markPaid: boolean;
	}
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');

	const notes = opts.notes?.trim() || null;
	await db
		.update(order)
		.set({ state: 'Work Complete', finalAmountCents: opts.amountCents, finalNotes: notes })
		.where(eq(order.id, orderId));

	await db.insert(timelineEntry).values({
		orderId,
		kind: 'milestone',
		title: 'Work Complete',
		detail:
			existing.state === 'Work Complete'
				? 'Order completed'
				: `Status changed from ${existing.state} to Work Complete`,
		authorRole: 'contractor',
		internal: false
	});
	// The invoice figure gets its own `invoice`-kind entry so the history shows the
	// number rather than burying it in a note.
	if (opts.amountCents != null) {
		await db.insert(timelineEntry).values({
			orderId,
			kind: 'invoice',
			title: 'Final invoice',
			detail: `${formatCents(opts.amountCents)}${notes ? ` — ${notes}` : ''}`,
			authorRole: 'contractor',
			internal: false
		});
	}

	if (opts.markPaid) {
		// What is actually still owed, given anything already recorded. Null total
		// means nobody agreed a figure, so the best available reading of "they paid
		// the rest" is that the job is settled at what has come in — record nothing
		// rather than invent an amount.
		const before = await orderInvoice(orderId, opts.amountCents);
		const outstanding = before.balanceCents;
		if (outstanding != null && outstanding > 0) {
			await recordPayment(orderId, contractorId, {
				kind: 'final',
				amountCents: outstanding,
				method: opts.paymentMethod,
				note: null
			});
		}
	}

	await notifyLinkedCustomer(existing.customerId, orderId, 'Order update: Work Complete', 'high');
	await bumpFollowUpAfterContact(orderId, contractorId);
}

/**
 * Cancel an order. No invoice or payment — a cancellation just needs a reason
 * (kept as an internal note) and, optionally, a heads-up to the customer.
 */
export async function cancelOrder(
	orderId: string,
	contractorId: string,
	opts: { reason: string | null; notify: boolean }
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');

	await db.update(order).set({ state: 'Work Cancelled' }).where(eq(order.id, orderId));
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'milestone',
		title: 'Work Cancelled',
		detail: `Status changed from ${existing.state} to Work Cancelled`,
		authorRole: 'contractor',
		internal: false
	});
	const reason = opts.reason?.trim();
	if (reason) {
		await db.insert(timelineEntry).values({
			orderId,
			kind: 'note',
			title: 'Note · Work Cancelled',
			detail: reason,
			authorRole: 'contractor',
			internal: true
		});
	}
	if (opts.notify) {
		await notifyLinkedCustomer(
			existing.customerId,
			orderId,
			'Order update: Work Cancelled',
			'high'
		);
	}
	await bumpFollowUpAfterContact(orderId, contractorId);
}

export type OrderNote = { id: string; orderId: string; detail: string; createdAt: Date };

/** Internal contractor notes across all of the contractor's orders, newest first. */
export async function listOrderNotes(contractorId: string): Promise<OrderNote[]> {
	return db
		.select({
			id: timelineEntry.id,
			orderId: timelineEntry.orderId,
			detail: timelineEntry.detail,
			createdAt: timelineEntry.createdAt
		})
		.from(timelineEntry)
		.innerJoin(order, eq(timelineEntry.orderId, order.id))
		.where(and(eq(order.contractorId, contractorId), eq(timelineEntry.internal, true)))
		.orderBy(desc(timelineEntry.createdAt));
}

/**
 * Full detail for one Order, minus its Documents.
 *
 * Documents deliberately do not live here: they are their own entity with their
 * own authorization rule, and every surface reaches them through
 * `documents.server.ts`. Returning them from the contractor's order query is how
 * the contractor came to have a different set of rules from everyone else.
 */
export type OrderDetail = {
	order: ContractorOrderView;
	customer: CustomerRow | null;
	timeline: TimelineRow[];
	/** Total, payments and balance — computed, never stored. See `invoice.ts`. */
	invoice: InvoiceSummary;
};

/** Full detail for a single order the contractor owns, or null if not theirs. */
export async function getOrderDetail(
	orderId: string,
	contractorId: string
): Promise<OrderDetail | null> {
	const [row] = await db
		.select()
		.from(order)
		.leftJoin(customer, eq(order.customerId, customer.id))
		.where(
			and(eq(order.id, orderId), eq(order.contractorId, contractorId), isNull(order.deletedAt))
		)
		.limit(1);
	if (!row) return null;
	const timeline = await db
		.select()
		.from(timelineEntry)
		.where(eq(timelineEntry.orderId, orderId))
		.orderBy(desc(timelineEntry.createdAt));
	return {
		order: toContractorView(row.order, row.customer),
		customer: row.customer,
		timeline,
		invoice: invoiceSummary(row.order, await listPayments(orderId), await listLineItems(orderId))
	};
}

/**
 * Record that a message was emailed to this order's customer.
 *
 * Only ever called after the provider has accepted the message, so the timeline
 * says "we sent this" and means it — the ordering matters, because a false record
 * of contact is worse than a missing one (a contractor acts on it). The `mailto:`
 * fallback writes nothing at all: the app can't know whether the contractor
 * actually pressed send in their own mail client.
 *
 * Not internal. The customer receiving the mail already knows it was sent, so
 * hiding it from their portal would make their history disagree with their inbox.
 *
 * Returns false when the order isn't this contractor's — the caller has already
 * sent the mail by then, so an unknown `orderId` costs the record, not the message.
 */
export async function recordEmailSent(
	orderId: string,
	contractorId: string,
	message: { customerName: string; subject: string }
): Promise<boolean> {
	await assertCanWrite(contractorId);
	const owned = await contractorOrder(orderId, contractorId);
	if (!owned) return false;
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'message',
		title: `Emailed ${message.customerName}`.trim(),
		detail: message.subject.trim(),
		authorRole: 'contractor',
		internal: false
	});
	// They have been in touch — restart the clock.
	await bumpFollowUpAfterContact(orderId, contractorId);
	return true;
}

/** Append an internal, contractor-only note to an order's timeline. */
export async function addOrderNote(
	orderId: string,
	contractorId: string,
	detail: string
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');
	const trimmed = detail.trim();
	if (!trimmed) return;
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'note',
		title: 'Note',
		detail: trimmed,
		authorRole: 'contractor',
		internal: true
	});
}

/**
 * Archive an order (soft delete). We never hard-delete the record; instead we
 * stamp `deletedAt`, and every read path filters those out so it disappears
 * from the app while the data (timeline, documents) is preserved.
 */
export async function deleteOrder(orderId: string, contractorId: string): Promise<void> {
	await assertCanWrite(contractorId);
	const owned = await contractorOrder(orderId, contractorId);
	if (!owned) throw new Error('Order not found');
	await db.update(order).set({ deletedAt: new Date() }).where(eq(order.id, orderId));
}

// ------------------------------------------------------------------ Customer portal

/**
 * Who the portal is being rendered for.
 *
 * `user` is the real case: a signed-in customer, whose orders are read across
 * EVERY customer record linked to their login — the same person working with two
 * contractors holds two customer records and one User, and both sets of work is
 * theirs to see.
 *
 * `customer` is the development view-as case, pinned to one customer record.
 * Keeping it in the same type means the portal has exactly one read path rather
 * than a real one and a debug one that can disagree.
 */
export type PortalSubject =
	{ kind: 'user'; userId: string } | { kind: 'customer'; customerId: string };

function portalScope(subject: PortalSubject) {
	return subject.kind === 'user'
		? eq(customer.userId, subject.userId)
		: eq(customer.id, subject.customerId);
}

export type PortalOrderSummary = {
	id: string;
	projectName: string | null;
	projectType: string | null;
	/** Coarse stage, for the progress rail. */
	customerVisibleState: string;
	/** What the customer is waiting on, in words. See `customerStateLabel`. */
	customerStateLabel: string;
	contractorId: string;
	updatedAt: Date;
	active: boolean;
	/**
	 * Outstanding Tasks on this order.
	 *
	 * Carried on the SUMMARY, not just the detail, because the portal's project
	 * list is where a customer with three jobs finds out that one of them is
	 * waiting on them — and a customer who has to open each project to discover
	 * that has been told nothing.
	 */
	openTasks: number;
	/** Whether the State itself is one of the two that mean "pay me". */
	paymentDue: boolean;
};

/** Every order this subject may see, newest first. Drives the portal's order rail. */
export async function listPortalOrders(subject: PortalSubject): Promise<PortalOrderSummary[]> {
	const rows = await db
		.select({ order, customerName: customer.name })
		.from(order)
		.innerJoin(customer, eq(order.customerId, customer.id))
		.where(and(portalScope(subject), isNull(order.deletedAt)))
		.orderBy(desc(order.updatedAt));

	// One grouped query for the whole list rather than one per row — the rail
	// renders on every portal page, so this is the query that would have been N+1.
	const counts = await openTaskCounts(rows.map((r) => r.order.id));

	return rows.map((r) => ({
		id: r.order.id,
		projectName: r.order.projectName,
		projectType: r.order.projectType,
		customerVisibleState: getVisibleCustomerState(r.order.state as ContractorOrderState),
		customerStateLabel: customerStateLabel(r.order.state as ContractorOrderState),
		contractorId: r.order.contractorId,
		updatedAt: r.order.updatedAt,
		active: isActiveState(r.order.state as ContractorOrderState),
		openTasks: counts.get(r.order.id) ?? 0,
		paymentDue: isCustomerActionState(r.order.state as ContractorOrderState)
	}));
}

export type PortalOrderDetail = OrderRow & {
	customerName: string;
	/** Coarse stage, for the progress rail. */
	customerVisibleState: string;
	/** What the customer is waiting on, in words. See `customerStateLabel`. */
	customerStateLabel: string;
	/**
	 * True when the ball is in the CUSTOMER's court — drives the headline's
	 * emphasis. Now BOTH halves of that: the two "pay me" states, and any
	 * outstanding Task the contractor has asked for. It used to be the states
	 * alone, which meant the only thing this product could ask a customer for was
	 * money.
	 */
	customerMustAct: boolean;
	/**
	 * Just the State half of it — whether the order sits in one of the two "pay
	 * me" states. Carried separately from `customerMustAct` because the portal
	 * composes the two halves itself, in `customerActionSummary`, and a composed
	 * boolean cannot be taken apart again.
	 */
	paymentDue: boolean;
	/** Outstanding first. See `customerActionSummary` for what to say about them. */
	tasks: CustomerTaskView[];
	contractorName: string;
	/** Null while the customer has not accepted an invite. */
	customerUserId: string | null;
	timeline: TimelineRow[];
	/**
	 * The same invoice the contractor sees and the same one the emailed copy
	 * carries — one `invoiceSummary` call, three surfaces. The customer is shown
	 * their own money unconditionally: a balance is not a contractor-only fact,
	 * and hiding it is what made customers email to ask what they owed.
	 */
	invoice: InvoiceSummary;
};

/**
 * One order for the portal, or null when it is not this subject's to see.
 *
 * The timeline is filtered on `internal = false` in the QUERY, not in the
 * component: an internal note must never reach the browser at all, and a
 * template that forgets the filter is a leak rather than a rendering bug.
 */
export async function getPortalOrder(
	subject: PortalSubject,
	orderId: string
): Promise<PortalOrderDetail | null> {
	const [row] = await db
		.select({
			order,
			customerName: customer.name,
			customerUserId: customer.userId,
			contractorName: user.name
		})
		.from(order)
		.innerJoin(customer, eq(order.customerId, customer.id))
		.innerJoin(user, eq(order.contractorId, user.id))
		.where(and(eq(order.id, orderId), portalScope(subject), isNull(order.deletedAt)))
		.limit(1);
	if (!row) return null;

	const timeline = await db
		.select()
		.from(timelineEntry)
		.where(and(eq(timelineEntry.orderId, orderId), eq(timelineEntry.internal, false)))
		.orderBy(desc(timelineEntry.createdAt));

	const tasks = await listTasks(orderId);

	return {
		...row.order,
		customerName: row.customerName,
		customerUserId: row.customerUserId,
		contractorName: row.contractorName,
		customerVisibleState: getVisibleCustomerState(row.order.state as ContractorOrderState),
		customerStateLabel: customerStateLabel(row.order.state as ContractorOrderState),
		customerMustAct:
			isCustomerActionState(row.order.state as ContractorOrderState) ||
			tasks.some((t) => t.completedAt == null),
		paymentDue: isCustomerActionState(row.order.state as ContractorOrderState),
		tasks,
		timeline,
		invoice: invoiceSummary(row.order, await listPayments(orderId), await listLineItems(orderId))
	};
}

/**
 * Documents on a portal Order live in `documents.server.ts`.
 *
 * They used to be listed, stored and served from here, with the contractor's
 * copies of the same three operations sitting a few hundred lines up the file.
 * That duplication is what the `order-documents` change removed: one entity, one
 * upload path, one authorization rule, reached through a `Viewer` rather than
 * through a per-surface subject.
 */

// ------------------------------------------------------------- Notifications

async function createNotification(input: {
	userId: string;
	orderId?: string;
	title: string;
	detail?: string;
	priority?: 'standard' | 'high';
}): Promise<void> {
	await db.insert(notification).values({
		userId: input.userId,
		orderId: input.orderId ?? null,
		title: input.title,
		detail: input.detail ?? '',
		priority: input.priority ?? 'standard'
	});
}

export function listNotifications(userId: string): Promise<NotificationRow[]> {
	return db
		.select()
		.from(notification)
		.where(eq(notification.userId, userId))
		.orderBy(desc(notification.createdAt));
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
	await db
		.update(notification)
		.set({ unread: false })
		.where(and(eq(notification.id, id), eq(notification.userId, userId)));
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
	await db
		.update(notification)
		.set({ unread: false })
		.where(and(eq(notification.userId, userId), eq(notification.unread, true)));
}

// ------------------------------------------------------------------- Invites

export function listInvites(contractorId: string): Promise<InviteRow[]> {
	return db
		.select()
		.from(customerInvite)
		.where(eq(customerInvite.contractorId, contractorId))
		.orderBy(desc(customerInvite.createdAt));
}

/**
 * Where one customer stands with the portal, as one value.
 *
 * The order workspace and the directory were both deriving this from a customer
 * row plus a list of invites, and disagreeing: the workspace only ever asked
 * "are they linked", so it offered "Invite customer to portal" to somebody who
 * had already been sent one — and pressing it sent a second link.
 *
 * `linked` beats everything: an accepted invite is history once the account
 * exists. Otherwise the newest live invite decides, and one that has lapsed is
 * reported as expired rather than pending, because "invite sent" is not a useful
 * thing to read about a link that no longer opens.
 */
export type PortalStanding =
	| { state: 'linked' }
	| { state: 'none' }
	| { state: 'pending'; inviteId: string; sentAt: Date; expiresAt: Date }
	| { state: 'expired'; inviteId: string; sentAt: Date };

export async function portalStanding(
	contractorId: string,
	customerId: string | null,
	linked: boolean,
	now: Date = new Date()
): Promise<PortalStanding> {
	if (linked) return { state: 'linked' };
	if (!customerId) return { state: 'none' };
	const [invite] = await db
		.select()
		.from(customerInvite)
		.where(
			and(
				eq(customerInvite.contractorId, contractorId),
				eq(customerInvite.customerId, customerId),
				eq(customerInvite.status, 'pending')
			)
		)
		.orderBy(desc(customerInvite.createdAt))
		.limit(1);
	if (!invite) return { state: 'none' };
	return invite.expiresAt.getTime() > now.getTime()
		? {
				state: 'pending',
				inviteId: invite.id,
				sentAt: invite.createdAt,
				expiresAt: invite.expiresAt
			}
		: { state: 'expired', inviteId: invite.id, sentAt: invite.createdAt };
}

/**
 * Thrown when a still-valid invite already exists for a customer and a second one
 * is attempted. One open invite at a time: a fresh invite can only go out once the
 * current one has expired, so the customer never juggles two live links.
 */
export class InviteStillOpenError extends Error {
	constructor(readonly expiresAt: Date) {
		super('An invite is already open for this customer.');
		this.name = 'InviteStillOpenError';
	}
}

/** Send an invite to one of the contractor's own customers (directory-level). */
export async function createInvite(contractorId: string, customerId: string): Promise<InviteRow> {
	await assertCanWrite(contractorId);
	const cust = await ownedCustomer(contractorId, customerId);
	if (!cust) throw new Error('Customer not found');
	// One open invite at a time: refuse a new one while a still-valid pending invite
	// is out. Expiry is by time, not a status flip, so this checks expiresAt rather
	// than trusting `status` alone.
	const [open] = await db
		.select({ expiresAt: customerInvite.expiresAt })
		.from(customerInvite)
		.where(
			and(
				eq(customerInvite.contractorId, contractorId),
				eq(customerInvite.customerId, customerId),
				eq(customerInvite.status, 'pending'),
				gt(customerInvite.expiresAt, new Date())
			)
		)
		.limit(1);
	if (open) throw new InviteStillOpenError(open.expiresAt);
	const [row] = await db
		.insert(customerInvite)
		.values({
			contractorId,
			customerId,
			customerEmail: cust.email,
			token: crypto.randomUUID(),
			status: 'pending',
			expiresAt: new Date(Date.now() + INVITE_TTL_MS)
		})
		.returning();
	return row;
}

export async function resendInvite(inviteId: string, contractorId: string): Promise<void> {
	await assertCanWrite(contractorId);
	await db
		.update(customerInvite)
		.set({
			status: 'pending',
			token: crypto.randomUUID(),
			expiresAt: new Date(Date.now() + INVITE_TTL_MS)
		})
		.where(and(eq(customerInvite.id, inviteId), eq(customerInvite.contractorId, contractorId)));
}

export async function revokeInvite(inviteId: string, contractorId: string): Promise<void> {
	await assertCanWrite(contractorId);
	await db
		.update(customerInvite)
		.set({ status: 'revoked' })
		.where(and(eq(customerInvite.id, inviteId), eq(customerInvite.contractorId, contractorId)));
}

/** Permanently delete an invite. */
export async function deleteInvite(inviteId: string, contractorId: string): Promise<void> {
	await assertCanWrite(contractorId);
	await db
		.delete(customerInvite)
		.where(and(eq(customerInvite.id, inviteId), eq(customerInvite.contractorId, contractorId)));
}
