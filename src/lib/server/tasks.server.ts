import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { customer, customerTask, order, timelineEntry } from './db/schema';
import { assertCanWrite } from './billing.server';
import type { CustomerTaskView, TaskCompleter, TaskInput } from '$lib/tasks';

/**
 * Tasks — the things a Contractor needs FROM a Customer.
 *
 * The rules that live here rather than in a route:
 *
 *   1. A Contractor may write tasks on their OWN orders only, and every write
 *      re-checks that rather than trusting an id off a form.
 *   2. A Customer may complete and re-open a task on an order that is theirs,
 *      and may do NOTHING else to it. They cannot write one, edit one, or delete
 *      one — a task is an ask FROM the contractor, and a customer who could
 *      author one would be filing work against somebody else's business.
 *   3. Completing writes to the Timeline, because a task going from outstanding
 *      to done is a thing that HAPPENED to the job, and the contractor should
 *      find out by looking at the job rather than by noticing an absence.
 *
 * The two callers reach the same rows by different routes — the contractor via
 * their id on the order, the customer via the customer record their portal
 * session resolves to — which is why the scoping lives in two small helpers
 * instead of one `orderId` argument everyone is trusted with.
 */

export class TaskNotFoundError extends Error {
	constructor(message = 'That task no longer exists') {
		super(message);
		this.name = 'TaskNotFoundError';
	}
}

function toView(row: typeof customerTask.$inferSelect): CustomerTaskView {
	return {
		id: row.id,
		title: row.title,
		detail: row.detail,
		dueOn: row.dueOn,
		blocking: row.blocking,
		completedAt: row.completedAt,
		completedBy: row.completedBy
	};
}

/** Every task on an order, outstanding first, then most recently finished. */
export async function listTasks(orderId: string): Promise<CustomerTaskView[]> {
	const rows = await db
		.select()
		.from(customerTask)
		.where(eq(customerTask.orderId, orderId))
		// Outstanding before done, and within each group the order they were
		// written. `completedAt` sorts nulls first ascending in Postgres only with
		// an explicit clause, so it is spelled out rather than assumed.
		.orderBy(sql`${customerTask.completedAt} asc nulls first`, asc(customerTask.createdAt));
	return rows.map(toView);
}

/** How many are still outstanding, for a batch of orders at once. */
export async function openTaskCounts(orderIds: string[]): Promise<Map<string, number>> {
	if (orderIds.length === 0) return new Map();
	const rows = await db
		.select({ orderId: customerTask.orderId, count: sql<number>`count(*)::int` })
		.from(customerTask)
		.where(and(isNull(customerTask.completedAt), inArray(customerTask.orderId, orderIds)))
		.groupBy(customerTask.orderId);
	return new Map(rows.map((r) => [r.orderId, r.count]));
}

/** The order, only if this contractor owns it. */
async function ownedOrder(orderId: string, contractorId: string) {
	const [row] = await db
		.select({ id: order.id })
		.from(order)
		.where(
			and(eq(order.id, orderId), eq(order.contractorId, contractorId), isNull(order.deletedAt))
		)
		.limit(1);
	return row;
}

/** The task, only if it hangs off an order this contractor owns. */
async function ownedTask(taskId: string, contractorId: string) {
	const [row] = await db
		.select({ task: customerTask })
		.from(customerTask)
		.innerJoin(order, eq(customerTask.orderId, order.id))
		.where(
			and(
				eq(customerTask.id, taskId),
				eq(order.contractorId, contractorId),
				isNull(order.deletedAt)
			)
		)
		.limit(1);
	return row?.task;
}

/**
 * The task, only if it hangs off an order belonging to this portal user.
 *
 * Scoped through `customer.user_id` rather than through a customer id handed in
 * by the browser — the customer's session says who they are, and an order id in
 * a form field says nothing about whose it is.
 */
async function portalTask(taskId: string, userId: string) {
	const [row] = await db
		.select({ task: customerTask })
		.from(customerTask)
		.innerJoin(order, eq(customerTask.orderId, order.id))
		.innerJoin(customer, eq(order.customerId, customer.id))
		.where(and(eq(customerTask.id, taskId), eq(customer.userId, userId), isNull(order.deletedAt)))
		.limit(1);
	return row?.task;
}

