import { redirect } from '@sveltejs/kit';
import {
	ensureStarterTemplates,
	getContractorSettings,
	listEmailTemplates
} from '$lib/server/templates.server';
import { getLimitStatus, getSubscriptionView } from '$lib/server/billing.server';
import { isEmailConfigured, isEmailDevToolsEnabled } from '$lib/server/email.server';
import { isNavPlacement } from '$lib/crm';
import { isDemoUser } from '$lib/server/demo.server';
import { findDevCustomer, isViewAsEnabled } from '$lib/server/view-as.server';
import { isDevLoginEnabled } from '$lib/server/dev-login.server';
import { awaitingReplyForContractor } from '$lib/server/messaging.server';
import type { LayoutServerLoad } from './$types';

/**
 * Guards the whole contractor section and provides nav chrome + template data.
 *
 * Note what this deliberately does NOT do: block a lapsed contractor. Billing is
 * enforced per-write inside each mutating function, precisely so that a contractor
 * who hasn't paid can still read everything they built. Adding a subscription
 * redirect here would undo that — see docs/adr/0005-lapsing-never-reaches-customers.md.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	// Unverified accounts get the holding page, not the app. Only enforced where
	// this install can deliver the verification mail — see auth.ts.
	if (!locals.user.emailVerified && isEmailConfigured()) redirect(302, '/verify-email');

	// Seed starter templates for contractors who have never made one, then load the
	// templates + branding once here so the composer has them on every contractor
	// surface (dashboard, orders, order detail, customers) without per-page loads.
	const contractorId = locals.user.id;
	await ensureStarterTemplates(contractorId);
	// Provision the subscription lazily, alongside the templates. This is the one
	// place every contractor passes through regardless of how they signed up —
	// GitHub OAuth never runs the sign-up form action, so hooking it there would
	// miss those accounts entirely.
	const [templates, settings, subscription] = await Promise.all([
		listEmailTemplates(contractorId),
		getContractorSettings(contractorId),
		getSubscriptionView(contractorId, locals.user.createdAt)
	]);
	// Only meaningful while a trial is live; skip the three counts otherwise.
	const limits = subscription.access.limitsApply ? await getLimitStatus(contractorId) : null;

	// Development-only view-as, pointed at the seeded dev customer. Resolved here
	// so that with the flag off NOTHING about the feature reaches the browser, and
	// null when SEED_DEV_LOGIN never ran — no target, no button.
	const viewAsEnabled = isViewAsEnabled();
	const viewAsCustomer = viewAsEnabled ? ((await findDevCustomer(contractorId)) ?? null) : null;

	// How many customers are waiting on an answer, on every contractor page — the
	// dashboard is not where you are when a message lands.
	const awaitingReply = (await awaitingReplyForContractor(contractorId)).length;

	return {
		userName: locals.user.name,
		awaitingReply,
		// Where this contractor keeps their navigation on a phone. Read here rather
		// than per-page because the bar and the bottom bar are both layout chrome.
		navPlacement: isNavPlacement(settings.navPlacement) ? settings.navPlacement : 'top',
		viewAsEnabled,
		viewAsCustomer,
		// The real-session swap needs the seeded accounts as well as the dev-tools
		// flag — without SEED_DEV_LOGIN there is nothing to sign in as.
		devSignInEnabled: viewAsEnabled && isDevLoginEnabled(),
		billing: {
			status: subscription.status,
			canWrite: subscription.access.canWrite,
			reason: subscription.access.reason,
			limitsApply: subscription.access.limitsApply,
			trialDaysRemaining: subscription.access.trialDaysRemaining,
			currentPeriodEnd: subscription.subscription.currentPeriodEnd,
			limits
		},
		// Whether the composer posts to the send action or falls straight back to the
		// `mailto:` handoff. Resolved here so every surface agrees, and so an
		// unconfigured install never makes a pointless round-trip to find out.
		emailSendingConfigured: isEmailConfigured(),
		emailDevTools: isEmailDevToolsEnabled(),
		// The shared demo login never sends mail through the app; the composer
		// reads this to say so instead of offering a Send that would be refused.
		demoAccount: isDemoUser(locals.user.email),
		emailTemplates: templates.map((t) => ({
			id: t.id,
			name: t.name,
			subject: t.subject,
			body: t.body
		})),
		contractorSettings: {
			// Fall back to the contractor's own name so `{{contractor}}` resolves even
			// before they set a business name.
			businessName: settings.businessName || locals.user.name,
			signature: settings.signature
		}
	};
};
