import { fail, redirect } from '@sveltejs/kit';
import {
	getLimitStatus,
	getSubscriptionView,
	isBillingDevToolsEnabled,
	simulateSubscriptionState
} from '$lib/server/billing.server';
import {
	BillingUnavailableError,
	createCheckoutSession,
	createPortalSession,
	isBillingConfigured,
	reconcileFromStripe,
	type BillingInterval
} from '$lib/server/stripe.server';
import { TRIAL_LIMITS } from '$lib/crm';
import type { Actions, PageServerLoad } from './$types';

/**
 * The billing surface — and the one contractor page that must keep working when
 * everything else is refusing writes. A lapsed contractor arrives here to fix
 * exactly that, so nothing on this route is billing-guarded.
 */
export const load: PageServerLoad = async ({ locals }) => {
	// The layout guard already redirected non-contractors.
	const user = locals.user!;

	// Repair drift where it is visible: if a webhook was missed, the page a
	// contractor opens to check their billing is the page that fixes it. Never
	// throws — a Stripe outage still renders local state.
	await reconcileFromStripe(user.id);

	const view = await getSubscriptionView(user.id, user.createdAt);
	const limits = await getLimitStatus(user.id);

	return {
		billing: {
			status: view.status,
			canWrite: view.access.canWrite,
			reason: view.access.reason,
			limitsApply: view.access.limitsApply,
			trialDaysRemaining: view.access.trialDaysRemaining,
			trialEndsAt: view.subscription.trialEndsAt,
			currentPeriodEnd: view.subscription.currentPeriodEnd,
			hasPaymentAccount: Boolean(view.subscription.stripeCustomerId)
		},
		limits,
		trialLimits: TRIAL_LIMITS,
		checkoutAvailable: isBillingConfigured(),
		devTools: isBillingDevToolsEnabled()
	};
};

export const actions: Actions = {
	subscribe: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const interval: BillingInterval = form.get('interval') === 'annual' ? 'annual' : 'monthly';

		let url: string;
		try {
			url = await createCheckoutSession(user.id, interval, {
				email: user.email,
				name: user.name ?? null
			});
		} catch (error) {
			if (error instanceof BillingUnavailableError) {
				return fail(503, { message: `Checkout is unavailable right now (${error.message}).` });
			}
			console.error('[billing] checkout failed:', error);
			return fail(500, { message: 'Could not start checkout. Please try again.' });
		}
		redirect(303, url);
	},

	/**
	 * Force a subscription state. Development only — `simulateSubscriptionState`
	 * refuses unless BILLING_DEV_TOOLS is on, and this action checks too so the
	 * form can't be posted blind in production.
	 */
	simulate: async ({ request, locals }) => {
		if (!isBillingDevToolsEnabled()) return fail(403, { message: 'Billing dev tools are off.' });
		const user = locals.user!;
		const form = await request.formData();
		const state = form.get('state')?.toString() ?? '';
		const allowed = [
			'trial-fresh',
			'trial-ending',
			'trial-expired',
			'active',
			'past_due',
			'lapsed',
			'comped'
		] as const;
		if (!(allowed as readonly string[]).includes(state)) {
			return fail(400, { message: 'Unknown state' });
		}
		await simulateSubscriptionState(user.id, state as (typeof allowed)[number]);
		return { success: true };
	},

	portal: async ({ locals }) => {
		const user = locals.user!;
		let url: string;
		try {
			url = await createPortalSession(user.id);
		} catch (error) {
			if (error instanceof BillingUnavailableError) {
				return fail(503, { message: `Billing management is unavailable (${error.message}).` });
			}
			console.error('[billing] portal failed:', error);
			return fail(500, { message: 'Could not open billing management. Please try again.' });
		}
		redirect(303, url);
	}
};
