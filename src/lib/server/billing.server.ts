import { and, count, eq, isNull } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { ENV } from 'varlock/env';
import { db } from './db';
import { customer, order, subcontractor, subscription } from './db/schema';
import {
	blockedMessage,
	limitReachedMessage,
	limitStatus,
	shouldBeComped,
	subscriptionAccess,
	trialEndFrom,
	type BlockedReason,
	type LimitedRecord,
	type LimitStatusEntry,
	type LimitUsage,
	type SubscriptionAccess,
	type SubscriptionStatus
} from '$lib/crm';

export type SubscriptionRow = typeof subscription.$inferSelect;

/**
 * Whether the subscription-state simulator is available. Off unless explicitly
 * turned on, because it hands out subscriptions for free.
 */
export function isBillingDevToolsEnabled(): boolean {
	return ENV.BILLING_DEV_TOOLS === 'true';
}

/**
 * Billing gating lives here and nowhere else.
 *
 * Two rules run through the whole module:
 *
 *  1. Enforcement is per-write, never a guard on the /contractor section. A
 *     lapsed contractor must still be able to READ everything they built, so
 *     `contractor/+layout.server.ts` loads normally for them and each mutating
 *     function refuses on its own. See docs/adr/0005-lapsing-never-reaches-customers.md.
 *
 *  2. Nothing here is ever called from a customer or subcontractor surface. Their
 *     portals do not consult a subscription at all — that is a requirement, not an
 *     omission.
 *
 * All gating reads the local `subscription` row; Stripe is never called while
 * serving a page, so a Stripe outage is not an outage of the app.
 */

/** Thrown when a contractor write is refused because the subscription is not live. */
export class SubscriptionBlockedError extends Error {
	readonly reason: BlockedReason;
	constructor(reason: BlockedReason) {
		super(blockedMessage(reason));
		this.name = 'SubscriptionBlockedError';
		this.reason = reason;
	}
}

/** Thrown when a creation is refused for hitting a trial limit. Creation only. */
export class LimitReachedError extends Error {
	readonly entry: LimitStatusEntry;
	constructor(entry: LimitStatusEntry) {
		super(limitReachedMessage(entry));
		this.name = 'LimitReachedError';
		this.entry = entry;
	}
}

export function isBillingError(err: unknown): err is SubscriptionBlockedError | LimitReachedError {
	return err instanceof SubscriptionBlockedError || err instanceof LimitReachedError;
}

/**
 * Map a billing refusal onto a form-action failure. 402 Payment Required is the
 * honest status; SvelteKit renders it through the normal form-error path, so it
 * never reaches a browser as a bare error page.
 */
export function blockedFail(err: SubscriptionBlockedError | LimitReachedError) {
	return fail(402, {
		blocked: true,
		reason: err instanceof SubscriptionBlockedError ? err.reason : 'limit-reached',
		kind: err instanceof LimitReachedError ? err.entry.kind : null,
		message: err.message
	});
}

/**
 * Wrap a route's `actions` object so any billing refusal thrown from a guarded
 * server function comes back as a 402 `fail` instead of a 500.
 *
 * Applied to the whole object rather than to each action so a newly added action
 * is covered by default — the failure mode we care about is someone adding a
 * contractor write and forgetting the gate. Anything that is not a billing error
 * (including SvelteKit's own `redirect`, which is thrown) propagates untouched.
 */
export function withBillingErrors<T extends Record<string, (event: never) => unknown>>(
	actions: T
): T {
	const wrapped = Object.entries(actions).map(([name, handler]) => [
		name,
		async (event: never) => {
			try {
				return await handler(event);
			} catch (err) {
				if (isBillingError(err)) return blockedFail(err);
				throw err;
			}
		}
	]);
	return Object.fromEntries(wrapped) as T;
}

// ------------------------------------------------------------- Provisioning

