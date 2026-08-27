import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db } from './db';
import {
	customer,
	order,
	orderSubcontractor,
	orderWorker,
	subcontractor,
	worker
} from './db/schema';
import { assertCanWrite } from './billing.server';
import { coversDay, type IsoDate, type Stint } from '$lib/worker';
import {
	mergeDirectory,
	type Assignment,
	type DirectoryPerson,
	type Person,
	type PersonKind
} from '$lib/people';
import { isActiveState, type ContractorOrderState } from '$lib/crm';
import { assignWorker, unassignWorker, WorkerNotFoundError } from './worker.server';
import { assignSubcontractor, unassignSubcontractor } from './subcontractor.server';

/**
 * The one directory, and the one assignment list.
 *
 * Composes `worker.server` and `subcontractor.server` rather than replacing
 * them: the two record types genuinely differ in what they may do — only a
 * subcontractor can hold an access tier, insurance or a portal login — and
 * keeping them as two tables is what makes that structural instead of a
 * convention somebody has to remember. What was wrong before was the *surface*:
 * two nav entries and two search boxes for one question ("who is Dave, and is he
 * free Tuesday"). This module is the shared read model that fixes that.
 *
 * Every function here returns both kinds, tagged. Nothing infers a kind from the
 * shape of a row — it is carried explicitly, because a crew member whose `tier`
 * reads null and a subcontractor whose tier failed to load are the same value
 * and very much not the same fact.
 */

