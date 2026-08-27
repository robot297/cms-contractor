import { fail, redirect } from '@sveltejs/kit';
import { getLimitStatus, getSubscriptionView, withBillingErrors } from '$lib/server/billing.server';
import {
	createEmailTemplate,
	deleteEmailTemplate,
	getContractorSettings,
	listEmailTemplates,
	reorderEmailTemplates,
	saveContractorSettings,
	saveFollowUpDays,
	saveNavPlacement,
	updateEmailTemplate
} from '$lib/server/templates.server';
import { setGuideState } from '$lib/server/guide.server';
import { isEmailConfigured, isEmailDevToolsEnabled } from '$lib/server/email.server';
import { isBillingConfigured } from '$lib/server/stripe.server';
import {
	captchaSiteKey,
	isAllowedScreenshotType,
	isSupportConfigured,
	MAX_SCREENSHOT_BYTES,
	submitFeedback,
	SupportError,
	verifyCaptcha,
	type SupportScreenshot
} from '$lib/server/support.server';
import { validateFeedback } from '$lib/crm';
import { isFollowUpDays, isNavPlacement, TRIAL_LIMITS } from '$lib/crm';
import type { Actions, PageServerLoad } from './$types';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

/**
 * The account page: who you are signed in as, what state the account is in, and
 * the way through to everything else that is configuration rather than work.
 *
 * Read-only for now, and deliberately not billing-guarded — a lapsed contractor
 * needs to be able to look at their own account precisely when writes are being
 * refused (docs/adr/0005-lapsing-never-reaches-customers.md).
 */
export const load: PageServerLoad = async ({ locals }) => {
	// The layout guard already redirected non-contractors; this satisfies the type
	// and keeps the page honest if it is ever mounted elsewhere.
	const user = requireContractor(locals);

	const [view, settings, templates] = await Promise.all([
		getSubscriptionView(user.id, user.createdAt),
		getContractorSettings(user.id),
		listEmailTemplates(user.id)
	]);
	const limits = view.access.limitsApply ? await getLimitStatus(user.id) : null;

	return {
		// Support folded in from its own top-level route: filing a bug is
		// configuration-adjacent, not a place you work, and it was spending one of
		// five nav slots to say so.
		support: { configured: isSupportConfigured(), captchaSiteKey: captchaSiteKey() },
		profile: {
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			memberSince: user.createdAt,
			businessName: settings.businessName
		},
		account: {
			status: view.status,
			canWrite: view.access.canWrite,
			reason: view.access.reason,
			limitsApply: view.access.limitsApply,
			trialDaysRemaining: view.access.trialDaysRemaining,
			trialEndsAt: view.subscription.trialEndsAt,
			currentPeriodEnd: view.subscription.currentPeriodEnd
		},
		limits,
		trialLimits: TRIAL_LIMITS,
		// What this deployment can actually do, so the page reports capability
		// rather than implying features that are switched off.
		integrations: {
			emailSending: isEmailConfigured(),
			emailDevTools: isEmailDevToolsEnabled(),
			billing: isBillingConfigured()
		},
		// Feeds EmailTemplatesPanel, which used to be its own route at
		// /contractor/settings/templates.
		templates: templates.map((t) => ({
			id: t.id,
			name: t.name,
			subject: t.subject,
			body: t.body
		})),
		signature: settings.signature,
		businessName: settings.businessName,
		followUpDays: settings.followUpDays,
		// The layout reads this too — it is what draws the chrome. Repeated on the
		// page's own data so the control renders from the same load that saves it.
		navPlacement: isNavPlacement(settings.navPlacement) ? settings.navPlacement : 'top'
	};
};

/** Pull + trim a template's fields from a submitted form. Name is required. */
function readTemplate(form: FormData): { name: string; subject: string; body: string } | null {
	const name = (form.get('name')?.toString() ?? '').trim();
	if (!name) return null;
	return {
		name,
		subject: (form.get('subject')?.toString() ?? '').trim(),
		body: (form.get('body')?.toString() ?? '').trim()
	};
}