/**
 * Return this contractor's subscription, creating it if absent.
 *
 * Provisioning is lazy and idempotent because signup is not a single code path:
 * GitHub OAuth never runs the `signUp` action, so hooking creation there would
 * silently miss those contractors. Calling this from the contractor layout covers
 * every route into the product with one implementation.
 *
 * A login that predates BILLING_LAUNCHED_AT is comped permanently — the same rule
 * the backfill migration applied, so the two cannot disagree.
 */
export async function ensureSubscription(
	contractorId: string,
	userCreatedAt: Date
): Promise<SubscriptionRow> {
	const existing = await getSubscription(contractorId);
	if (existing) return existing;

	const comped = shouldBeComped(userCreatedAt);
	const [row] = await db
		.insert(subscription)
		.values({
			contractorId,
			status: comped ? 'comped' : 'trialing',
			trialEndsAt: comped ? null : trialEndFrom()
		})
		// A concurrent request may have inserted first; that is fine, take theirs.
		.onConflictDoNothing({ target: subscription.contractorId })
		.returning();
	if (row) return row;

	const raced = await getSubscription(contractorId);
	if (!raced) throw new Error(`Failed to provision a subscription for ${contractorId}`);
	return raced;
}

export async function getSubscription(contractorId: string): Promise<SubscriptionRow | undefined> {
	const [row] = await db
		.select()
		.from(subscription)
		.where(eq(subscription.contractorId, contractorId))
		.limit(1);
	return row;
}

/**
 * Force a contractor's subscription into a given state, for development and
 * testing only.
 *
 * Subscription states are otherwise slow or impossible to reach by hand — a trial
 * takes 14 days to expire, and `past_due` needs a real card to fail — so without
 * this, the lapse and dunning paths can only be checked by editing the database.
 *
 * Gated behind BILLING_DEV_TOOLS, which is off unless explicitly set to "true".
 * Never enable it in production: it lets any signed-in contractor grant themselves
 * a subscription.
 */
export async function simulateSubscriptionState(
	contractorId: string,
	state:
		'trial-fresh' | 'trial-ending' | 'trial-expired' | 'active' | 'past_due' | 'lapsed' | 'comped'
): Promise<void> {
	if (!isBillingDevToolsEnabled()) throw new Error('Billing dev tools are disabled');

	const now = Date.now();
	const day = 24 * 60 * 60 * 1000;
	const patch: Partial<typeof subscription.$inferInsert> = { updatedAt: new Date() };

	switch (state) {
		case 'trial-fresh':
			Object.assign(patch, { status: 'trialing', trialEndsAt: new Date(now + 14 * day) });
			break;
		case 'trial-ending':
			Object.assign(patch, { status: 'trialing', trialEndsAt: new Date(now + 2 * day) });
			break;
		// Note this stays `trialing`: an expired trial IS lapsed, derived from the
		// date rather than written as a status. Exercising it this way proves the
		// derivation, which a hand-set 'lapsed' row would skip straight past.
		case 'trial-expired':
			Object.assign(patch, { status: 'trialing', trialEndsAt: new Date(now - day) });
			break;
		case 'active':
			Object.assign(patch, {
				status: 'active',
				trialEndsAt: null,
				currentPeriodEnd: new Date(now + 30 * day)
			});
			break;
		case 'past_due':
			Object.assign(patch, { status: 'past_due', trialEndsAt: null });
			break;
		case 'lapsed':
			Object.assign(patch, { status: 'lapsed', trialEndsAt: null });
			break;
		case 'comped':
			Object.assign(patch, { status: 'comped', trialEndsAt: null });
			break;
	}

	await db.update(subscription).set(patch).where(eq(subscription.contractorId, contractorId));
}

/** Grant a contractor a permanently free subscription (demo, seed, support). */
export async function compSubscription(contractorId: string): Promise<void> {
	await db
		.insert(subscription)
		.values({ contractorId, status: 'comped', trialEndsAt: null })
		.onConflictDoUpdate({
			target: subscription.contractorId,
			set: { status: 'comped', trialEndsAt: null, updatedAt: new Date() }
		});
}

