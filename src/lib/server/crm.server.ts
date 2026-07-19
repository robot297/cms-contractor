import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from './db';
import { customerInvite, notification, order, timelineEntry } from './db/schema';
import {
	getVisibleCustomerState,
	isActiveState,
	type ContractorOrderState,
	type TimelineKind,
	type UserRole
} from '$lib/crm';
import { INVITE_TTL_MS } from '$lib/customer-invites';

export type OrderRow = typeof order.$inferSelect;
export type TimelineRow = typeof timelineEntry.$inferSelect;
export type NotificationRow = typeof notification.$inferSelect;
export type InviteRow = typeof customerInvite.$inferSelect;

export type ContractorOrderView = OrderRow & {
	customerVisibleState: string;
	needsAttention: boolean;
};

const ATTENTION_STATES: ReadonlySet<string> = new Set([
	'Inquiry',
	'Deposit Pending',
	'Final Payment Pending'
]);

function toContractorView(row: OrderRow): ContractorOrderView {
	return {
		...row,
		customerVisibleState: getVisibleCustomerState(row.state as ContractorOrderState),
		needsAttention: ATTENTION_STATES.has(row.state)
	};
}

// ---------------------------------------------------------------- Contractor

export async function listContractorOrders(contractorId: string): Promise<ContractorOrderView[]> {
	const rows = await db
		.select()
		.from(order)
		.where(eq(order.contractorId, contractorId))
		.orderBy(desc(order.updatedAt));
	return rows.map(toContractorView);
}

export async function createOrder(
	contractorId: string,
	input: { customerName: string; customerEmail: string; state?: ContractorOrderState }
): Promise<OrderRow> {
	const [row] = await db
		.insert(order)
		.values({
			contractorId,
			customerName: input.customerName,
			customerEmail: input.customerEmail.toLowerCase(),
			state: input.state ?? 'Inquiry'
		})
		.returning();
	return row;
}

/** Returns the order only if it belongs to the given contractor. */
async function contractorOrder(orderId: string, contractorId: string): Promise<OrderRow | undefined> {
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

	await db.update(order).set({ state: newState }).where(eq(order.id, orderId));

	const milestone = newState === 'Work Complete' || newState === 'Work Cancelled';
	await db.insert(timelineEntry).values({
		orderId,
		kind: milestone ? 'milestone' : 'status',
		title: newState,
		detail: note ?? '',
		authorRole: 'contractor'
	});

	// App-first notification to the customer, if they have an account linked.
	if (existing.customerId) {
		await createNotification({
			userId: existing.customerId,
			orderId,
			title: `Order update: ${getVisibleCustomerState(newState)}`,
			detail: note ?? '',
			priority: milestone ? 'high' : 'standard'
		});
	}
}

// ------------------------------------------------------------------ Customer

/**
 * Link a freshly-signed-in customer to any orders/invites created for their
 * email before they had an account, and mark those invites used.
 */
export async function linkCustomerByEmail(userId: string, email: string): Promise<void> {
	const normalized = email.toLowerCase();
	await db
		.update(order)
		.set({ customerId: userId })
		.where(and(eq(order.customerEmail, normalized), isNull(order.customerId)));
	await db
		.update(customerInvite)
		.set({ status: 'used' })
		.where(and(eq(customerInvite.customerEmail, normalized), eq(customerInvite.status, 'pending')));
}

export type CustomerPortal = {
	active: (OrderRow & { customerVisibleState: string; timeline: TimelineRow[] }) | null;
	past: (OrderRow & { customerVisibleState: string })[];
};

export async function getCustomerPortal(userId: string, email: string): Promise<CustomerPortal> {
	const rows = await db
		.select()
		.from(order)
		.where(or(eq(order.customerId, userId), eq(order.customerEmail, email.toLowerCase())))
		.orderBy(desc(order.updatedAt));

	const active = rows.find((r) => isActiveState(r.state as ContractorOrderState)) ?? null;
	const past = rows
		.filter((r) => r.id !== active?.id)
		.map((r) => ({
			...r,
			customerVisibleState: getVisibleCustomerState(r.state as ContractorOrderState)
		}));

	if (!active) return { active: null, past };

	const timeline = await db
		.select()
		.from(timelineEntry)
		.where(eq(timelineEntry.orderId, active.id))
		.orderBy(desc(timelineEntry.createdAt));

	return {
		active: {
			...active,
			customerVisibleState: getVisibleCustomerState(active.state as ContractorOrderState),
			timeline
		},
		past
	};
}

const REQUEST_TITLES: Record<'question' | 'service' | 'issue', { title: string; kind: TimelineKind }> =
	{
		question: { title: 'Question from customer', kind: 'message' },
		service: { title: 'Service request', kind: 'message' },
		issue: { title: 'Issue reported', kind: 'issue' }
	};

export async function addCustomerRequest(
	orderId: string,
	customer: { id: string; email: string },
	type: 'question' | 'service' | 'issue',
	detail: string
): Promise<void> {
	const [row] = await db
		.select()
		.from(order)
		.where(
			and(
				eq(order.id, orderId),
				or(eq(order.customerId, customer.id), eq(order.customerEmail, customer.email.toLowerCase()))
			)
		)
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

export async function createNotification(input: {
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

export async function createInvite(
	contractorId: string,
	orderId: string,
	customerEmail: string
): Promise<InviteRow> {
	const owned = await contractorOrder(orderId, contractorId);
	if (!owned) throw new Error('Order not found');
	const [row] = await db
		.insert(customerInvite)
		.values({
			contractorId,
			orderId,
			customerEmail: customerEmail.toLowerCase(),
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
