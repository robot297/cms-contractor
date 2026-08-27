import { eq } from 'drizzle-orm';
import { db } from './db';
import { contractorSettings, customerInvite, order } from './db/schema';
import { getContractorSettings } from './templates.server';

/**
 * The getting-started Guide.
 *
 * Progress is never stored: each step asks the domain whether the thing actually
 * happened, so the checklist can't disagree with the account it describes. The
 * only persisted values are the contractor's own choices — continue-or-dismiss,
 * and which optional steps they waved away.
 *
 * See docs/adr/0004-derive-guide-progress-from-domain-data.md.
 */

export const GUIDE_STATES = ['active', 'extended', 'dismissed'] as const;
export type GuideState = (typeof GUIDE_STATES)[number];

export function isGuideState(value: string): value is GuideState {
	return (GUIDE_STATES as readonly string[]).includes(value);
}

export type GuideStep = {
	id: 'job' | 'invite';
	/** One line. If it needs a paragraph, it isn't a checklist item. */
	title: string;
	/** One sentence saying why it is worth doing. A nudge, not documentation. */
	description: string;
	done: boolean;
	/** Optional steps a contractor may never want are offered a "Skip". */
	skippable?: boolean;
	/** They took that offer. Resolved, but honestly labelled rather than ticked. */
	skipped?: boolean;
};

export type Guide = {
	state: GuideState;
	steps: GuideStep[];
	/** Every step done or skipped — the card has nothing left to say. */
	allDone: boolean;
};

/** Cheap existence probe — `limit 1`, no counting. */
async function exists(query: Promise<unknown | undefined>): Promise<boolean> {
	return (await query) != null;
}

export async function loadGuide(contractorId: string): Promise<Guide> {
	const [settings, hasOrder, hasInvite] = await Promise.all([
		getContractorSettings(contractorId),
		// An order is the whole of the first step: it cannot exist without a
		// customer, so asking about the order asks about both.
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
		)
	]);

	const state: GuideState = isGuideState(settings.guideState) ? settings.guideState : 'active';
	const skipped = new Set(settings.guideSkippedSteps);

	const steps: GuideStep[] = [
		{
			id: 'job',
			title: 'Add your first job',
			// Says what a job IS, because that is the one piece of vocabulary the
			// whole app rests on — everything else hangs off an order.
			description:
				'A customer and the work you are doing for them. Both together, right here — no hunting through screens.',
			done: hasOrder
		},
		{
			id: 'invite',
			title: 'Invite your customer',
			// The one thing worth saying about the portal, and it says the optional
			// part out loud: a contractor who never invites anybody is using the app
			// correctly, and a checklist that implies otherwise is lying to them.
			description:
				'Optional. Sends them a link to follow the job and message you in the app — chatting here needs an account on their side. Everything else works without it, and you can invite from any job later.',
			done: hasInvite,
			skippable: true,
			skipped: skipped.has('invite')
		}
	];

	// A skipped step is resolved: it must not hold the card open forever.
	const settled = (s: GuideStep) => s.done || s.skipped === true;

	return { state, steps, allDone: steps.every(settled) };
}

/** Record that a contractor waved a step away. Idempotent. */
export async function skipGuideStep(contractorId: string, stepId: string): Promise<void> {
	const settings = await getContractorSettings(contractorId);
	if (settings.guideSkippedSteps.includes(stepId)) return;
	await db
		.insert(contractorSettings)
		.values({ contractorId, guideSkippedSteps: [stepId] })
		.onConflictDoUpdate({
			target: contractorSettings.contractorId,
			set: { guideSkippedSteps: [...settings.guideSkippedSteps, stepId] }
		});
}

/**
 * Deliberately not billing-guarded. The Guide is a UI preference, not domain
 * data — a lapsed contractor should still be able to dismiss a getting-started
 * card rather than be stuck looking at one they cannot act on.
 */
export async function setGuideState(contractorId: string, state: GuideState): Promise<void> {
	await db
		.insert(contractorSettings)
		.values({ contractorId, guideState: state })
		.onConflictDoUpdate({
			target: contractorSettings.contractorId,
			set: { guideState: state }
		});
}
