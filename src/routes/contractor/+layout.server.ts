import { redirect } from '@sveltejs/kit';
import {
	ensureStarterTemplates,
	getContractorSettings,
	listEmailTemplates
} from '$lib/server/templates.server';
import { getLimitStatus, getSubscriptionView } from '$lib/server/billing.server';
import { listContractorTags } from '$lib/server/tags.server';
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

	// Seed starter templates for contractors who have never made one, then load the
	// templates + branding once here so the composer has them on every contractor
	// surface (dashboard, orders, order detail, customers) without per-page loads.
	const contractorId = locals.user.id;
	await ensureStarterTemplates(contractorId);
	// Provision the subscription lazily, alongside the templates. This is the one
	// place every contractor passes through regardless of how they signed up —
	// GitHub OAuth never runs the sign-up form action, so hooking it there would
	// miss those accounts entirely.
	const [templates, settings, subscription, contractorTags] = await Promise.all([
		listEmailTemplates(contractorId),
		getContractorSettings(contractorId),
		getSubscriptionView(contractorId, locals.user.createdAt),
		// The tag vocabulary is derived from usage, so it travels with every
		// contractor surface the same way templates do — the picker appears on six.
		listContractorTags(contractorId)
	]);
	// Only meaningful while a trial is live; skip the three counts otherwise.
	const limits = subscription.access.limitsApply ? await getLimitStatus(contractorId) : null;

	return {
		userName: locals.user.name,
		contractorTags,
		billing: {
			status: subscription.status,
			canWrite: subscription.access.canWrite,
			reason: subscription.access.reason,
			limitsApply: subscription.access.limitsApply,
			trialDaysRemaining: subscription.access.trialDaysRemaining,
			currentPeriodEnd: subscription.subscription.currentPeriodEnd,
			limits
		},
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
