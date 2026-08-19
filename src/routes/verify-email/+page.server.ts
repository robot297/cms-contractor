import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import { isEmailConfigured } from '$lib/server/email.server';
import type { Actions, PageServerLoad } from './$types';

/**
 * The holding page for a signed-in-but-unverified account.
 *
 * With `requireEmailVerification` on, email/password sign-in can't reach this
 * state — but sessions minted before enforcement (and any provider edge case)
 * can, and the contractor layout redirects them here rather than letting an
 * unverified address into the app.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	// Verified, or an install that can't send mail (where verification is not
	// enforced): nothing to do here.
	if (locals.user.emailVerified || !isEmailConfigured()) redirect(302, '/');
	return { email: locals.user.email, name: locals.user.name };
};

export const actions: Actions = {
	resend: async (event) => {
		const user = event.locals.user;
		if (!user) redirect(302, '/login');
		try {
			await auth.api.sendVerificationEmail({
				body: { email: user.email, callbackURL: '/' },
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) return fail(400, { message: error.message });
			console.error('[verify-email] resend failed:', error);
			return fail(500, { message: 'Could not send the verification email.' });
		}
		return { resent: true };
	}
};
