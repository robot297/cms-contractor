import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from './db';
import { customer, order, orderWorker, timelineEntry, worker } from './db/schema';
import { assertCanWrite } from './billing.server';
import { coversDay, type IsoDate, type Stint, type WorkerInput } from '$lib/worker';

/**
 * Crew — reading and writing who is on a job, and when.
 *
 * The subcontractor equivalents live in `subcontractor.server.ts` and are
 * deliberately not shared with these. The two look similar from a distance and
 * diverge everywhere that matters: a subcontractor assignment has to consider
 * access tier and portal visibility, and a worker assignment carries dates and
 * never grants anything. Merging them would mean every function taking a flag
 * and branching on it, which is how the tier checks would eventually run — or
 * fail to run — against people who have no tier.
 *
 * Workers are NOT trial-capped. `assertCanWrite` gates them (a lapsed
 * subscription still can't write) but there is no `assertCanCreate`: the caps
 * exist to bound how much *business* a free trial can run, and a crew is a
 * property of the contractor rather than of their book of work. Capping it would
 * mean telling somebody they may not record their own colleague's name.
 */

export type WorkerRow = typeof worker.$inferSelect;
export type OrderWorkerRow = typeof orderWorker.$inferSelect;

/** A crew member together with the stint they are on for a given job. */
export type AssignedWorker = WorkerRow & {
	startsOn: IsoDate | null;
	endsOn: IsoDate | null;
	/** What they are doing on THIS job, when it differs from their usual role. */
	jobRole: string | null;
	jobNotes: string | null;
};

export class WorkerNotFoundError extends Error {
	constructor() {
		super('Worker not found');
		this.name = 'WorkerNotFoundError';
	}
}

export class DuplicateWorkerEmailError extends Error {
	constructor() {
		super('You already have a crew member with this email');
		this.name = 'DuplicateWorkerEmailError';
	}
}

/** Returns the worker only if it belongs to this contractor. */
async function owned(contractorId: string, id: string): Promise<WorkerRow | undefined> {
	const [row] = await db
		.select()
		.from(worker)
		.where(and(eq(worker.id, id), eq(worker.contractorId, contractorId)))
		.limit(1);
	return row;
}

/** Confirms the order is this contractor's and not deleted. */
async function ownedOrder(contractorId: string, orderId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: order.id })
		.from(order)
		.where(
			and(eq(order.id, orderId), eq(order.contractorId, contractorId), isNull(order.deletedAt))
		)
		.limit(1);
	return Boolean(row);
}

// ------------------------------------------------------------------ directory

/** The contractor's active crew, A–Z. Archived people are excluded. */
export async function listWorkers(contractorId: string): Promise<WorkerRow[]> {
	return db
		.select()
		.from(worker)
		.where(and(eq(worker.contractorId, contractorId), isNull(worker.archivedAt)))
		.orderBy(asc(worker.name));
}

export async function createWorker(contractorId: string, input: WorkerInput): Promise<WorkerRow> {
	await assertCanWrite(contractorId);
	if (input.email) {
		const [clash] = await db
			.select({ id: worker.id })
			.from(worker)
			.where(and(eq(worker.contractorId, contractorId), eq(worker.email, input.email)))
			.limit(1);
		if (clash) throw new DuplicateWorkerEmailError();
	}
	const [row] = await db
		.insert(worker)
		.values({
			contractorId,
			name: input.name,
			email: input.email ?? null,
			phone: input.phone ?? null,
			role: input.role ?? null,
			company: input.company ?? null,
			notes: input.notes ?? null
		})
		.returning();
	return row;
}

export async function updateWorker(
	contractorId: string,
	id: string,
	input: WorkerInput
): Promise<WorkerRow> {
	await assertCanWrite(contractorId);
	const existing = await owned(contractorId, id);
	if (!existing) throw new WorkerNotFoundError();
	if (input.email && input.email !== existing.email) {
		const [clash] = await db
			.select({ id: worker.id })
			.from(worker)
			.where(and(eq(worker.contractorId, contractorId), eq(worker.email, input.email)))
			.limit(1);
		if (clash) throw new DuplicateWorkerEmailError();
	}
	const [row] = await db
		.update(worker)
		.set({
			name: input.name,
			email: input.email ?? null,
			phone: input.phone ?? null,
			role: input.role ?? null,
			company: input.company ?? null,
			notes: input.notes ?? null
		})
		.where(eq(worker.id, id))
		.returning();
	return row;
}

/**
 * Archive a crew member.
 *
 * Soft, never a delete. Their assignments stay attached to every job they worked,
 * so "who was on the Miller job in March" still answers correctly after somebody
 * leaves — which is most of the reason to record it in the first place.
 */
export async function archiveWorker(contractorId: string, id: string): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await owned(contractorId, id);
	if (!existing) throw new WorkerNotFoundError();
	await db.update(worker).set({ archivedAt: new Date() }).where(eq(worker.id, id));
}

