import { fail, redirect } from '@sveltejs/kit';
import { validateFeedback } from '$lib/crm';
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
import type { Actions, PageServerLoad } from './$types';

function requireContractor(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	if (locals.user.role !== 'contractor') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = ({ locals }) => {
	requireContractor(locals);
	return { configured: isSupportConfigured(), captchaSiteKey: captchaSiteKey() };
};

// Deliberately not billing-guarded: filing a bug or feature request writes to
// GitHub, not to the contractor's data, and a contractor who has just been blocked
// by the paywall is exactly the person who may need to reach us.
export const actions: Actions = {
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
		if (!parsed.ok) return fail(400, { field: parsed.field, message: parsed.message });

		// Optional screenshot. The client pre-checks type and size; this is the half
		// that holds when the request is stale or hand-rolled.
		let screenshot: SupportScreenshot | null = null;
		const shot = form.get('screenshot');
		if (shot instanceof File && shot.size > 0) {
			if (!isAllowedScreenshotType(shot.type))
				return fail(400, {
					field: 'screenshot',
					message: 'Screenshots must be a PNG, JPEG, WebP or GIF image.'
				});
			if (shot.size > MAX_SCREENSHOT_BYTES)
				return fail(400, { field: 'screenshot', message: 'Keep screenshots under 5 MB.' });
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