// ------------------------------------------------------------------- Reading

export type SubscriptionView = {
	subscription: SubscriptionRow;
	access: SubscriptionAccess;
	status: SubscriptionStatus;
};

/** The subscription plus what it currently permits. */
export async function getSubscriptionView(
	contractorId: string,
	userCreatedAt: Date
): Promise<SubscriptionView> {
	const row = await ensureSubscription(contractorId, userCreatedAt);
	return {
		subscription: row,
		access: subscriptionAccess(
			{ status: row.status as SubscriptionStatus, trialEndsAt: row.trialEndsAt },
			new Date()
		),
		status: row.status as SubscriptionStatus
	};
}

/**
 * Live counts of the capped record types. Counted from real rows every time
 * rather than kept in a column — a stored counter can drift and then disagree
 * with the account it describes (the rule set in
 * docs/adr/0004-derive-guide-progress-from-domain-data.md).
 *
 * Archived customers, archived subcontractors and deleted orders are excluded, so
 * archiving genuinely frees capacity.
 */
export async function countActiveUsage(contractorId: string): Promise<LimitUsage> {
	const [customers, orders, subs] = await Promise.all([
		db
			.select({ n: count() })
			.from(customer)
			.where(and(eq(customer.contractorId, contractorId), isNull(customer.archivedAt))),
		db
			.select({ n: count() })
			.from(order)
			.where(and(eq(order.contractorId, contractorId), isNull(order.deletedAt))),
		db
			.select({ n: count() })
			.from(subcontractor)
			.where(and(eq(subcontractor.contractorId, contractorId), isNull(subcontractor.archivedAt)))
	]);
	return {
		customer: customers[0]?.n ?? 0,
		order: orders[0]?.n ?? 0,
		subcontractor: subs[0]?.n ?? 0
	};
}

/** Usage measured against the caps, for display on billing and create surfaces. */
export async function getLimitStatus(
	contractorId: string
): Promise<Record<LimitedRecord, LimitStatusEntry>> {
	return limitStatus(await countActiveUsage(contractorId));
}

// -------------------------------------------------------------------- Guards

async function accessFor(contractorId: string): Promise<SubscriptionAccess> {
	const row = await getSubscription(contractorId);
	// No row can only mean the contractor has not yet loaded a contractor surface.
	// Fail open: a missing row is our bug, and locking someone out over it would be
	// far worse than briefly letting a write through.
	if (!row) return { canWrite: true, reason: null, limitsApply: false, trialDaysRemaining: null };
	return subscriptionAccess(
		{ status: row.status as SubscriptionStatus, trialEndsAt: row.trialEndsAt },
		new Date()
	);
}

/**
 * Refuse the write unless this contractor's subscription is live. Call at the top
 * of every contractor-initiated mutation.
 */
export async function assertCanWrite(contractorId: string): Promise<void> {
	const access = await accessFor(contractorId);
	if (!access.canWrite) throw new SubscriptionBlockedError(access.reason ?? 'subscription-ended');
}

/**
 * Refuse a *creation* that would exceed a trial limit. Applies only while a trial
 * is live; paid and comped subscriptions are uncapped. Never call this on an edit
 * — a contractor at or over a limit keeps everything they hold fully editable.
 */
export async function assertUnderLimit(contractorId: string, kind: LimitedRecord): Promise<void> {
	const access = await accessFor(contractorId);
	if (!access.limitsApply) return;
	const status = await getLimitStatus(contractorId);
	const entry = status[kind];
	if (entry.atLimit) throw new LimitReachedError(entry);
}

/** `assertCanWrite` followed by `assertUnderLimit` — the guard pair for creations. */
export async function assertCanCreate(contractorId: string, kind: LimitedRecord): Promise<void> {
	await assertCanWrite(contractorId);
	await assertUnderLimit(contractorId, kind);
}
