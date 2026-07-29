import { eq } from 'drizzle-orm';
import { db } from './db';
import {
	contractorSettings,
	customer,
	customerInvite,
	order,
	orderSubcontractor
} from './db/schema';
import { getContractorSettings } from './templates.server';

/**
 * The getting-started Guide.
 *
 * Progress is never stored: each step asks the domain whether the thing actually
 * happened, so the checklist can't disagree with the account it describes. The
 * only persisted values are the contractor's continue-or-dismiss choice and the
 * acknowledgement of the follow-up step (which teaches rather than asks, because
 * every Order is born with a 3-day follow-up and would tick itself).
 *
 * See docs/adr/0004-derive-guide-progress-from-domain-data.md.
 */

export const GUIDE_STATES = ['active', 'extended', 'dismissed'] as const;
export type GuideState = (typeof GUIDE_STATES)[number];

export function isGuideState(value: string): value is GuideState {
	return (GUIDE_STATES as readonly string[]).includes(value);
}

export type GuideStep = {
	id: 'customer' | 'order' | 'invite' | 'followUp' | 'subcontractor';
	/** One line. If it needs a paragraph, it isn't a checklist item. */
	title: string;
	done: boolean;
	/** Where the step is actually performed; absent for the acknowledge-only step. */
	href?: string;
	/** Blocked steps say why in a few words instead of linking nowhere. */
	blockedBy?: string;
};

export type Guide = {
	state: GuideState;
	/** The two structurally-required steps. */
	core: GuideStep[];
	/** Shown once the contractor opts to keep going. */
	extended: GuideStep[];
	coreDone: boolean;
	allDone: boolean;
	/** True when both core steps are done and the contractor hasn't chosen yet. */
	atFork: boolean;
};

/** Cheap existence probe — `limit 1`, no counting. */
async function exists(query: Promise<unknown | undefined>): Promise<boolean> {
	return (await query) != null;
}

export async function loadGuide(contractorId: string): Promise<Guide> {
	const [settings, hasCustomer, hasOrder, hasInvite, hasAssignment] = await Promise.all([
		getContractorSettings(contractorId),
		exists(
			db.query.customer.findFirst({
				where: eq(customer.contractorId, contractorId),
				columns: { id: true }
			})
		),
		exists(
			db.query.order.findFirst({
				where: eq(order.contractorId, contractorId),
				columns: { id: true }
			})
		),
		exists(
			db.query.customerInvite.findFirst({
				where: eq(customerInvite.contractorId, contractorId),
				columns: { id: true }
			})
		),
		// Assignments have no contractor column of their own — they're scoped through
		// the Order they belong to.
		db
			.select({ orderId: orderSubcontractor.orderId })
			.from(orderSubcontractor)
			.innerJoin(order, eq(order.id, orderSubcontractor.orderId))
			.where(eq(order.contractorId, contractorId))
			.limit(1)
			.then((rows) => rows.length > 0)
	]);

	const state: GuideState = isGuideState(settings.guideState) ? settings.guideState : 'active';

	const core: GuideStep[] = [
		{
			id: 'customer',
			title: 'Add a customer',
			done: hasCustomer,
			href: '/contractor/customers'
		},
		{
			id: 'order',
			title: 'Create an order for them',
			done: hasOrder,
			href: '/contractor/orders',
			// The order form picks a customer from a dropdown, so this genuinely cannot
			// be done first — say so rather than sending them to an empty select.
			blockedBy: hasCustomer ? undefined : 'needs a customer'
		}
	];

	const extended: GuideStep[] = [
		{
			id: 'invite',
			title: 'Invite them to their portal',
			done: hasInvite,
			href: '/contractor/customers'
		},
		{
			id: 'followUp',
			// The one line worth spending: it explains why the dashboard looks empty.
			title: 'New orders remind you in 3 days',
			done: settings.guideFollowUpAckAt != null
		},
		{
			id: 'subcontractor',
			title: 'Assign a subcontractor',
			done: hasAssignment,
			href: '/contractor/subcontractors'
		}
	];

	const coreDone = core.every((s) => s.done);

	return {
		state,
		core,
		extended,
		coreDone,
		allDone: coreDone && extended.every((s) => s.done),
		atFork: coreDone && state === 'active'
	};
}

/** Record the contractor's continue-or-dismiss choice. */
export async function setGuideState(contractorId: string, state: GuideState): Promise<void> {
	await db
		.insert(contractorSettings)
		.values({ contractorId, guideState: state })
		.onConflictDoUpdate({
			target: contractorSettings.contractorId,
			set: { guideState: state }
		});
}

/** Mark the follow-up step read. Idempotent: the first acknowledgement stands. */
export async function ackGuideFollowUp(contractorId: string): Promise<void> {
	await db
		.insert(contractorSettings)
		.values({ contractorId, guideFollowUpAckAt: new Date() })
		.onConflictDoUpdate({
			target: contractorSettings.contractorId,
			set: { guideFollowUpAckAt: new Date() }
		});
}
