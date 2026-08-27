import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from './db';
import {
	customer,
	order,
	orderSubcontractor,
	subcontractor,
	subcontractorInvite,
	timelineEntry,
	user
} from './db/schema';
import {
	getVisibleCustomerState,
	isSubcontractorLinked,
	isValidAvatarDataUrl,
	normalizeEmail,
	type ContractorOrderState,
	type SubcontractorTier
} from '$lib/crm';
import { InvalidAvatarError } from './crm.server';
// Billing gate for contractor-initiated writes only. The subcontractor PORTAL
// functions further down this file (`subcontractorOrderView`, `addSubcontractorNote`,
// the invite-binding pair) are deliberately left
// unguarded: a lapsed contractor's subs keep working exactly as before. See
// docs/adr/0005-lapsing-never-reaches-customers.md.
import { assertCanCreate, assertCanWrite } from './billing.server';
import type { Stint } from '$lib/worker';

/** Plain-language dates for a timeline entry. Mirrors the crew equivalent. */
function describeStint(stint: Stint): string {
	if (stint.startsOn && stint.endsOn) {
		return stint.startsOn === stint.endsOn
			? stint.startsOn
			: `${stint.startsOn} to ${stint.endsOn}`;
	}
	if (stint.startsOn) return `from ${stint.startsOn}`;
	if (stint.endsOn) return `until ${stint.endsOn}`;
	return 'no dates set';
}

/** How long a subcontractor invite / magic link stays valid. */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export type SubcontractorRow = typeof subcontractor.$inferSelect;
export type SubInviteRow = typeof subcontractorInvite.$inferSelect;

/** Typed errors so route actions can render friendly messages. */
export class DuplicateSubcontractorEmailError extends Error {
	constructor() {
		super('You already have a subcontractor with this email');
		this.name = 'DuplicateSubcontractorEmailError';
	}
}
export class SubcontractorEmailLockedError extends Error {
	constructor() {
		super('This subcontractor has accepted an invite; their email can no longer be changed');
		this.name = 'SubcontractorEmailLockedError';
	}
}
export class SubcontractorAlreadyLinkedError extends Error {
	constructor() {
		super('This account is already linked to one of your subcontractors');
		this.name = 'SubcontractorAlreadyLinkedError';
	}
}
/** Raised when accepting a sub invite would give a User a second, conflicting role. */
export class RoleConflictError extends Error {
	constructor(existing: 'contractor' | 'customer') {
		super(
			existing === 'contractor'
				? 'This account is a contractor account and cannot also be a subcontractor.'
				: 'This account is already a customer and cannot also be a subcontractor.'
		);
		this.name = 'RoleConflictError';
	}
}
/** Raised when a Guest-tier subcontractor attempts a write. */
export class GuestWriteForbiddenError extends Error {
	constructor() {
		super('Guest contractors have read-only access to assigned jobs.');
		this.name = 'GuestWriteForbiddenError';
	}
}

export type SubcontractorDetailsInput = {
	name: string;
	email: string;
	phone?: string | null;
	address?: string | null;
	company?: string | null;
	trade?: string | null;
	tier?: SubcontractorTier;
	licenseNumber?: string | null;
	licenseExpiresAt?: Date | null;
	insuranceCarrier?: string | null;
	insuranceExpiresAt?: Date | null;
	notes?: string | null;
};

// ----------------------------------------------------------- Roster CRUD (§3.1)

export async function listSubcontractors(
	contractorId: string,
	search?: string
): Promise<SubcontractorRow[]> {
	const rows = await db
		.select()
		.from(subcontractor)
		.where(and(eq(subcontractor.contractorId, contractorId), isNull(subcontractor.archivedAt)))
		.orderBy(desc(subcontractor.updatedAt));
	const term = search?.trim().toLowerCase();
	if (!term) return rows;
	return rows.filter(
		(s) =>
			s.name.toLowerCase().includes(term) ||
			s.email.includes(term) ||
			(s.trade?.toLowerCase().includes(term) ?? false) ||
			(s.company?.toLowerCase().includes(term) ?? false)
	);
}

/** Returns the subcontractor only if it belongs to the given contractor. */
async function ownedSubcontractor(
	contractorId: string,
	id: string
): Promise<SubcontractorRow | undefined> {
	const [row] = await db
		.select()
		.from(subcontractor)
		.where(and(eq(subcontractor.id, id), eq(subcontractor.contractorId, contractorId)))
		.limit(1);
	return row;
}