export async function setWorkerAvatar(
	contractorId: string,
	id: string,
	avatar: string | null
): Promise<void> {
	await assertCanWrite(contractorId);
	const existing = await owned(contractorId, id);
	if (!existing) throw new WorkerNotFoundError();
	await db.update(worker).set({ avatar }).where(eq(worker.id, id));
}

/**
 * Create many crew members at once, from the contact-import review list.
 *
 * Tolerant, exactly as `importCustomers` is and for the same reason: the input
 * is somebody's address book, a few rows of it will be malformed or already
 * present, and neither is a reason to refuse the rest.
 */
export type WorkerImportSummary = {
	imported: number;
	duplicates: number;
	rejected: { name: string; message: string }[];
};

export async function importWorkers(
	contractorId: string,
	people: WorkerInput[]
): Promise<WorkerImportSummary> {
	const summary: WorkerImportSummary = { imported: 0, duplicates: 0, rejected: [] };
	for (const person of people) {
		try {
			await createWorker(contractorId, person);
			summary.imported++;
		} catch (err) {
			if (err instanceof DuplicateWorkerEmailError) {
				summary.duplicates++;
				continue;
			}
			summary.rejected.push({
				name: person.name,
				message: err instanceof Error ? err.message : 'Could not be added'
			});
		}
	}
	return summary;
}

// ----------------------------------------------------------------- assignment

/**
 * Put a crew member on a job, or update the stint of one already on it.
 *
 * An upsert rather than an insert, because assigning somebody already on the job
 * is far more likely to mean "change their dates" than "add them twice". The
 * timeline records which of the two actually happened.
 */
export async function assignWorker(
	contractorId: string,
	orderId: string,
	workerId: string,
	stint: Stint & { role?: string | null; notes?: string | null }
): Promise<void> {
	await assertCanWrite(contractorId);
	if (!(await ownedOrder(contractorId, orderId))) throw new Error('Order not found');
	const person = await owned(contractorId, workerId);
	if (!person) throw new WorkerNotFoundError();

	const [existing] = await db
		.select()
		.from(orderWorker)
		.where(and(eq(orderWorker.orderId, orderId), eq(orderWorker.workerId, workerId)))
		.limit(1);

	await db
		.insert(orderWorker)
		.values({
			orderId,
			workerId,
			startsOn: stint.startsOn,
			endsOn: stint.endsOn,
			role: stint.role ?? null,
			notes: stint.notes ?? null
		})
		.onConflictDoUpdate({
			target: [orderWorker.orderId, orderWorker.workerId],
			set: {
				startsOn: stint.startsOn,
				endsOn: stint.endsOn,
				role: stint.role ?? null,
				notes: stint.notes ?? null
			}
		});

	// Internal: the crew roster is the contractor's own business, not something
	// the customer portal shows. Same rule the subcontractor entries follow.
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'note',
		title: existing ? 'Crew dates changed' : 'Crew member added',
		detail: existing
			? `${person.name}: ${describe(stint)}`
			: `${person.name} put on this job — ${describe(stint)}`,
		authorRole: 'contractor',
		internal: true
	});
}

/** Plain-language dates for a timeline entry. */
function describe(stint: Stint): string {
	if (stint.startsOn && stint.endsOn) {
		return stint.startsOn === stint.endsOn
			? stint.startsOn
			: `${stint.startsOn} to ${stint.endsOn}`;
	}
	if (stint.startsOn) return `from ${stint.startsOn}`;
	if (stint.endsOn) return `until ${stint.endsOn}`;
	return 'no dates set';
}

export async function unassignWorker(
	contractorId: string,
	orderId: string,
	workerId: string
): Promise<void> {
	await assertCanWrite(contractorId);
	if (!(await ownedOrder(contractorId, orderId))) throw new Error('Order not found');
	const person = await owned(contractorId, workerId);
	const removed = await db
		.delete(orderWorker)
		.where(and(eq(orderWorker.orderId, orderId), eq(orderWorker.workerId, workerId)))
		.returning();
	// Wasn't on the job, so nothing happened worth recording.
	if (removed.length === 0) return;
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'note',
		title: 'Crew member removed',
		detail: `${person?.name ?? 'Crew member'} taken off this job`,
		authorRole: 'contractor',
		internal: true
	});
}

/**
 * The crew on one job.
 *
 * Ordered by start date with the undated last, so the list reads as a schedule
 * rather than as the order somebody happened to be added in. Archived people are
 * INCLUDED: they really did work this job, and dropping them would quietly
 * rewrite its history the day they leave.
 */
