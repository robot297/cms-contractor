import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from './db';
import { customer, notification, order, orderMessage, user } from './db/schema';
import { messageTopicLabel, normalizeMessageTopic, type MessageTopic } from '$lib/crm';
// Billing gate. Applied to the CONTRACTOR side of a thread only — see
// `sendMessage` and docs/adr/0005-lapsing-never-reaches-customers.md.
import { assertCanWrite } from './billing.server';
// A contractor's reply is one of the three things that mean "they have been in
// touch"; the other two live beside their own writes in crm.server.
import { bumpFollowUpAfterContact } from './crm.server';

/**
 * The conversation on an order.
 *
 * Both ends of a thread — the customer's portal and the contractor's order
 * workspace — go through this module, and every function authorizes from the
 * `Viewer` it is handed rather than trusting the surface that called it. That is
 * the point of the module: two routes with two copies of the access rule drift,
 * and the one that drifts is the one that leaks another contractor's job.
 *
 * A message is NOT a timeline entry. The timeline records what happened to the
 * job; a thread records what was said about it. See the `order_message` table.
 */

export type MessageRow = typeof orderMessage.$inferSelect;

/** Who is reading or writing. Every entry point takes one and trusts nothing else. */
export type Viewer = { role: 'contractor'; userId: string } | { role: 'customer'; userId: string };

/** Thrown when a send is refused for an empty body. */
export class EmptyMessageError extends Error {
	constructor() {
		super('Message cannot be empty');
		this.name = 'EmptyMessageError';
	}
}

/** Thrown when the viewer may not read or write this order's thread. */
export class ThreadForbiddenError extends Error {
	constructor() {
		super('You do not have access to this conversation');
		this.name = 'ThreadForbiddenError';
	}
}

/**
 * Trim and validate a message body. Pure, so the rule is testable without a
 * database and identical on both ends.
 */
export function normalizeMessageBody(body: string): string {
	const trimmed = body.trim();
	if (!trimmed) throw new EmptyMessageError();
	return trimmed;
}

/**
 * The read column belonging to a side. Read state is per-side because "unread"
 * is asymmetric: a message is read by its author the instant it is written and
 * unread by whoever it was sent to.
 */
export function readColumnFor(role: Viewer['role']) {
	return role === 'contractor' ? orderMessage.readByContractorAt : orderMessage.readByCustomerAt;
}

/** The other side of a thread from the given role. */
export function counterpartOf(role: Viewer['role']): Viewer['role'] {
	return role === 'contractor' ? 'customer' : 'contractor';
}

type AuthorizedOrder = {
	orderId: string;
	contractorId: string;
	customerId: string;
	customerName: string;
	/** The customer's linked login, or null while the customer is Unlinked. */
	customerUserId: string | null;
};

/**
 * Resolve the order for this viewer, or null when they may not touch it.
 *
 * A contractor viewer must own the order; a customer viewer must be linked to
 * the order's customer record. Deleted orders are invisible to both.
 */
async function authorizeViewer(orderId: string, viewer: Viewer): Promise<AuthorizedOrder | null> {
	const [row] = await db
		.select({
			orderId: order.id,
			contractorId: order.contractorId,
			customerId: customer.id,
			customerName: customer.name,
			customerUserId: customer.userId
		})
		.from(order)
		.innerJoin(customer, eq(order.customerId, customer.id))
		.where(
			and(
				eq(order.id, orderId),
				isNull(order.deletedAt),
				viewer.role === 'contractor'
					? eq(order.contractorId, viewer.userId)
					: eq(customer.userId, viewer.userId)
			)
		)
		.limit(1);
	return row ?? null;
}

/** The thread on an order, oldest first. Null when the viewer may not read it. */
export async function getThread(orderId: string, viewer: Viewer): Promise<MessageRow[] | null> {
	const authorized = await authorizeViewer(orderId, viewer);
	if (!authorized) return null;
	return db
		.select()
		.from(orderMessage)
		.where(eq(orderMessage.orderId, orderId))
		.orderBy(asc(orderMessage.createdAt));
}