export async function getSubcontractor(
	contractorId: string,
	id: string
): Promise<SubcontractorRow | null> {
	return (await ownedSubcontractor(contractorId, id)) ?? null;
}

export async function createSubcontractor(
	contractorId: string,
	input: SubcontractorDetailsInput
): Promise<SubcontractorRow> {
	await assertCanCreate(contractorId, 'subcontractor');
	const name = input.name.trim();
	const email = normalizeEmail(input.email);
	const [existing] = await db
		.select()
		.from(subcontractor)
		.where(and(eq(subcontractor.contractorId, contractorId), eq(subcontractor.email, email)))
		.limit(1);
	if (existing) throw new DuplicateSubcontractorEmailError();
	const [row] = await db
		.insert(subcontractor)
		.values({
			contractorId,
			name,
			email,
			phone: input.phone ?? null,
			address: input.address ?? null,
			company: input.company ?? null,
			trade: input.trade ?? null,
			tier: input.tier ?? 'guest',
			licenseNumber: input.licenseNumber ?? null,
			licenseExpiresAt: input.licenseExpiresAt ?? null,
			insuranceCarrier: input.insuranceCarrier ?? null,
			insuranceExpiresAt: input.insuranceExpiresAt ?? null,
			notes: input.notes ?? null
		})
		.returning();
	return row;
}

/**
 * Create many subcontractors at once, from the contact-import review list.
 *
 * Tolerant in the same way `importWorkers` is: the input is somebody's address
 * book, some of it is already on file or is not a person at all, and neither is
 * a reason to refuse the rest.
 *
 * What arrives is a name, an address and maybe a phone — never a trade, a tier
 * or insurance, because an address book does not carry those. So an imported
 * subcontractor lands at the default tier (`guest`, least privilege) with the
 * rest of the profile blank, and is finished on the subcontractor page. That is
 * the trade this makes: the record starts incomplete and visibly so, rather than
 * the import guessing at an access level on the contractor's behalf.
 */
export type SubcontractorImportSummary = {
	imported: number;
	duplicates: number;
	rejected: { name: string; message: string }[];
};

