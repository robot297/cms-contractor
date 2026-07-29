import { fail, redirect } from '@sveltejs/kit';
import { validateFeedback } from '$lib/crm';
import {
	captchaSiteKey,
	isSupportConfigured,
	submitFeedback,
	SupportError,
	verifyCaptcha
} from '$lib/server/support.server';
import { ackGuideFollowUp, loadGuide, setGuideState } from '$lib/server/guide.server';
import type { Actions, PageServerLoad } from './$types';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireContractor(locals);
	// The guide's permanent home: reachable whether or not it's been dismissed.
	const guide = await loadGuide(user.id);
	return { configured: isSupportConfigured(), captchaSiteKey: captchaSiteKey(), guide };
};

export const actions: Actions = {
	/** Mirrors the dashboard action so the guide's follow-up step works here too. */
	guideAckFollowUp: async ({ locals }) => {
		const user = requireContractor(locals);
		await ackGuideFollowUp(user.id);
		return { success: true };
	},

	/** Undo a dismissal — otherwise "hide this" is a one-way door. */
	guideRestore: async ({ locals }) => {
		const user = requireContractor(locals);
		await setGuideState(user.id, 'active');
		return { success: true };
	},

	submit: async ({ request, locals, getClientAddress }) => {
		const user = requireContractor(locals);
		const form = await request.formData();

		// Honeypot ("bot candy"): a field hidden from humans. Anything in it is a bot,
		// so reject with a generic message that never hints at the trap.
		if (form.get('website')?.toString().trim()) {
			return fail(400, { message: 'Something went wrong — please try again.' });
		}

		// CAPTCHA: verify the Turnstile token (a no-op when captcha isn't configured).
		const passed = await verifyCaptcha(
			form.get('cf-turnstile-response')?.toString() ?? null,
			getClientAddress()
		);
		if (!passed) {
			return fail(400, { message: 'Please complete the verification challenge and try again.' });
		}

		const parsed = validateFeedback({
			type: form.get('type')?.toString(),
			title: form.get('title')?.toString(),
			detail: form.get('detail')?.toString()
		});
		if (!parsed.ok) return fail(400, { field: parsed.field, message: parsed.message });

		try {
			const issue = await submitFeedback(parsed.value, { name: user.name, email: user.email });
			return {
				success: true,
				issueUrl: issue.url,
				issueNumber: issue.number,
				type: parsed.value.type
			};
		} catch (error) {
			if (error instanceof SupportError) return fail(502, { message: error.message });
			throw error;
		}
	}
};
