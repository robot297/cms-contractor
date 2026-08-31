import { fail, redirect } from '@sveltejs/kit';
import {
	customerLocation,
	isActiveState,
	parseDateInput,
	validateCustomerContact,
	validateOrderSetup,
	type ContractorOrderState
} from '$lib/crm';
import { dashboardMetrics } from '$lib/dashboard';
import {
	createCustomer,
	createOrder,
	DuplicateCustomerEmailError,
	listContractorOrders,
	listCustomers,
	listInvites,
	setVisitDate,
	snoozeFollowUp,
	visitsOn
} from '$lib/server/crm.server';
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

/**
 * Which ZIP the weather widget forecasts for.
 *
 * The most common one among live jobs, because that is where the crew will
 * actually be — not the contractor's own address, which the app doesn't store,
 * and not the newest job, which would make the forecast jump across the state
 * every time an inquiry came in from out of town. Ties break toward the job
 * touched most recently, since `listContractorOrders` returns newest-first.
 *
 * Null when nothing live has a usable ZIP, and the widget then renders nothing.
 */
function workAreaZip(
	orders: { state: string; customerPostalCode: string | null }[]
): string | null {
	const counts = new Map<string, number>();
	for (const o of orders) {
		if (!isActiveState(o.state as ContractorOrderState)) continue;
		const zip = o.customerPostalCode?.trim();
		if (!zip || !/^\d{5}$/.test(zip)) continue;
		counts.set(zip, (counts.get(zip) ?? 0) + 1);
	}
	let best: string | null = null;
	let bestCount = 0;
	for (const [zip, n] of counts) {
		if (n > bestCount) {
			best = zip;
			bestCount = n;
		}
	}
	return best;
}

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
			nextFollowUpAt: o.nextFollowUpAt
		}));

	// The guide always travels with the page so the header button can open it on
	// demand, but it only opens *itself* when the dashboard would otherwise be bare:
	// nothing due, still something to learn, and not previously dismissed.
	const openByDefault =
		guide.state !== 'dismissed' &&
		!guide.allDone &&
		(attention.length === 0 || url.searchParams.get('guide') === '1');

	// The analytics band. Derived from the orders already in hand rather than from
	// its own queries — the whole point of putting it on this page is that the data
	// it needs was loaded a few lines above.
	const metrics = dashboardMetrics(orders, {
		now: new Date(),
		awaitingReplyCount: waiting.length,
		needsResponseCount: attention.length
	});

	// Today's run. Resolved server-side because the ZIP lookup is cached there and
	// the browser has no business making it; the travel estimates on top are
	// computed in the browser, against a location only it can see.
	const visits = await visitsOn(user.id, new Date());

	return {
		attention,
		soon,
		visits,
		invites,
		metrics,
		// Whether the analytics band has anything to be about. A contractor on day
		// one gets the getting-started guide, not three empty charts explaining that
		// they have no revenue yet.
		hasOrders: orders.length > 0,
		// Only while the getting-started card is still up — the first-job dialog
		// offers them in a picker, and every other visit has no use for the list.
		firstJobCustomers: guide.allDone
			? []
			: (await listCustomers(user.id)).map((c) => ({ id: c.id, name: c.name })),
		// The widget fetches its own forecast on mount; this is only where.
		weatherZip: workAreaZip(orders),
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

	/**
	 * The whole of the first getting-started step: a customer and their first job,
	 * in one submit, without leaving the dashboard.
	 *
	 * It was two steps on two pages — add a customer here, then go to orders and
	 * pick them out of a dropdown — which is four screens to get one job into the
	 * app. Both records are created here in order, because an order cannot exist
	 * without a customer to hang off.
	 *
	 * Not a transaction, deliberately. If the order fails the customer is still a
	 * real customer the contractor meant to add, and rolling them back to keep two
	 * writes atomic would throw away good data to tidy up a failure they can see
	 * and retry.
	 */
	createFirstJob: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();

		// An existing customer, or a new one from the fields beside the picker.
		let customerId = form.get('customerId')?.toString().trim() ?? '';
		if (!customerId) {
			const contact = validateCustomerContact({
				name: form.get('name')?.toString() ?? '',
				email: form.get('email')?.toString() ?? '',
				phone: form.get('phone')?.toString() ?? ''
			});
			if (!contact.ok)
				return fail(400, { action: 'firstJob', field: contact.field, message: contact.message });
			try {
				const created = await createCustomer(user.id, contact.value);
				customerId = created.id;
			} catch (err) {
				if (err instanceof DuplicateCustomerEmailError)
					return fail(400, { action: 'firstJob', field: 'email', message: err.message });
				throw err;
			}
		}

		const setup = validateOrderSetup({
			customerId,
			projectName: form.get('projectName')?.toString() ?? '',
			projectType: form.get('projectType')?.toString() ?? '',
			projectTypeOther: form.get('projectTypeOther')?.toString() ?? ''
		});
		if (!setup.ok)
			return fail(400, { action: 'firstJob', field: setup.field, message: setup.message });

		const created = await createOrder(user.id, setup.value);
		// Straight to the job they just made. The step is done, so the card is gone
		// on the way past, and landing on the thing you created is the confirmation.
		redirect(303, `/contractor/orders/${created.id}`);
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

	/**
	 * Put a job on today's run, or take it off.
	 *
	 * Reachable from the dashboard so the day can be re-planned where it is being
	 * read. `date` empty clears it.
	 */
	setVisitDate: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		if (!orderId) return fail(400, { message: 'Order is required' });
		const raw = form.get('date')?.toString() ?? '';
		const date = parseDateInput(raw);
		// A filled-but-unparseable date is a typo and must not silently unschedule
		// the job; a blank one is the contractor clearing it on purpose.
		if (raw.trim() && !date) return fail(400, { message: 'That date could not be read' });
		await setVisitDate(orderId, user.id, date);
		return { success: true };
	},

	/**
	 * Push a follow-up out by a week, from the card that is asking for it.
	 *
	 * This came back to the dashboard after moving to the order detail page, and
	 * for a different reason than it left: the full set of snooze presets belongs
	 * with the rest of the follow-up controls on the order, but "not this week" is
	 * an answer given while triaging the list, and making the contractor open the
	 * job to say it turns a one-second decision into a page load and a trip back.
	 *
	 * ONE preset, deliberately. The gesture that reaches this is a swipe, and a
	 * swipe can carry exactly one meaning — a menu of four durations hanging off a
	 * drag is a menu, not a gesture. Anything other than a week is still a choice
	 * you make on the order.
	 *
	 * A card can be in the list because a follow-up is due, because the customer
	 * is waiting on a reply, or both. This moves the follow-up only: an order with
	 * an unanswered message stays put, which is correct — a person waiting is not
	 * something the contractor can snooze away.
	 */
	snoozeFollowUp: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		if (!orderId) return fail(400, { message: 'Order is required' });
		await snoozeFollowUp(orderId, user.id, '1w');
		return { success: true };
	}
});