/**
 * Post a message to an order's thread and notify the other side.
 *
 * The billing guard runs for a contractor and NEVER for a customer. A portal
 * that swallowed a customer's question because their contractor's card failed
 * is exactly the hostage-taking ADR-0005 forbids — the customer is not the one
 * who didn't pay.
 */
export async function sendMessage(
	orderId: string,
	viewer: Viewer,
	body: string,
	topic: MessageTopic | string = 'general'
): Promise<MessageRow> {
	const trimmed = normalizeMessageBody(body);
	// A contractor's reply is always `general`: the topic describes what the
	// customer asked, and carrying it onto the answer would double-count it in
	// any triage view.
	const kind = viewer.role === 'customer' ? normalizeMessageTopic(String(topic)) : 'general';
	const authorized = await authorizeViewer(orderId, viewer);
	if (!authorized) throw new ThreadForbiddenError();

	if (viewer.role === 'contractor') await assertCanWrite(authorized.contractorId);

	const now = new Date();
	const [row] = await db
		.insert(orderMessage)
		.values({
			orderId,
			authorRole: viewer.role,
			authorUserId: viewer.userId,
			topic: kind,
			body: trimmed,
			// Stamped for the author's own side on insert, so a message is never
			// unread to the person who just wrote it.
			readByContractorAt: viewer.role === 'contractor' ? now : null,
			readByCustomerAt: viewer.role === 'customer' ? now : null
		})
		.returning();

	// Notify the other side. A contractor's reply on an Unlinked customer has
	// nobody to notify — that is not an error, the message simply waits.
	const recipientId =
		viewer.role === 'customer' ? authorized.contractorId : authorized.customerUserId;
	if (recipientId) {
		await db.insert(notification).values({
			userId: recipientId,
			orderId,
			title:
				viewer.role === 'customer'
					? `${messageTopicLabel(kind)} from ${authorized.customerName}`
					: 'New message from your contractor',
			// A reported problem is what a contractor most needs to see first.
			priority: kind === 'issue' ? 'high' : 'standard',
			detail: trimmed
		});
	}

	// The contractor answering restarts their own follow-up clock. The customer
	// writing in does NOT — that is the case a follow-up is FOR, and pushing the
	// date out because they asked a question would hide the very job that most
	// needs attention.
	if (viewer.role === 'contractor') {
		await bumpFollowUpAfterContact(orderId, authorized.contractorId);
	}

	return row;
}

/**
 * Mark the other side's messages as read for this viewer. Only the counterpart's
 * messages move: reading your own side was never pending, and marking one side
 * read must not clear the other's.
 */
export async function markThreadRead(orderId: string, viewer: Viewer): Promise<void> {
	const authorized = await authorizeViewer(orderId, viewer);
	if (!authorized) return;
	const now = new Date();
	await db
		.update(orderMessage)
		.set(viewer.role === 'contractor' ? { readByContractorAt: now } : { readByCustomerAt: now })
		.where(
			and(
				eq(orderMessage.orderId, orderId),
				ne(orderMessage.authorRole, viewer.role),
				isNull(readColumnFor(viewer.role))
			)
		);
}

/**
 * A thread where the OTHER side spoke last — that is, one you owe an answer.
 *
 * Deliberately not based on unread state, which is what the first version of
 * this used and why it did not work. Opening an order calls `markThreadRead`, so
 * merely LOOKING at a message consumed the only record that it needed a reply:
 * glance at a job to check something, and the dashboard quietly forgot a
 * customer was waiting. Reading is not answering.
 *
 * "Who spoke last" has none of that fragility. It survives reading, re-reading
 * and navigating away, and it clears on exactly one action — replying — which is
 * the action it exists to prompt.
 */
export type AwaitingReply = {
	orderId: string;
	projectName: string | null;
	otherName: string;
	/** The most recent thing they said, for a preview. */
	preview: string;
	/** How many they have sent since your last reply. */
	pending: number;
	lastAt: Date;
};

/** One message, reduced to what deciding "who spoke last" needs. */
type ThreadRow = {
	orderId: string;
	projectName: string | null;
	otherName: string | null;
	authorRole: string;
	body: string;
	createdAt: Date;
};