export async function importSubcontractors(
	contractorId: string,
	people: SubcontractorDetailsInput[]
): Promise<SubcontractorImportSummary> {
	const summary: SubcontractorImportSummary = { imported: 0, duplicates: 0, rejected: [] };
	for (const person of people) {
		try {
			await createSubcontractor(contractorId, person);
			summary.imported++;
		} catch (err) {
			if (err instanceof DuplicateSubcontractorEmailError) {
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

export async function editSubcontractor(
	contractorId: string,
	id: string,
	input: SubcontractorDetailsInput
): Promise<SubcontractorRow> {
	await assertCanWrite(contractorId);
	const current = await ownedSubcontractor(contractorId, id);
	if (!current) throw new Error('Subcontractor not found');
	const name = input.name.trim();
	const email = normalizeEmail(input.email);
	const emailChanged = email !== current.email;
	// A linked subcontractor's email is backed by a real login and is read-only.
	if (emailChanged && isSubcontractorLinked(current)) throw new SubcontractorEmailLockedError();
	if (emailChanged) {
		const [dupe] = await db
			.select()
			.from(subcontractor)
			.where(
				and(
					eq(subcontractor.contractorId, contractorId),
					eq(subcontractor.email, email),
					ne(subcontractor.id, id)
				)
			)
			.limit(1);
		if (dupe) throw new DuplicateSubcontractorEmailError();
	}
	const [row] = await db
		.update(subcontractor)
		.set({
			name,
			email: emailChanged ? email : current.email,
			phone: input.phone ?? null,
			address: input.address ?? null,
			company: input.company ?? null,
			trade: input.trade ?? null,
			tier: input.tier ?? current.tier,
			licenseNumber: input.licenseNumber ?? null,
			licenseExpiresAt: input.licenseExpiresAt ?? null,
			insuranceCarrier: input.insuranceCarrier ?? null,
			insuranceExpiresAt: input.insuranceExpiresAt ?? null,
			notes: input.notes ?? null
		})
		.where(eq(subcontractor.id, id))
		.returning();
	// Editing the email invalidates any pending invite so a stale magic link can't bind.
	if (emailChanged) {
		await db
			.update(subcontractorInvite)
			.set({ status: 'revoked' })
			.where(
				and(eq(subcontractorInvite.subcontractorId, id), eq(subcontractorInvite.status, 'pending'))
			);
	}
	return row;
}

/** Archive a subcontractor — always a soft-archive; assignment history is kept. */
export async function archiveSubcontractor(contractorId: string, id: string): Promise<void> {
	await assertCanWrite(contractorId);
	const current = await ownedSubcontractor(contractorId, id);
	if (!current) throw new Error('Subcontractor not found');
	await db.update(subcontractor).set({ archivedAt: new Date() }).where(eq(subcontractor.id, id));
}

// ----------------------------------------------- Tier & profile updates (§3.2)

export async function setSubcontractorTier(
	contractorId: string,
	id: string,
	tier: SubcontractorTier
): Promise<void> {
	await assertCanWrite(contractorId);
	const current = await ownedSubcontractor(contractorId, id);
	if (!current) throw new Error('Subcontractor not found');
	await db.update(subcontractor).set({ tier }).where(eq(subcontractor.id, id));
}

/** Set or clear (null) a subcontractor's avatar. Validates the data URL + size. */
export async function setSubcontractorAvatar(
	contractorId: string,
	id: string,
	dataUrl: string | null
): Promise<void> {
	await assertCanWrite(contractorId);
	const current = await ownedSubcontractor(contractorId, id);
	if (!current) throw new Error('Subcontractor not found');
	if (dataUrl !== null && !isValidAvatarDataUrl(dataUrl)) throw new InvalidAvatarError();
	await db.update(subcontractor).set({ avatar: dataUrl }).where(eq(subcontractor.id, id));
}

// -------------------------------------------------- Invite management (§3.3)

export type SubcontractorLinkStatus = 'linked' | 'invited' | 'unlinked';

/** Derive Linked / Invited / Unlinked from a sub row + its pending invites. */
export function subcontractorLinkStatus(
	sub: { userId: string | null },
	hasPendingInvite: boolean
): SubcontractorLinkStatus {
	if (isSubcontractorLinked(sub)) return 'linked';
	return hasPendingInvite ? 'invited' : 'unlinked';
}

export function listSubcontractorInvites(contractorId: string): Promise<SubInviteRow[]> {
	return db
		.select()
		.from(subcontractorInvite)
		.where(eq(subcontractorInvite.contractorId, contractorId))
		.orderBy(desc(subcontractorInvite.createdAt));
}

export async function createSubcontractorInvite(
	contractorId: string,
	subcontractorId: string
): Promise<SubInviteRow> {
	await assertCanWrite(contractorId);
	const sub = await ownedSubcontractor(contractorId, subcontractorId);
	if (!sub) throw new Error('Subcontractor not found');
	const [row] = await db
		.insert(subcontractorInvite)
		.values({
			contractorId,
			subcontractorId,
			subcontractorEmail: sub.email,
			token: crypto.randomUUID(),
			status: 'pending',
			expiresAt: new Date(Date.now() + INVITE_TTL_MS)
		})
		.returning();
	return row;
}

export async function resendSubcontractorInvite(
	inviteId: string,
	contractorId: string
): Promise<void> {
	await assertCanWrite(contractorId);
	await db
		.update(subcontractorInvite)
		.set({
			status: 'pending',
			token: crypto.randomUUID(),
			expiresAt: new Date(Date.now() + INVITE_TTL_MS)
		})
		.where(
			and(eq(subcontractorInvite.id, inviteId), eq(subcontractorInvite.contractorId, contractorId))
		);
}

export async function revokeSubcontractorInvite(
	inviteId: string,
	contractorId: string
): Promise<void> {
	await assertCanWrite(contractorId);
	await db
		.update(subcontractorInvite)
		.set({ status: 'revoked' })
		.where(
			and(eq(subcontractorInvite.id, inviteId), eq(subcontractorInvite.contractorId, contractorId))
		);
}

// -------------------------------------- Invite binding & role guard (§4.1/4.2)

/** The subcontractor a user is already linked to for a given contractor, if any. */
async function userLinkedSubcontractor(
	userId: string,
	contractorId: string
): Promise<SubcontractorRow | undefined> {
	const [row] = await db
		.select()
		.from(subcontractor)
		.where(and(eq(subcontractor.userId, userId), eq(subcontractor.contractorId, contractorId)))
		.limit(1);
	return row;
}

/**
 * Classify a User's established global role (ADR-0002: exactly one role per User).
 * A User is a Contractor if their role says so; a Customer if bound to any customer
 * record; a Subcontractor if bound to any subcontractor record; otherwise `none`
 * (a fresh login with the default role but no data yet — free to become a sub).
 */
async function establishedRole(
	userId: string
): Promise<'contractor' | 'customer' | 'subcontractor' | 'none'> {
	const [u] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
	if (u?.role === 'contractor') return 'contractor';
	const [asCustomer] = await db
		.select({ id: customer.id })
		.from(customer)
		.where(eq(customer.userId, userId))
		.limit(1);
	if (asCustomer) return 'customer';
	const [asSub] = await db
		.select({ id: subcontractor.id })
		.from(subcontractor)
		.where(eq(subcontractor.userId, userId))
		.limit(1);
	if (asSub) return 'subcontractor';
	return 'none';
}

/**
 * Enforce one-role-per-User before binding a subcontractor. Refuses a User who is
 * already a Contractor or Customer; a fresh User's role is promoted to
 * `subcontractor`. Same-role (already a subcontractor elsewhere) is allowed.
 */
async function guardRoleForSubBinding(userId: string): Promise<void> {
	const role = await establishedRole(userId);
	if (role === 'contractor') throw new RoleConflictError('contractor');
	if (role === 'customer') throw new RoleConflictError('customer');
}

async function bindSubToUser(sub: SubcontractorRow, userId: string): Promise<SubcontractorRow> {
	// Guard: a user may link to at most one subcontractor per contractor.
	const existing = await userLinkedSubcontractor(userId, sub.contractorId);
	if (existing && existing.id !== sub.id) throw new SubcontractorAlreadyLinkedError();
	const [linked] = await db
		.update(subcontractor)
		.set({ userId })
		.where(eq(subcontractor.id, sub.id))
		.returning();
	// Promote a fresh login to the subcontractor role (idempotent for existing subs).
	await db.update(user).set({ role: 'subcontractor' }).where(eq(user.id, userId));
	return linked;
}

/**
 * Bind a freshly-authenticated user to the subcontractor referenced by an invite
 * token, regardless of the email they authenticated with. Falls back to email
 * matching for token-less invites. Returns null on an invalid/expired/revoked
 * token. Throws RoleConflictError / SubcontractorAlreadyLinkedError on collisions.
 */
export async function bindSubcontractorInviteToken(
	userId: string,
	token: string
): Promise<SubcontractorRow | null> {
	const [invite] = await db
		.select()
		.from(subcontractorInvite)
		.where(eq(subcontractorInvite.token, token))
		.limit(1);
	if (!invite || invite.status !== 'pending' || invite.expiresAt.getTime() <= Date.now()) {
		return null;
	}
	await guardRoleForSubBinding(userId);
	if (!invite.subcontractorId) {
		await db
			.update(subcontractorInvite)
			.set({ status: 'used' })
			.where(eq(subcontractorInvite.id, invite.id));
		return bindSubcontractorByEmail(userId, invite.subcontractorEmail);
	}
	const [target] = await db
		.select()
		.from(subcontractor)
		.where(eq(subcontractor.id, invite.subcontractorId))
		.limit(1);
	if (!target) return null;
	const linked = await bindSubToUser(target, userId);
	await db
		.update(subcontractorInvite)
		.set({ status: 'used' })
		.where(eq(subcontractorInvite.id, invite.id));
	return linked;
}

/**
 * Fallback binding by email: link a signed-in user to unlinked subcontractor
 * records matching their email. Honors the role guard and one-sub-per-contractor
 * rule; silently skips conflicts so it is safe to call on every portal load.
 */
export async function bindSubcontractorByEmail(
	userId: string,
	email: string
): Promise<SubcontractorRow | null> {
	if ((await establishedRole(userId)) === 'contractor') return null;
	const [asCustomer] = await db
		.select({ id: customer.id })
		.from(customer)
		.where(eq(customer.userId, userId))
		.limit(1);
	if (asCustomer) return null;
	const normalized = normalizeEmail(email);
	const matches = await db
		.select()
		.from(subcontractor)
		.where(and(eq(subcontractor.email, normalized), isNull(subcontractor.userId)));
	let bound: SubcontractorRow | null = null;
	for (const s of matches) {
		if (await userLinkedSubcontractor(userId, s.contractorId)) continue;
		const [row] = await db
			.update(subcontractor)
			.set({ userId })
			.where(and(eq(subcontractor.id, s.id), isNull(subcontractor.userId)))
			.returning();
		if (row) {
			bound = row;
			await db.update(user).set({ role: 'subcontractor' }).where(eq(user.id, userId));
			await db
				.update(subcontractorInvite)
				.set({ status: 'used' })
				.where(
					and(
						eq(subcontractorInvite.subcontractorId, s.id),
						eq(subcontractorInvite.status, 'pending')
					)
				);
		}
	}
	return bound;
}

/** All subcontractor records a user is linked to (across contractors). */
export function subcontractorsForUser(userId: string): Promise<SubcontractorRow[]> {
	return db.select().from(subcontractor).where(eq(subcontractor.userId, userId));
}

// -------------------------------------------------- Assignment (§5.1 / §5.2)

/**
 * Put a subcontractor on an order, or change the stint of one already on it.
 *
 * An upsert rather than a plain insert since subs gained dates: assigning
 * somebody already on the job now far more often means "change their dates" than
 * "add them twice". `stint` is optional so the older call sites — which only
 * ever meant "put them on it" — keep working and leave the dates unset.
 */
export async function assignSubcontractor(
	contractorId: string,
	orderId: string,
	subcontractorId: string,
	stint: Stint & { role?: string | null; notes?: string | null } = {
		startsOn: null,
		endsOn: null
	}
): Promise<void> {
	await assertCanWrite(contractorId);
	const [ord] = await db
		.select({ id: order.id })
		.from(order)
		.where(
			and(eq(order.id, orderId), eq(order.contractorId, contractorId), isNull(order.deletedAt))
		)
		.limit(1);
	if (!ord) throw new Error('Order not found');
	const sub = await ownedSubcontractor(contractorId, subcontractorId);
	if (!sub) throw new Error('Subcontractor not found');
	const [existing] = await db
		.select({ orderId: orderSubcontractor.orderId })
		.from(orderSubcontractor)
		.where(
			and(
				eq(orderSubcontractor.orderId, orderId),
				eq(orderSubcontractor.subcontractorId, subcontractorId)
			)
		)
		.limit(1);

	await db
		.insert(orderSubcontractor)
		.values({
			orderId,
			subcontractorId,
			startsOn: stint.startsOn,
			endsOn: stint.endsOn,
			role: stint.role ?? null,
			notes: stint.notes ?? null
		})
		.onConflictDoUpdate({
			target: [orderSubcontractor.orderId, orderSubcontractor.subcontractorId],
			set: {
				startsOn: stint.startsOn,
				endsOn: stint.endsOn,
				role: stint.role ?? null,
				notes: stint.notes ?? null
			}
		});

	await db.insert(timelineEntry).values({
		orderId,
		kind: 'note',
		title: existing ? 'Subcontractor dates changed' : 'Subcontractor added',
		detail: existing
			? `${sub.name}: ${describeStint(stint)}`
			: `${sub.name} put on this job — ${describeStint(stint)}`,
		authorRole: 'contractor',
		internal: true
	});
}

export async function unassignSubcontractor(
	contractorId: string,
	orderId: string,
	subcontractorId: string
): Promise<void> {
	await assertCanWrite(contractorId);
	// Scope the delete to the contractor by confirming ownership of the order first.
	const [ord] = await db
		.select({ id: order.id })
		.from(order)
		.where(
			and(eq(order.id, orderId), eq(order.contractorId, contractorId), isNull(order.deletedAt))
		)
		.limit(1);
	if (!ord) throw new Error('Order not found');
	const sub = await ownedSubcontractor(contractorId, subcontractorId);
	const removed = await db
		.delete(orderSubcontractor)
		.where(
			and(
				eq(orderSubcontractor.orderId, orderId),
				eq(orderSubcontractor.subcontractorId, subcontractorId)
			)
		)
		.returning();
	// Wasn't on the job to begin with, so nothing happened worth recording.
	if (removed.length === 0) return;
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'note',
		title: 'Subcontractor removed',
		detail: `${sub?.name ?? 'Subcontractor'} taken off this job`,
		authorRole: 'contractor',
		internal: true
	});
}

/** Subcontractors currently assigned to one of the contractor's orders. */
export async function listOrderSubcontractors(
	contractorId: string,
	orderId: string
): Promise<SubcontractorRow[]> {
	const [ord] = await db
		.select({ id: order.id })
		.from(order)
		.where(
			and(eq(order.id, orderId), eq(order.contractorId, contractorId), isNull(order.deletedAt))
		)
		.limit(1);
	if (!ord) return [];
	const rows = await db
		.select({ sub: subcontractor })
		.from(orderSubcontractor)
		.innerJoin(subcontractor, eq(orderSubcontractor.subcontractorId, subcontractor.id))
		.where(eq(orderSubcontractor.orderId, orderId))
		.orderBy(desc(orderSubcontractor.assignedAt));
	return rows.map((r) => r.sub);
}

export type AssignedOrderSummary = {
	id: string;
	projectName: string | null;
	projectType: string | null;
	state: string;
	customerVisibleState: string;
};

/** Orders a given subcontractor (owned by the contractor) is assigned to. */
export async function listSubcontractorOrders(
	contractorId: string,
	subcontractorId: string
): Promise<AssignedOrderSummary[]> {
	const sub = await ownedSubcontractor(contractorId, subcontractorId);
	if (!sub) return [];
	const rows = await db
		.select({ order })
		.from(orderSubcontractor)
		.innerJoin(order, eq(orderSubcontractor.orderId, order.id))
		.where(and(eq(orderSubcontractor.subcontractorId, subcontractorId), isNull(order.deletedAt)))
		.orderBy(desc(order.updatedAt));
	return rows.map((r) => ({
		id: r.order.id,
		projectName: r.order.projectName,
		projectType: r.order.projectType,
		state: r.order.state,
		customerVisibleState: getVisibleCustomerState(r.order.state as ContractorOrderState)
	}));
}

// --------------------------------------- Tier-scoped portal views (§5.3, §8)

export type PortalOrderSummary = AssignedOrderSummary & {
	customerName: string | null; // present only for Trusted
};

/**
 * The signed-in subcontractor's assigned orders, tier-gated. For a Guest the
 * customer name is withheld (redacted server-side, never sent to the client).
 * Returns null when the user is not linked to any subcontractor record.
 */
export async function listAssignedOrdersForUser(
	userId: string
): Promise<{ tier: SubcontractorTier; orders: PortalOrderSummary[] } | null> {
	const subs = await subcontractorsForUser(userId);
	if (subs.length === 0) return null;
	const subIds = subs.map((s) => s.id);
	// Tier is per-sub; a user linked under one contractor has one sub row, but we
	// support several by tagging each order with its own sub's tier at read time.
	const tierBySubId = new Map(subs.map((s) => [s.id, s.tier as SubcontractorTier]));
	const rows = await db
		.select({ order, customer, subId: orderSubcontractor.subcontractorId })
		.from(orderSubcontractor)
		.innerJoin(order, eq(orderSubcontractor.orderId, order.id))
		.leftJoin(customer, eq(order.customerId, customer.id))
		.where(and(inArray(orderSubcontractor.subcontractorId, subIds), isNull(order.deletedAt)))
		.orderBy(desc(order.updatedAt));
	const orders: PortalOrderSummary[] = rows.map((r) => {
		const tier = tierBySubId.get(r.subId) ?? 'guest';
		return {
			id: r.order.id,
			projectName: r.order.projectName,
			projectType: r.order.projectType,
			state: r.order.state,
			customerVisibleState: getVisibleCustomerState(r.order.state as ContractorOrderState),
			customerName: tier === 'trusted' ? (r.customer?.name ?? null) : null
		};
	});
	// A user's overall portal tier is the highest tier they hold anywhere.
	const tier: SubcontractorTier = subs.some((s) => s.tier === 'trusted') ? 'trusted' : 'guest';
	return { tier, orders };
}

export type SubOrderTimelineEntry = {
	id: string;
	kind: string;
	title: string;
	detail: string;
	authorRole: string;
	createdAt: Date;
};

export type SubOrderView = {
	id: string;
	projectName: string | null;
	projectType: string | null;
	state: string;
	customerVisibleState: string;
	tier: SubcontractorTier;
	canWrite: boolean;
	// Full customer contact for Trusted; a fully-redacted stub for Guest.
	customer: { name: string; email: string; phone: string | null; address: string | null } | null;
	timeline: SubOrderTimelineEntry[];
};

/**
 * The link between a user and a specific assigned order: which of the user's sub
 * records is assigned to it (and thus the governing tier). Null if not assigned.
 */
async function assignedSubForUserOrder(
	userId: string,
	orderId: string
): Promise<SubcontractorRow | null> {
	const [row] = await db
		.select({ sub: subcontractor })
		.from(orderSubcontractor)
		.innerJoin(subcontractor, eq(orderSubcontractor.subcontractorId, subcontractor.id))
		.where(and(eq(orderSubcontractor.orderId, orderId), eq(subcontractor.userId, userId)))
		.limit(1);
	return row?.sub ?? null;
}

/**
 * A single assigned order for the signed-in subcontractor, tier-scoped. Guest
 * views have the customer contact block redacted **here on the server**, so PII
 * never reaches the Guest's client. Returns null when the user is not assigned.
 */
export async function subcontractorOrderView(
	userId: string,
	orderId: string
): Promise<SubOrderView | null> {
	const sub = await assignedSubForUserOrder(userId, orderId);
	if (!sub) return null;
	const [row] = await db
		.select({ order, customer })
		.from(order)
		.leftJoin(customer, eq(order.customerId, customer.id))
		.where(and(eq(order.id, orderId), isNull(order.deletedAt)))
		.limit(1);
	if (!row) return null;
	const tier = sub.tier as SubcontractorTier;
	// The work timeline both tiers see: no contractor-internal notes.
	const timeline = await db
		.select()
		.from(timelineEntry)
		.where(and(eq(timelineEntry.orderId, orderId), eq(timelineEntry.internal, false)))
		.orderBy(desc(timelineEntry.createdAt));

	// Customer contact details reach a Trusted subcontractor and nobody else. A
	// Guest gets null, assembled here on the server, so the PII is never in the
	// payload rather than merely unrendered by the client.
	//
	// The guest branch used to call `redactCustomerForGuest()` and throw the result
	// away before assigning null separately, which read as though the call were
	// doing the redacting. It takes no arguments and returns a fixed all-null stub,
	// so it was a no-op — the `null` below was always what dropped the PII.
	const customerBlock: SubOrderView['customer'] =
		tier === 'trusted' && row.customer
			? {
					name: row.customer.name,
					email: row.customer.email,
					phone: row.customer.phone,
					address: row.customer.address
				}
			: null;

	return {
		id: row.order.id,
		projectName: row.order.projectName,
		projectType: row.order.projectType,
		state: row.order.state,
		customerVisibleState: getVisibleCustomerState(row.order.state as ContractorOrderState),
		tier,
		canWrite: tier === 'trusted',
		customer: customerBlock,
		timeline: timeline.map((t) => ({
			id: t.id,
			kind: t.kind,
			title: t.title,
			detail: t.detail,
			authorRole: t.authorRole,
			createdAt: t.createdAt
		}))
	};
}

// ------------------------------- Tier-gated portal writes (§8.3, Trusted only)

/** Add a timeline note to an assigned order as the subcontractor (Trusted only). */
export async function addSubcontractorNote(
	userId: string,
	orderId: string,
	detail: string
): Promise<void> {
	const sub = await assignedSubForUserOrder(userId, orderId);
	if (!sub) throw new Error('Order not found');
	if ((sub.tier as SubcontractorTier) !== 'trusted') throw new GuestWriteForbiddenError();
	const trimmed = detail.trim();
	if (!trimmed) return;
	await db.insert(timelineEntry).values({
		orderId,
		kind: 'note',
		title: `Update from ${sub.name}`,
		detail: trimmed,
		authorRole: 'subcontractor',
		internal: false
	});
}

/**
 * A subcontractor's job photos are Documents, uploaded through
 * `documents.server.ts` like everyone else's. Tier is still what decides whether
 * they may write one — `orderAccess` reads it from this module's `subcontractor`
 * row and reports `canWrite: false` for a Guest, which is the same rule this
 * function used to apply on its own.
 */