export async function listOrderWorkers(
	contractorId: string,
	orderId: string
): Promise<AssignedWorker[]> {
	if (!(await ownedOrder(contractorId, orderId))) return [];
	const rows = await db
		.select({ person: worker, link: orderWorker })
		.from(orderWorker)
		.innerJoin(worker, eq(orderWorker.workerId, worker.id))
		.where(eq(orderWorker.orderId, orderId))
		// NULLS LAST puts "no dates set" at the foot rather than the head, where
		// Postgres would otherwise sort them ascending.
		.orderBy(sql`${orderWorker.startsOn} asc nulls last`, asc(worker.name));

	return rows.map((r) => ({
		...r.person,
		startsOn: r.link.startsOn,
		endsOn: r.link.endsOn,
		jobRole: r.link.role,
		jobNotes: r.link.notes
	}));
}

export type WorkerJob = {
	orderId: string;
	projectName: string | null;
	customerName: string | null;
	state: string;
	startsOn: IsoDate | null;
	endsOn: IsoDate | null;
};

/** Every job a crew member is on, newest stint first. */
export async function listWorkerJobs(contractorId: string, workerId: string): Promise<WorkerJob[]> {
	const rows = await db
		.select({ ord: order, link: orderWorker, cust: customer })
		.from(orderWorker)
		.innerJoin(order, eq(orderWorker.orderId, order.id))
		.leftJoin(customer, eq(order.customerId, customer.id))
		.where(
			and(
				eq(orderWorker.workerId, workerId),
				eq(order.contractorId, contractorId),
				isNull(order.deletedAt)
			)
		)
		.orderBy(sql`${orderWorker.startsOn} desc nulls last`);

	return rows.map((r) => ({
		orderId: r.ord.id,
		projectName: r.ord.projectName,
		customerName: r.cust?.name ?? null,
		state: r.ord.state,
		startsOn: r.link.startsOn,
		endsOn: r.link.endsOn
	}));
}

/** How many jobs each of these crew members is currently on. */
export async function countJobsPerWorker(
	contractorId: string,
	workerIds: string[]
): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	if (workerIds.length === 0) return counts;
	const rows = await db
		.select({ workerId: orderWorker.workerId, n: sql<number>`count(*)::int` })
		.from(orderWorker)
		.innerJoin(order, eq(orderWorker.orderId, order.id))
		.where(
			and(
				inArray(orderWorker.workerId, workerIds),
				eq(order.contractorId, contractorId),
				isNull(order.deletedAt)
			)
		)
		.groupBy(orderWorker.workerId);
	for (const r of rows) counts.set(r.workerId, r.n);
	return counts;
}

export type OnSiteToday = {
	orderId: string;
	projectName: string | null;
	customerName: string | null;
	workers: { id: string; name: string; role: string | null; avatar: string | null }[];
};

/**
 * Who is on which job on a given day.
 *
 * The date is narrowed in SQL to the rows that could possibly match, then
 * confirmed with `coversDay` — the same function the UI uses — so the calendar
 * rule lives in exactly one place and cannot drift between the query and the
 * badge that renders its result.
 */
export async function onSite(contractorId: string, day: IsoDate): Promise<OnSiteToday[]> {
	const rows = await db
		.select({ ord: order, link: orderWorker, person: worker, cust: customer })
		.from(orderWorker)
		.innerJoin(order, eq(orderWorker.orderId, order.id))
		.innerJoin(worker, eq(orderWorker.workerId, worker.id))
		.leftJoin(customer, eq(order.customerId, customer.id))
		.where(
			and(
				eq(order.contractorId, contractorId),
				isNull(order.deletedAt),
				// An open end runs forever in that direction, so a null passes.
				or(isNull(orderWorker.startsOn), sql`${orderWorker.startsOn} <= ${day}`),
				or(isNull(orderWorker.endsOn), sql`${orderWorker.endsOn} >= ${day}`)
			)
		)
		.orderBy(asc(order.projectName), asc(worker.name));

	const byOrder = new Map<string, OnSiteToday>();
	for (const r of rows) {
		if (!coversDay({ startsOn: r.link.startsOn, endsOn: r.link.endsOn }, day)) continue;
		let entry = byOrder.get(r.ord.id);
		if (!entry) {
			entry = {
				orderId: r.ord.id,
				projectName: r.ord.projectName,
				customerName: r.cust?.name ?? null,
				workers: []
			};
			byOrder.set(r.ord.id, entry);
		}
		entry.workers.push({
			id: r.person.id,
			name: r.person.name,
			role: r.link.role ?? r.person.role,
			avatar: r.person.avatar
		});
	}
	return [...byOrder.values()];
}

/** Total crew rows, for the directory header. */
export async function countWorkers(contractorId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(worker)
		.where(and(eq(worker.contractorId, contractorId), isNull(worker.archivedAt)));
	return row?.n ?? 0;
}

/** Newest first — used by the dev fixture and nothing else yet. */
export async function recentWorkers(contractorId: string, limit = 5): Promise<WorkerRow[]> {
	return db
		.select()
		.from(worker)
		.where(and(eq(worker.contractorId, contractorId), isNull(worker.archivedAt)))
		.orderBy(desc(worker.createdAt))
		.limit(limit);
}