// Wrapped so a billing refusal from any guarded write returns a 402 the form
// can render, rather than a 500. See withBillingErrors.
export const actions: Actions = withBillingErrors({
	/**
	 * Filing a bug or a feature request.
	 *
	 * Moved here with the Support tab. Sitting inside `withBillingErrors` costs it
	 * nothing — that wrapper only translates a thrown billing refusal into a form
	 * error, and nothing on this path asserts one. That is deliberate: this writes
	 * to GitHub rather than to the contractor's data, and a contractor who has just
	 * been blocked by the paywall is exactly the person who may need to reach us.
	 */
	submitSupport: async ({ request, locals, getClientAddress }) => {
		const user = requireContractor(locals);
		const form = await request.formData();

		// Honeypot ("bot candy"): a field hidden from humans. Anything in it is a bot,
		// so reject with a generic message that never hints at the trap.
		if (form.get('website')?.toString().trim()) {
			return fail(400, { action: 'support', message: 'Something went wrong — please try again.' });
		}

		// CAPTCHA: verify the Turnstile token (a no-op when captcha isn't configured).
		const passed = await verifyCaptcha(
			form.get('cf-turnstile-response')?.toString() ?? null,
			getClientAddress()
		);
		if (!passed) {
			return fail(400, {
				action: 'support',
				message: 'Please complete the verification challenge and try again.'
			});
		}

		const parsed = validateFeedback(
			{
				type: form.get('type')?.toString(),
				title: form.get('title')?.toString(),
				detail: form.get('detail')?.toString()
			},
			// Set here, not read from the form: which pane filed this is a fact about
			// the route, and a browser-supplied value could claim anything.
			'contractor'
		);
		if (!parsed.ok)
			return fail(400, { action: 'support', field: parsed.field, message: parsed.message });

		// Optional screenshot. The client pre-checks type and size; this is the half
		// that holds when the request is stale or hand-rolled.
		let screenshot: SupportScreenshot | null = null;
		const shot = form.get('screenshot');
		if (shot instanceof File && shot.size > 0) {
			if (!isAllowedScreenshotType(shot.type))
				return fail(400, {
					action: 'support',
					field: 'screenshot',
					message: 'Screenshots must be a PNG, JPEG, WebP or GIF image.'
				});
			if (shot.size > MAX_SCREENSHOT_BYTES)
				return fail(400, {
					action: 'support',
					field: 'screenshot',
					message: 'Keep screenshots under 5 MB.'
				});
			screenshot = {
				name: shot.name,
				type: shot.type,
				bytes: new Uint8Array(await shot.arrayBuffer())
			};
		}

		try {
			const issue = await submitFeedback(
				parsed.value,
				{ name: user.name, email: user.email },
				screenshot
			);
			return {
				action: 'support',
				success: true,
				issueUrl: issue.url,
				issueNumber: issue.number,
				type: parsed.value.type
			};
		} catch (error) {
			if (error instanceof SupportError)
				return fail(502, { action: 'support', message: error.message });
			throw error;
		}
	},

	createTemplate: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const input = readTemplate(await request.formData());
		if (!input) return fail(400, { action: 'create', message: 'A template name is required' });
		await createEmailTemplate(user.id, input);
		return { success: true };
	},

	updateTemplate: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString();
		const input = readTemplate(form);
		if (!id) return fail(400, { action: 'update', message: 'Missing template' });
		if (!input) return fail(400, { action: 'update', id, message: 'A template name is required' });
		await updateEmailTemplate(id, user.id, input);
		return { success: true };
	},

	deleteTemplate: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const id = (await request.formData()).get('id')?.toString();
		if (!id) return fail(400, { action: 'delete', message: 'Missing template' });
		await deleteEmailTemplate(id, user.id);
		return { success: true };
	},

	reorderTemplate: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const id = form.get('id')?.toString();
		const direction = form.get('direction')?.toString();
		if (!id || (direction !== 'up' && direction !== 'down'))
			return fail(400, { action: 'reorder', message: 'Bad reorder request' });

		const ids = (await listEmailTemplates(user.id)).map((t) => t.id);
		const from = ids.indexOf(id);
		if (from === -1) return fail(404, { action: 'reorder', message: 'Template not found' });
		const to = direction === 'up' ? from - 1 : from + 1;
		if (to < 0 || to >= ids.length) return { success: true }; // already at an edge
		[ids[from], ids[to]] = [ids[to], ids[from]];
		await reorderEmailTemplates(user.id, ids);
		return { success: true };
	},

	saveSignature: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		await saveContractorSettings(user.id, {
			businessName: (form.get('businessName')?.toString() ?? '').trim(),
			signature: (form.get('signature')?.toString() ?? '').trim()
		});
		return { success: true, saved: 'signature' };
	},

	/**
	 * Change how far out new orders schedule their first follow-up. Existing
	 * follow-ups are left where they are — see `saveFollowUpDays`.
	 */
	/**
	 * Bring the getting-started checklist back.
	 *
	 * It used to be a "?" on the dashboard header — a permanent control on the
	 * busiest screen in the app, for something almost nobody opens twice. Setting
	 * the guide back to `active` is all this does; whether any step still has
	 * anything to say is read from the contractor's own records, so a fully
	 * set-up account gets the finished checklist rather than a fresh one.
	 */
	restartGuide: async ({ locals }) => {
		const user = requireContractor(locals);
		await setGuideState(user.id, 'active');
		redirect(303, '/contractor');
	},

	/**
	 * Move the phone/tablet navigation between the top bar and a bottom tab bar.
	 * Takes effect on the next render of the layout, which the redirect-free form
	 * response already triggers.
	 */
	/*
	 * NAMED FOR THE FORM, not for the helper it calls. The page posts `?/saveNav`
	 * and `?/saveFollowUp`; these were `saveNavPlacement` and `saveFollowUpDays`,
	 * matching the `templates.server` functions below rather than the markup
	 * above. SvelteKit answers an unknown action with a 404 — and behind
	 * `use:enhance` a 404 is silent, so both controls rendered, accepted a click,
	 * and did nothing at all. A form action's name is part of the form's contract,
	 * so the two ends are now spelled the same and the helpers keep their own
	 * longer names.
	 */
	saveNav: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const placement = (await request.formData()).get('navPlacement')?.toString();
		if (!isNavPlacement(placement))
			return fail(400, { action: 'nav', message: 'Pick where the navigation should sit' });
		await saveNavPlacement(user.id, placement);
		return { success: true, saved: 'nav' };
	},

	saveFollowUp: async ({ request, locals }) => {
		const user = requireContractor(locals);
		const form = await request.formData();
		const days = Number(form.get('followUpDays'));
		if (!isFollowUpDays(days))
			return fail(400, { action: 'followUp', message: 'Pick one of the listed intervals' });
		await saveFollowUpDays(user.id, days);
		return { success: true, saved: 'followUp' };
	}
});
