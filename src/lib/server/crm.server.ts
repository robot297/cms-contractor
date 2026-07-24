import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { db } from './db';
import {
	attachment,
	customer,
	customerInvite,
	notification,
	order,
	timelineEntry
} from './db/schema';
import {
	defaultFollowUp,
	getVisibleCustomerState,
	isActiveState,
	isCustomerLinked,
	isFollowUpDue,
	isValidAvatarDataUrl,
	normalizeEmail,
	snoozeDate,
	type ContractorOrderState,
	type SnoozePreset,
	type TimelineKind
} from '$lib/crm';

/** How long a customer invite / magic link stays valid. */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export type OrderRow = typeof order.$inferSelect;
export type CustomerRow = typeof customer.$inferSelect;
export type TimelineRow = typeof timelineEntry.$inferSelect;
export type NotificationRow = typeof notification.$inferSelect;
export type InviteRow = typeof customerInvite.$inferSelect;

export type ContractorOrderView = OrderRow & {
	customerName: string;
	customerEmail: string;
	customerPhone: string | null;
	customerAddress: string | null;
	customerPreferredContact: 'email' | 'phone';
	customerVisibleState: string;
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
		customerPreferredContact: cust?.preferredContact === 'phone' ? 'phone' : 'email',
		customerVisibleState: getVisibleCustomerState(row.state as ContractorOrderState),
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
	address?: string | null;
	notes?: string | null;
	tags?: string[];
	preferredContact?: 'email' | 'phone';
};

export async function createCustomer(
	contractorId: string,
	input: CustomerDetailsInput
): Promise<CustomerRow> {
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
			notes: input.notes ?? null,
			tags: input.tags ?? [],
			preferredContact: input.preferredContact ?? 'email'
		})
		.returning();
	return row;
}

export async function editCustomer(
	contractorId: string,
	id: string,
	input: CustomerDetailsInput
): Promise<CustomerRow> {
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
			notes: input.notes ?? null,
			tags: input.tags ?? [],
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
		.where(eq(order.contractorId, contractorId))
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
	const owned = await ownedCustomer(contractorId, input.customerId);
	if (!owned) throw new Error('Customer not found');
	const [row] = await db
		.insert(order)
		.values({
			contractorId,
			customerId: owned.id,
			projectName: input.projectName ?? null,
			projectType: input.projectType ?? null,
			state: input.state ?? 'Inquiry',
			// New orders get a default follow-up 3 days out.
			nextFollowUpAt: defaultFollowUp()
		})
		.returning();
	return row;
}

/** Set (or clear, with null) an order's next follow-up date. */
export async function setFollowUp(
	orderId: string,
	contractorId: string,
	date: Date | null
): Promise<void> {
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');
	await db.update(order).set({ nextFollowUpAt: date }).where(eq(order.id, orderId));
}

/** Set or clear (null) an order's construction icon. */
export async function setOrderIcon(
	orderId: string,
	contractorId: string,
	icon: string | null
): Promise<void> {
	const existing = await contractorOrder(orderId, contractorId);
	if (!existing) throw new Error('Order not found');
	await db.update(order).set({ icon }).where(eq(order.id, orderId));
}

/** Snooze an order's follow-up forward by a preset, from now. */
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
		.where(and(eq(order.id, orderId), eq(order.contractorId, contractorId)))
		.limit(1);
	return row;
}

export async function updateOrderState(
	orderId: string,
	contractorId: string,
	newState: ContractorOrderState,
	note?: string
): Promise<void> {
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
			detail: '',
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
			title: 'Note',
			detail: trimmedNote,
			authorRole: 'contractor',
			internal: true
		});
	}
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

/** Attachment listing shape — metadata only, never the blob. */
export type AttachmentMeta = {
	id: string;
	orderId: string;
	filename: string;
	mimeType: string;
	size: number;
	createdAt: Date;
};

export type OrderDetail = {
	order: ContractorOrderView;
	customer: CustomerRow | null;
	timeline: TimelineRow[];
	attachments: AttachmentMeta[];
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
		.where(and(eq(order.id, orderId), eq(order.contractorId, contractorId)))
		.limit(1);
	if (!row) return null;
	const [timeline, attachments] = await Promise.all([
		db
			.select()
			.from(timelineEntry)
			.where(eq(timelineEntry.orderId, orderId))
			.orderBy(desc(timelineEntry.createdAt)),
		listOrderAttachments(orderId, contractorId)
	]);
	return { order: toContractorView(row.order, row.customer), customer: row.customer, timeline, attachments };
}

/** Metadata for an order's attachments (no bytes), newest first. */
export function listOrderAttachments(
	orderId: string,
	contractorId: string
): Promise<AttachmentMeta[]> {
	return db
		.select({
			id: attachment.id,
			orderId: attachment.orderId,
			filename: attachment.filename,
			mimeType: attachment.mimeType,
			size: attachment.size,
			createdAt: attachment.createdAt
		})
		.from(attachment)
		.where(and(eq(attachment.orderId, orderId), eq(attachment.contractorId, contractorId)))
		.orderBy(desc(attachment.createdAt));
}

