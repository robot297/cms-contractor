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

/**
 * The customer half of the support form. Same mechanism as the contractor's —
 * files a GitHub issue — but tagged `from:customer` so the two audiences can be
 * told apart in triage. A customer reporting "the timeline is blank" is a
 * different bug from a contractor reporting it.
 *
 * Deliberately NOT billing-guarded, like its contractor counterpart: this writes
 * to GitHub, not to anyone's data, and per ADR-0005 nothing a customer does may
 * depend on their contractor's subscription anyway.
 */
function requireCustomerSurface(locals: App.Locals) {
	if (!locals.user) redirect(302, '/login');
	// A contractor using view-as reaches this page; they may read it, and the
	// write is refused below rather than here.
	if (!locals.viewAs && locals.user.role !== 'customer') redirect(302, '/');
	return locals.user;
}

export const load: PageServerLoad = ({ locals }) => {
	requireCustomerSurface(locals);
	return {
		configured: isSupportConfigured(),
		captchaSiteKey: captchaSiteKey(),
		viewing: !!locals.viewAs
	};
};

export const actions: Actions = {
	submit: async ({ request, locals, getClientAddress }) => {
		const user = requireCustomerSurface(locals);
		if (locals.viewAs) {
			return fail(403, {
				message: 'Read-only: you are viewing this portal as the customer, not as them.'
			});
		}

		const form = await request.formData();

		// Honeypot ("bot candy"): a field hidden from humans. Anything in it is a bot,
		// so reject with a generic message that never hints at the trap.
		if (form.get('website')?.toString().trim()) {
			return fail(400, { message: 'Something went wrong — please try again.' });
		}

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
			'customer'
		);
		if (!parsed.ok) return fail(400, { field: parsed.field, message: parsed.message });

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
			await submitFeedback(parsed.value, { name: user.name, email: user.email }, screenshot);
		} catch (error) {
			if (error instanceof SupportError) return fail(502, { message: error.message });
			throw error;
		}
		// No issue URL back to a customer: the tracker is ours, not theirs.
		return { success: true };
	}
};