/**
 * Collapse newest-first messages into one entry per order, keeping only the
 * orders whose newest message came from the other side.
 *
 * Pure, so the rule can be tested without a database — which matters here
 * because the rule, not the query, is what was wrong last time.
 *
 * `rows` MUST be newest-first. The first row for an order decides whether it is
 * awaiting a reply at all; the run of consecutive counterpart messages after it
 * is how many they have sent since you last said anything.
 */
export function threadsAwaitingReply(
	rows: ThreadRow[],
	viewerRole: Viewer['role'],
	fallbackName: string
): AwaitingReply[] {
	const byOrder = new Map<string, AwaitingReply>();
	// Orders already resolved: either counted, or dismissed because the viewer
	// spoke last. Both stop us looking at older messages on that order.
	const settled = new Set<string>();

	for (const r of rows) {
		if (settled.has(r.orderId)) continue;
		const mine = r.authorRole === viewerRole;
		const entry = byOrder.get(r.orderId);

		if (!entry) {
			// First (newest) message on this order. If it is mine, the ball is in
			// their court and this order is done with.
			if (mine) {
				settled.add(r.orderId);
				continue;
			}
			byOrder.set(r.orderId, {
				orderId: r.orderId,
				projectName: r.projectName,
				otherName: r.otherName ?? fallbackName,
				preview: r.body,
				pending: 1,
				lastAt: r.createdAt
			});
			continue;
		}

		// Still walking back through their run. My own message ends it.
		if (mine) settled.add(r.orderId);
		else entry.pending += 1;
	}

	return [...byOrder.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

/**
 * Every message on the given orders, grouped by order and oldest-first.
 *
 * One query rather than one per order: the dashboard shows a handful of jobs and
 * needs the conversation on each of them, and N round trips to render one screen
 * is how a dashboard becomes the slowest page in an app.
 *
 * Ownership is NOT checked here — callers pass ids they have already established
 * belong to the viewer. Kept explicit because that is the kind of assumption that
 * quietly becomes false.
 */
export async function threadsForOrders(orderIds: string[]): Promise<Map<string, MessageRow[]>> {
	const byOrder = new Map<string, MessageRow[]>();
	if (orderIds.length === 0) return byOrder;
	const rows = await db
		.select()
		.from(orderMessage)
		.where(inArray(orderMessage.orderId, orderIds))
		.orderBy(orderMessage.createdAt);
	for (const row of rows) {
		const thread = byOrder.get(row.orderId);
		if (thread) thread.push(row);
		else byOrder.set(row.orderId, [row]);
	}
	return byOrder;
}

/** Threads where a customer is waiting on this contractor. */
export async function awaitingReplyForContractor(contractorId: string): Promise<AwaitingReply[]> {
	const rows = await db
		.select({
			orderId: orderMessage.orderId,
			projectName: order.projectName,
			otherName: customer.name,
			authorRole: orderMessage.authorRole,
			body: orderMessage.body,
			createdAt: orderMessage.createdAt
		})
		.from(orderMessage)
		.innerJoin(order, eq(orderMessage.orderId, order.id))
		.leftJoin(customer, eq(order.customerId, customer.id))
		.where(and(eq(order.contractorId, contractorId), isNull(order.deletedAt)))
		.orderBy(desc(orderMessage.createdAt));
	return threadsAwaitingReply(rows, 'contractor', 'your customer');
}

/** Threads where this customer is the one who owes an answer. */
export async function awaitingReplyForCustomer(userId: string): Promise<AwaitingReply[]> {
	const rows = await db
		.select({
			orderId: orderMessage.orderId,
			projectName: order.projectName,
			otherName: user.name,
			authorRole: orderMessage.authorRole,
			body: orderMessage.body,
			createdAt: orderMessage.createdAt
		})
		.from(orderMessage)
		.innerJoin(order, eq(orderMessage.orderId, order.id))
		.innerJoin(customer, eq(order.customerId, customer.id))
		.innerJoin(user, eq(order.contractorId, user.id))
		.where(and(eq(customer.userId, userId), isNull(order.deletedAt)))
		.orderBy(desc(orderMessage.createdAt));
	return threadsAwaitingReply(rows, 'customer', 'your contractor');
}