/** Store an uploaded file against an order the contractor owns. */
export async function addAttachment(
	orderId: string,
	contractorId: string,
	file: { filename: string; mimeType: string; size: number; data: Buffer }
): Promise<void> {
	const owned = await contractorOrder(orderId, contractorId);
	if (!owned) throw new Error('Order not found');
	await db.insert(attachment).values({
		orderId,
		contractorId,
		filename: file.filename,
		mimeType: file.mimeType,
		size: file.size,
		data: file.data
	});
}

/** Fetch one attachment (including its bytes) scoped to its owning contractor. */
export async function getAttachment(id: string, contractorId: string) {
	const [row] = await db
		.select()
		.from(attachment)
		.where(and(eq(attachment.id, id), eq(attachment.contractorId, contractorId)))
		.limit(1);
	return row ?? null;
}

/** Delete an attachment owned by the contractor. */
export async function deleteAttachment(id: string, contractorId: string): Promise<void> {
	await db
		.delete(attachment)
		.where(and(eq(attachment.id, id), eq(attachment.contractorId, contractorId)));
}

/** Append an internal, contractor-only note to an order's timeline. */
export async function addOrderNote(
	orderId: string,
	contractorId: string,
	detail: string
): Promise<void> {
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

/** Permanently delete an order (cascades its timeline, notifications, and invites). */
export async function deleteOrder(orderId: string, contractorId: string): Promise<void> {
	const owned = await contractorOrder(orderId, contractorId);
	if (!owned) throw new Error('Order not found');
	await db.delete(order).where(eq(order.id, orderId));
}

// ------------------------------------------------------------------ Customer portal

export type CustomerPortal = {
	active:
		| (OrderRow & { customerName: string; customerVisibleState: string; timeline: TimelineRow[] })
		| null;
	past: (OrderRow & { customerName: string; customerVisibleState: string })[];
};

export async function getCustomerPortal(userId: string): Promise<CustomerPortal> {
	const rows = await db
		.select()
		.from(order)
		.innerJoin(customer, eq(order.customerId, customer.id))
		.where(eq(customer.userId, userId))
		.orderBy(desc(order.updatedAt));

	const active = rows.find((r) => isActiveState(r.order.state as ContractorOrderState)) ?? null;
	const past = rows
		.filter((r) => r.order.id !== active?.order.id)
		.map((r) => ({
			...r.order,
			customerName: r.customer.name,
			customerVisibleState: getVisibleCustomerState(r.order.state as ContractorOrderState)
		}));

	if (!active) return { active: null, past };

	const timeline = await db
		.select()
		.from(timelineEntry)
		.where(and(eq(timelineEntry.orderId, active.order.id), eq(timelineEntry.internal, false)))
		.orderBy(desc(timelineEntry.createdAt));

	return {
		active: {
			...active.order,
			customerName: active.customer.name,
			customerVisibleState: getVisibleCustomerState(active.order.state as ContractorOrderState),
			timeline
		},
		past
	};
}

const REQUEST_TITLES: Record<
	'question' | 'service' | 'issue',
	{ title: string; kind: TimelineKind }
> = {
	question: { title: 'Question from customer', kind: 'message' },
	service: { title: 'Service request', kind: 'message' },
	issue: { title: 'Issue reported', kind: 'issue' }
};

export async function addCustomerRequest(
	orderId: string,
	account: { id: string },
	type: 'question' | 'service' | 'issue',
	detail: string
): Promise<void> {
	const [row] = await db
		.select({
			contractorId: order.contractorId,
			customerName: customer.name
		})
		.from(order)
		.innerJoin(customer, eq(order.customerId, customer.id))
		.where(and(eq(order.id, orderId), eq(customer.userId, account.id)))
		.limit(1);
	if (!row) throw new Error('Order not found');

	const meta = REQUEST_TITLES[type];
	await db.insert(timelineEntry).values({
		orderId,
		kind: meta.kind,
		title: meta.title,
		detail,
		authorRole: 'customer'
	});

	await createNotification({
		userId: row.contractorId,
		orderId,
		title: `${meta.title}: ${row.customerName}`,
		detail,
		priority: type === 'issue' ? 'high' : 'standard'
	});
}

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

/** Send an invite to one of the contractor's own customers (directory-level). */
export async function createInvite(contractorId: string, customerId: string): Promise<InviteRow> {
	const cust = await ownedCustomer(contractorId, customerId);
	if (!cust) throw new Error('Customer not found');
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
	await db
		.update(customerInvite)
		.set({ status: 'revoked' })
		.where(and(eq(customerInvite.id, inviteId), eq(customerInvite.contractorId, contractorId)));
}

/** Permanently delete an invite. */
export async function deleteInvite(inviteId: string, contractorId: string): Promise<void> {
	await db
		.delete(customerInvite)
		.where(and(eq(customerInvite.id, inviteId), eq(customerInvite.contractorId, contractorId)));
}