/** Everyone, both kinds, ordered by name. */
export async function listPeople(contractorId: string): Promise<Person[]> {
	const [crew, subs] = await Promise.all([
		db
			.select()
			.from(worker)
			.where(and(eq(worker.contractorId, contractorId), isNull(worker.archivedAt))),
		db
			.select()
			.from(subcontractor)
			.where(and(eq(subcontractor.contractorId, contractorId), isNull(subcontractor.archivedAt)))
	]);

	const counts = await jobCounts(
		contractorId,
		crew.map((c) => c.id),
		subs.map((s) => s.id)
	);

	const people: Person[] = [
		...crew.map((c) => ({
			id: c.id,
			kind: 'crew' as const,
			name: c.name,
			email: c.email,
			phone: c.phone,
			company: c.company,
			role: c.role,
			avatar: c.avatar,
			archived: c.archivedAt != null,
			// Null MEANS "cannot have one", not "not set yet". See $lib/people.
			tier: null,
			linked: false,
			jobCount: counts.crew.get(c.id) ?? 0
		})),
		...subs.map((s) => ({
			id: s.id,
			kind: 'sub' as const,
			name: s.name,
			email: s.email,
			phone: s.phone,
			company: s.company,
			// A sub's trade answers the same question a crew member's role does.
			role: s.trade,
			avatar: s.avatar,
			archived: s.archivedAt != null,
			tier: s.tier,
			linked: s.userId != null,
			jobCount: counts.sub.get(s.id) ?? 0
		}))
	];

	// One list, one ordering. Sorting by kind first would rebuild the split this
	// module exists to remove.
	return people.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The whole directory: customers, crew and subcontractors, woven into people.
 *
 * The read model `listPeople` is for assignment — it answers "who can I put on
 * this job", which customers are not. This one answers "who do I know", which
 * they are. Both compose the same tables rather than replacing them: the record
 * types differ in what they may DO (an Order points at a customer, an Assignment
 * at a crew/sub record, and only a subcontractor holds a tier or a portal login),
 * and that difference is worth keeping structural. What is woven here is
 * IDENTITY — see `mergeDirectory`, which is where the rule lives and where it is
 * tested.
 */
export async function listDirectory(contractorId: string): Promise<DirectoryPerson[]> {
	const [customers, crew, subs] = await Promise.all([
		db
			.select()
			.from(customer)
			.where(and(eq(customer.contractorId, contractorId), isNull(customer.archivedAt))),
		db
			.select()
			.from(worker)
			.where(and(eq(worker.contractorId, contractorId), isNull(worker.archivedAt))),
		db
			.select()
			.from(subcontractor)
			.where(and(eq(subcontractor.contractorId, contractorId), isNull(subcontractor.archivedAt)))
	]);

	const counts = await jobCounts(
		contractorId,
		crew.map((c) => c.id),
		subs.map((s) => s.id)
	);

	return mergeDirectory({
		// A customer record carries neither an on-site role nor a company — those
		// columns do not exist on it. Null here MEANS "this record cannot say",
		// which is what lets the merge fill both from a crew or sub record for the
		// same person without one of them overwriting the other with a blank.
		customers: customers.map((c) => ({ ...c, role: null, company: null })),
		crew,
		// A sub's trade answers the same question a crew member's role does, so the
		// merge sees one field. Same decision `listPeople` makes above.
		subs: subs.map((s) => ({ ...s, role: s.trade })),
		jobCounts: { crew: counts.crew, subs: counts.sub },
		customerJobs: await customerJobSummaries(contractorId)
	});
}

/**
 * What each customer has running, as one grouped query rather than a fold over
 * every order the contractor has ever had. The directory shows one phrase per
 * person; loading the orders themselves to count them would be loading the whole
 * job history to render a line of text.
 */
async function customerJobSummaries(
	contractorId: string
): Promise<Record<string, { active: number; total: number; latest: string | null }>> {
	const rows = await db
		.select({
			customerId: order.customerId,
			projectName: order.projectName,
			state: order.state,
			updatedAt: order.updatedAt
		})
		.from(order)
		.where(and(eq(order.contractorId, contractorId), isNull(order.deletedAt)))
		.orderBy(desc(order.updatedAt));

	const jobs: Record<string, { active: number; total: number; latest: string | null }> = {};
	for (const row of rows) {
		if (!row.customerId) continue;
		const entry = (jobs[row.customerId] ??= { active: 0, total: 0, latest: null });
		entry.total += 1;
		if (isActiveState(row.state as ContractorOrderState)) entry.active += 1;
		// Ordered newest-first, so the first one seen is the most recent.
		if (entry.latest === null) entry.latest = row.projectName;
	}
	return jobs;
}

/** How many live jobs each person is on, both kinds in one pass each. */
async function jobCounts(
	contractorId: string,
	crewIds: string[],
	subIds: string[]
): Promise<{ crew: Map<string, number>; sub: Map<string, number> }> {
	const crewCounts = new Map<string, number>();
	const subCounts = new Map<string, number>();

	const [crewRows, subRows] = await Promise.all([
		crewIds.length === 0
			? []
			: db
					.select({ id: orderWorker.workerId, n: sql<number>`count(*)::int` })
					.from(orderWorker)
					.innerJoin(order, eq(orderWorker.orderId, order.id))
					.where(
						and(
							inArray(orderWorker.workerId, crewIds),
							eq(order.contractorId, contractorId),
							isNull(order.deletedAt)
						)
					)
					.groupBy(orderWorker.workerId),
		subIds.length === 0
			? []
			: db
					.select({ id: orderSubcontractor.subcontractorId, n: sql<number>`count(*)::int` })
					.from(orderSubcontractor)
					.innerJoin(order, eq(orderSubcontractor.orderId, order.id))
					.where(
						and(
							inArray(orderSubcontractor.subcontractorId, subIds),
							eq(order.contractorId, contractorId),
							isNull(order.deletedAt)
						)
					)
					.groupBy(orderSubcontractor.subcontractorId)
	]);

	for (const r of crewRows) crewCounts.set(r.id, r.n);
	for (const r of subRows) subCounts.set(r.id, r.n);
	return { crew: crewCounts, sub: subCounts };
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

/**
 * Everyone on one job, both kinds, ordered as a schedule.
 *
 * Sorted by start date with the undated last, so the panel reads as "who is here
 * and when" rather than as the order people happened to be added in. Archived
 * people are INCLUDED: they really did work this job, and dropping them would
 * quietly rewrite its history the day somebody leaves.
 */
export async function listOrderPeople(
	contractorId: string,
	orderId: string
): Promise<Assignment[]> {
	if (!(await ownedOrder(contractorId, orderId))) return [];

	const [crew, subs] = await Promise.all([
		db
			.select({ person: worker, link: orderWorker })
			.from(orderWorker)
			.innerJoin(worker, eq(orderWorker.workerId, worker.id))
			.where(eq(orderWorker.orderId, orderId)),
		db
			.select({ person: subcontractor, link: orderSubcontractor })
			.from(orderSubcontractor)
			.innerJoin(subcontractor, eq(orderSubcontractor.subcontractorId, subcontractor.id))
			.where(eq(orderSubcontractor.orderId, orderId))
	]);

	const all: Assignment[] = [
		...crew.map((r) => ({
			id: r.person.id,
			kind: 'crew' as const,
			name: r.person.name,
			company: r.person.company,
			role: r.link.role ?? r.person.role,
			avatar: r.person.avatar,
			archived: r.person.archivedAt != null,
			startsOn: r.link.startsOn,
			endsOn: r.link.endsOn,
			jobRole: r.link.role,
			jobNotes: r.link.notes
		})),
		...subs.map((r) => ({
			id: r.person.id,
			kind: 'sub' as const,
			name: r.person.name,
			company: r.person.company,
			role: r.link.role ?? r.person.trade,
			avatar: r.person.avatar,
			archived: r.person.archivedAt != null,
			startsOn: r.link.startsOn,
			endsOn: r.link.endsOn,
			jobRole: r.link.role,
			jobNotes: r.link.notes
		}))
	];

	return all.sort((a, b) => {
		// Undated last. They are on the job but make no claim on the calendar, and
		// leading with them would push everything scheduled below the fold.
		if (!a.startsOn && b.startsOn) return 1;
		if (a.startsOn && !b.startsOn) return -1;
		if (a.startsOn && b.startsOn && a.startsOn !== b.startsOn)
			return a.startsOn < b.startsOn ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

/**
 * Put somebody on a job, or change the stint of somebody already on it.
 *
 * Dispatches on kind to the module that owns the record. Both underlying calls
 * are upserts and both write their own timeline entry, so this adds no rules of
 * its own — it exists so the order page has one action instead of two.
 */
export async function assignPerson(
	contractorId: string,
	orderId: string,
	kind: PersonKind,
	personId: string,
	stint: Stint & { role?: string | null; notes?: string | null }
): Promise<void> {
	if (kind === 'crew') {
		await assignWorker(contractorId, orderId, personId, stint);
		return;
	}
	await assignSubcontractor(contractorId, orderId, personId, stint);
}

export async function unassignPerson(
	contractorId: string,
	orderId: string,
	kind: PersonKind,
	personId: string
): Promise<void> {
	if (kind === 'crew') {
		await unassignWorker(contractorId, orderId, personId);
		return;
	}
	await unassignSubcontractor(contractorId, orderId, personId);
}

export type OnSiteJob = {
	orderId: string;
	projectName: string | null;
	customerName: string | null;
	people: { id: string; kind: PersonKind; name: string; avatar: string | null }[];
};

/**
 * Who is on which job on a given day, across both kinds.
 *
 * The date is narrowed in SQL to the rows that could possibly match, then
 * confirmed with `coversDay` — the same function the UI uses — so the calendar
 * rule lives in exactly one place and cannot drift between the query and the
 * badge that renders its result.
 */
export async function onSite(contractorId: string, day: IsoDate): Promise<OnSiteJob[]> {
	// Typed loosely on purpose: the two assignment tables have identical `date`
	// columns but Drizzle brands each with its own table name, so a signature
	// naming one of them rejects the other. `PgColumn` is the shared supertype,
	// and the SQL below only ever uses the column as a value to compare.
	const dateWindow = (starts: PgColumn, ends: PgColumn) =>
		and(
			// An open end runs forever in that direction, so a null passes.
			or(isNull(starts), sql`${starts} <= ${day}`),
			or(isNull(ends), sql`${ends} >= ${day}`)
		);

	const [crew, subs] = await Promise.all([
		db
			.select({ ord: order, link: orderWorker, person: worker, cust: customer })
			.from(orderWorker)
			.innerJoin(order, eq(orderWorker.orderId, order.id))
			.innerJoin(worker, eq(orderWorker.workerId, worker.id))
			.leftJoin(customer, eq(order.customerId, customer.id))
			.where(
				and(
					eq(order.contractorId, contractorId),
					isNull(order.deletedAt),
					dateWindow(orderWorker.startsOn, orderWorker.endsOn)
				)
			),
		db
			.select({ ord: order, link: orderSubcontractor, person: subcontractor, cust: customer })
			.from(orderSubcontractor)
			.innerJoin(order, eq(orderSubcontractor.orderId, order.id))
			.innerJoin(subcontractor, eq(orderSubcontractor.subcontractorId, subcontractor.id))
			.leftJoin(customer, eq(order.customerId, customer.id))
			.where(
				and(
					eq(order.contractorId, contractorId),
					isNull(order.deletedAt),
					dateWindow(orderSubcontractor.startsOn, orderSubcontractor.endsOn)
				)
			)
	]);

	const byOrder = new Map<string, OnSiteJob>();
	const add = (
		ord: typeof order.$inferSelect,
		cust: typeof customer.$inferSelect | null,
		link: { startsOn: string | null; endsOn: string | null },
		person: { id: string; name: string; avatar: string | null },
		kind: PersonKind
	) => {
		if (!coversDay({ startsOn: link.startsOn, endsOn: link.endsOn }, day)) return;
		let entry = byOrder.get(ord.id);
		if (!entry) {
			entry = {
				orderId: ord.id,
				projectName: ord.projectName,
				customerName: cust?.name ?? null,
				people: []
			};
			byOrder.set(ord.id, entry);
		}
		entry.people.push({ id: person.id, kind, name: person.name, avatar: person.avatar });
	};

	for (const r of crew) add(r.ord, r.cust, r.link, r.person, 'crew');
	for (const r of subs) add(r.ord, r.cust, r.link, r.person, 'sub');

	for (const entry of byOrder.values()) entry.people.sort((a, b) => a.name.localeCompare(b.name));
	return [...byOrder.values()].sort((a, b) =>
		(a.projectName ?? '').localeCompare(b.projectName ?? '')
	);
}

/** Re-exported so callers need one import for the whole feature. */
export { WorkerNotFoundError, assertCanWrite, asc };