export async function createTask(
	contractorId: string,
	orderId: string,
	input: TaskInput
): Promise<CustomerTaskView> {
	await assertCanWrite(contractorId);
	if (!(await ownedOrder(orderId, contractorId))) throw new TaskNotFoundError('Order not found');

	const [row] = await db
		.insert(customerTask)
		.values({
			orderId,
			title: input.title,
			detail: input.detail,
			dueOn: input.dueOn,
			blocking: input.blocking
		})
		.returning();

	// On the Timeline, and NOT internal: the customer's history should record
	// having been asked, so "you never told me" has an answer that isn't a
	// screenshot of a chat.
	//
	// Worded so it reads right on BOTH surfaces. "Asked the customer: pick your
	// tile" is written from the contractor's chair and lands oddly in the
	// customer's own history, where they are the customer being talked about.
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'milestone',
		title: `Asked for: ${input.title}`,
		detail: input.detail,
		authorRole: 'contractor',
		internal: false
	});

	return toView(row);
}

export async function updateTask(
	contractorId: string,
	taskId: string,
	input: TaskInput
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await ownedTask(taskId, contractorId);
	if (!existing) throw new TaskNotFoundError();

	await db
		.update(customerTask)
		.set({
			title: input.title,
			detail: input.detail,
			dueOn: input.dueOn,
			blocking: input.blocking
		})
		.where(eq(customerTask.id, taskId));
}

/**
 * Take an ask back.
 *
 * A real delete rather than an archive, and deliberately: an ask the contractor
 * has withdrawn is not history, it is a thing they decided not to ask for. What
 * DID happen — that it was asked — is already on the Timeline and stays there.
 */
export async function deleteTask(contractorId: string, taskId: string): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await ownedTask(taskId, contractorId);
	if (!existing) throw new TaskNotFoundError();
	await db.delete(customerTask).where(eq(customerTask.id, taskId));
}

/**
 * Mark a task done, from either side.
 *
 * `by` is not decoration: a contractor ticking off "pay the deposit" because
 * cash changed hands on site, and a customer ticking it themselves, are
 * different events, and the Timeline says which one it was.
 *
 * Idempotent on purpose. Two taps on a phone, or the customer and the contractor
 * both closing it within the same minute, should not produce two Timeline
 * entries or move the completion time — the first answer stands.
 */
async function markDone(
	task: typeof customerTask.$inferSelect,
	by: TaskCompleter
): Promise<boolean> {
	if (task.completedAt != null) return false;
	await db
		.update(customerTask)
		.set({ completedAt: new Date(), completedBy: by })
		.where(and(eq(customerTask.id, task.id), isNull(customerTask.completedAt)));

	await db.insert(timelineEntry).values({
		orderId: task.orderId,
		kind: 'milestone',
		// Who did it is carried by `authorRole`, and the wording differs because the
		// two are genuinely different events: the customer saying it is done, and
		// the contractor recording that it is.
		title: by === 'customer' ? `Done: ${task.title}` : `Marked done: ${task.title}`,
		detail: '',
		authorRole: by,
		internal: false
	});
	return true;
}

export async function completeTaskAsContractor(
	contractorId: string,
	taskId: string
): Promise<void> {
	await assertCanWrite(contractorId);
	const task = await ownedTask(taskId, contractorId);
	if (!task) throw new TaskNotFoundError();
	await markDone(task, 'contractor');
}

/**
 * The customer's own tick.
 *
 * NOT billing-guarded, and that is the point: `assertCanWrite` gates what a
 * CONTRACTOR may do on their subscription, and a lapsed one must not turn their
 * customers' portals read-only. The customer is not the account holder and never
 * gets told about the account holder's billing.
 */
export async function completeTaskAsCustomer(userId: string, taskId: string): Promise<void> {
	const task = await portalTask(taskId, userId);
	if (!task) throw new TaskNotFoundError();
	await markDone(task, 'customer');
}

/** Put a task back to outstanding. Contractor only — see the module note. */
export async function reopenTask(contractorId: string, taskId: string): Promise<void> {
	await assertCanWrite(contractorId);
	const task = await ownedTask(taskId, contractorId);
	if (!task) throw new TaskNotFoundError();
	if (task.completedAt == null) return;
	await db
		.update(customerTask)
		.set({ completedAt: null, completedBy: null })
		.where(eq(customerTask.id, taskId));
}
