import { fail, redirect } from '@sveltejs/kit';
import { formatLocation, isOrderIcon, isSnoozePreset } from '$lib/crm';
import { listContractorOrders, setOrderIcon, snoozeFollowUp } from '$lib/server/crm.server';
import { ackGuideFollowUp, loadGuide, setGuideState } from '$lib/server/guide.server';
import { dismissTrialNotice, getContractorSettings } from '$lib/server/templates.server';
import type { Actions, PageServerLoad } from './$types';
import { withBillingErrors } from '$lib/server/billing.server';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireContractor(locals);
	const [orders, guide, settings] = await Promise.all([
		listContractorOrders(user.id),
		loadGuide(user.id),
		getContractorSettings(user.id)
	]);
	// Orders whose next follow-up is due, soonest first — the dashboard's default tab.
	const dueOrders = orders
		.filter((o) => o.followUpDue)
		.sort((a, b) => {
			const av = a.nextFollowUpAt ? new Date(a.nextFollowUpAt).getTime() : Infinity;
			const bv = b.nextFollowUpAt ? new Date(b.nextFollowUpAt).getTime() : Infinity;
			return av - bv;
		})
		.map((o) => ({
			id: o.id,
			customerName: o.customerName,
			customerEmail: o.customerEmail,
			customerPhone: o.customerPhone,
			customerLocation: formatLocation(o.customerAddress),
			customerPreferredContact: o.customerPreferredContact,
			projectName: o.projectName,
			projectType: o.projectType,
			icon: o.icon,
			nextFollowUpAt: o.nextFollowUpAt
		}));
	// The guide always travels with the page so the header button can open it on
	// demand, but it only opens *itself* when the dashboard would otherwise be bare:
	// nothing due, still something to learn, and not previously dismissed.
	const openByDefault =
		guide.state !== 'dismissed' &&
		!guide.allDone &&
		(dueOrders.length === 0 || url.searchParams.get('guide') === '1');

	return {
		dueOrders,
		userName: user.name,
		guide,
		guideOpen: openByDefault,
		trialNoticeDismissed: settings.trialNoticeDismissedAt != null
	};
};

// Wrapped so a billing refusal from any guarded write returns a 402 the form
// can render, rather than a 500. See withBillingErrors.
export const actions: Actions = withBillingErrors({
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

	/** Guide: the follow-up step teaches rather than asks — mark it read. */
	guideAckFollowUp: async ({ locals }) => {
		const user = requireContractor(locals);
		await ackGuideFollowUp(user.id);
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
	},

	// Snooze a due follow-up straight from the dashboard, so it drops off the list.
	snoozeFollowUp: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const orderId = form.get('orderId')?.toString() ?? '';
		const preset = form.get('preset')?.toString() ?? '';
		if (!orderId) return fail(400, { message: 'Order is required' });
		if (!isSnoozePreset(preset)) return fail(400, { message: 'Invalid snooze' });
		await snoozeFollowUp(orderId, user.id, preset);
		return { success: true };
	}
});
