import { fail, redirect } from '@sveltejs/kit';
import { customerLocation, isOrderIcon } from '$lib/crm';
import { listContractorOrders, listInvites, setOrderIcon } from '$lib/server/crm.server';
import { loadGuide, setGuideState, skipGuideStep } from '$lib/server/guide.server';
import { dismissTrialNotice, getContractorSettings } from '$lib/server/templates.server';
import type { Actions, PageServerLoad } from './$types';
import {
	awaitingReplyForContractor,
	EmptyMessageError,
	sendMessage,
	ThreadForbiddenError,
	threadsForOrders
} from '$lib/server/messaging.server';
import { withBillingErrors } from '$lib/server/billing.server';
import { sendEmailAction } from '$lib/server/email-action.server';
import { revokeInviteAction, sendInviteAction } from '$lib/server/invite-action.server';

/** How much of each conversation the dashboard carries. The rest is on the order. */
const THREAD_PREVIEW = 20;

/**
 * How far ahead "due soon" looks.
 *
 * A week, because that is the default follow-up interval — so this answers "what
 * did I line up for the rest of this cycle" rather than listing every future date
 * a contractor has ever set, which is just the orders page with extra steps.
 */
const SOON_DAYS = 7;

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireContractor(locals);
	const [orders, guide, settings, waiting, invites] = await Promise.all([
		listContractorOrders(user.id),
		loadGuide(user.id),
		getContractorSettings(user.id),
		// Customers who spoke last and have not been answered. NOT "unread": opening
		// an order marks its thread read, so an unread-based signal vanished the
		// moment you glanced at the job — which is exactly when you most need to be
		// reminded you still owe a reply.
		awaitingReplyForContractor(user.id),
		// Portal invites, so a due card's 💬 can offer (or report) an invite for a
		// customer who isn't linked yet.
		listInvites(user.id)
	]);
	// ONE list, not two. An order is on this page because it needs the contractor
	// today, and the reason — a follow-up they set, a customer waiting, or both —
	// is a property of the row rather than a separate section to scroll to. The
	// two-list version rendered an order that was BOTH overdue and unanswered
	// twice, in two visual languages, which is the clearest possible sign they
	// were one feature wearing two hats.
	const owedByOrder = new Map(waiting.map((w) => [w.orderId, w]));
	const needsAttention = orders.filter((o) => o.followUpDue || owedByOrder.has(o.id));

	// The conversation on each of them, so clicking through to reply opens on what
	// was actually said rather than on an empty box.
	const threads = await threadsForOrders(needsAttention.map((o) => o.id));

	const attention = needsAttention
		.map((o) => {
			const owed = owedByOrder.get(o.id) ?? null;
			return {
				id: o.id,
				customerId: o.customerId,
				customerName: o.customerName,
				customerEmail: o.customerEmail,
				customerPhone: o.customerPhone,
				customerLocation: customerLocation({
					city: o.customerCity,
					state: o.customerState,
					address: o.customerAddress
				}),
				customerPreferredContact: o.customerPreferredContact,
				customerLinked: o.customerLinked,
				projectName: o.projectName,
				projectType: o.projectType,
				icon: o.icon,
				nextFollowUpAt: o.nextFollowUpAt,
				followUpDue: o.followUpDue,
				/** Unanswered messages since the contractor last spoke; 0 when none. */
				pending: owed?.pending ?? 0,
				lastMessageAt: owed?.lastAt ?? null,
				// Trimmed: the popover shows a conversation, not an archive. The full
				// thread lives on the order page.
				thread: (threads.get(o.id) ?? []).slice(-THREAD_PREVIEW).map((m) => ({
					id: m.id,
					authorRole: m.authorRole,
					body: m.body,
					createdAt: m.createdAt
				}))
			};
		})
		.sort((a, b) => {
			// A person who has already reached out outranks a note you left yourself.
			// That was the old ordering between the two sections, and it survives the
			// merge as the first tiebreak rather than as a heading.
			if (a.pending > 0 !== b.pending > 0) return a.pending > 0 ? -1 : 1;
			const av = a.nextFollowUpAt ? new Date(a.nextFollowUpAt).getTime() : Infinity;
			const bv = b.nextFollowUpAt ? new Date(b.nextFollowUpAt).getTime() : Infinity;
			if (av !== bv) return av - bv;
			// Both waiting and neither due: the one who spoke longest ago goes first.
			return (a.lastMessageAt?.getTime() ?? 0) - (b.lastMessageAt?.getTime() ?? 0);
		});

	// Not due yet, but close. Deliberately a separate, quieter list rather than
	// more rows in the one above: everything above needs the contractor TODAY, and
	// mixing in things that don't is how a to-do list stops being believed.
	const soonCutoff = new Date();
	soonCutoff.setHours(23, 59, 59, 999);
	soonCutoff.setDate(soonCutoff.getDate() + SOON_DAYS);
	const soon = orders
		.filter(
			(o) =>
				!o.followUpDue &&
				!owedByOrder.has(o.id) &&
				o.nextFollowUpAt != null &&
				new Date(o.nextFollowUpAt) <= soonCutoff
		)
		.sort((a, b) => new Date(a.nextFollowUpAt!).getTime() - new Date(b.nextFollowUpAt!).getTime())
		.map((o) => ({
			id: o.id,
			customerName: o.customerName,
			projectName: o.projectName,
			icon: o.icon,
			nextFollowUpAt: o.nextFollowUpAt
		}));

	// The guide always travels with the page so the header button can open it on
	// demand, but it only opens *itself* when the dashboard would otherwise be bare:
	// nothing due, still something to learn, and not previously dismissed.
	const openByDefault =
		guide.state !== 'dismissed' &&
		!guide.allDone &&
		(attention.length === 0 || url.searchParams.get('guide') === '1');

	return {
		attention,
		soon,
		invites,
		userName: user.name,
		guide,
		guideOpen: openByDefault,
		trialNoticeDismissed: settings.trialNoticeDismissedAt != null
	};
};

// Wrapped so a billing refusal from any guarded write returns a 402 the form
// can render, rather than a 500. See withBillingErrors.
export const actions: Actions = withBillingErrors({
	/**
	 * Sending a composed message. Shared by every surface that mounts the
	 * composer — the implementation lives in one file so the rule about when a
	 * send is recorded on a timeline can't drift between pages.
	 */
	sendEmail: sendEmailAction,

	// Portal invite from a due card's Chat tab, for a customer who isn't linked yet.
	// Shared with the other contact-panel surfaces.
	sendInvite: sendInviteAction,
	revokeInvite: revokeInviteAction,

	/**
	 * Reply in the customer's portal, from the dashboard.
	 *
	 * The same thing the order workspace does, reached from the card that told you
	 * a reply was owed — answering a question should not require first navigating
	 * to the job it was asked about. The order id is a form field here rather than
	 * a route param, and `sendMessage` re-checks that it belongs to this contractor.
	 */
	replyToCustomer: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		if (!orderId) return fail(400, { message: 'Order is required' });
		try {
			await sendMessage(
				orderId,
				{ role: 'contractor', userId: user.id },
				form.get('body')?.toString() ?? ''
			);
		} catch (err) {
			if (err instanceof EmptyMessageError) return fail(400, { message: err.message });
			if (err instanceof ThreadForbiddenError) return fail(404, { message: 'Order not found' });
			throw err;
		}
		return { success: true };
	},

	/** Guide: keep going into the optional steps. */
	guideContinue: async ({ locals }) => {
		const user = requireContractor(locals);
		await setGuideState(user.id, 'extended');
		return { success: true };
	},

	/** Guide: put it away. Reopenable from the support page. */
	guideDismiss: async ({ locals }) => {
		const user = requireContractor(locals);
		await setGuideState(user.id, 'dismissed');
		return { success: true };
	},

	/** Put the trial welcome away for good. */
	dismissTrialNotice: async ({ locals }) => {
		const user = requireContractor(locals);
		await dismissTrialNotice(user.id);
		return { success: true };
	},

	/** Guide: wave an optional step away rather than leave it unticked forever. */
	guideSkipStep: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const stepId = form.get('stepId')?.toString() ?? '';
		if (!stepId) return fail(400, { message: 'A step is required' });
		await skipGuideStep(user.id, stepId);
		return { success: true };
	},

	setOrderIcon: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		const raw = form.get('icon')?.toString() ?? '';
		if (!orderId) return fail(400, { message: 'Order is required' });
		// Empty clears the icon; any other value must be one of the fixed set.
		if (raw !== '' && !isOrderIcon(raw)) return fail(400, { message: 'Unknown icon' });
		await setOrderIcon(orderId, user.id, raw === '' ? null : raw);
		return { success: true };
	}
	// Snoozing a follow-up moved to the order detail page, alongside the rest of the
	// follow-up controls.
});
