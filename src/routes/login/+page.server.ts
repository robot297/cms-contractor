import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import { isDemoEnabled, prepareDemoSession } from '$lib/server/demo.server';
import { isEmailConfigured } from '$lib/server/email.server';
import { isSignupEnabled } from '$lib/server/dev-login.server';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) redirect(302, '/');
	return { demoEnabled: isDemoEnabled(), signupEnabled: isSignupEnabled() };
};

/**
 * Enough structure to be an address someone can receive mail at: one @, no
 * whitespace, a dot in the domain. The real proof is the verification link —
 * this only refuses obvious typos before an email gets sent to them.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Better Auth's "signed in before verifying" refusal, by code not message text. */
function isUnverifiedError(error: unknown): boolean {
	return (
		error instanceof APIError &&
		(error.body as { code?: string } | undefined)?.code === 'EMAIL_NOT_VERIFIED'
	);
}

export const actions: Actions = {
	demo: async (event) => {
		if (!isDemoEnabled()) return fail(403, { mode: 'signIn', message: 'Demo mode is disabled.' });
		try {
			// Provision + re-seed the shared demo contractor, then sign in as them
			// exactly like a normal login so every guard and query runs for real.
			const creds = await prepareDemoSession();
			await auth.api.signInEmail({ body: creds, headers: event.request.headers });
		} catch (error) {
			if (error instanceof APIError) return fail(400, { mode: 'signIn', message: error.message });
			console.error('[login] demo entry failed:', error);
			return fail(500, {
				mode: 'signIn',
				message: `Demo unavailable: ${(error as Error)?.message ?? error}`
			});
		}
		redirect(302, '/');
	},

	signIn: async (event) => {
		const form = await event.request.formData();
		const email = form.get('email')?.toString() ?? '';
		const password = form.get('password')?.toString() ?? '';
		try {
			await auth.api.signInEmail({ body: { email, password }, headers: event.request.headers });
		} catch (error) {
			// An unverified address is a state, not a mistake — surface it with the
			// way through (a resend button) rather than a bare refusal.
			if (isUnverifiedError(error))
				return fail(403, {
					mode: 'signIn',
					unverified: true,
					email,
					message: 'That email address has not been verified yet.'
				});
			if (error instanceof APIError) return fail(400, { mode: 'signIn', message: error.message });
			console.error('[login] signIn failed:', error);
			return fail(500, {
				mode: 'signIn',
				message: `Unexpected error: ${(error as Error)?.message ?? error}`
			});
		}
		redirect(302, '/');
	},

	signUp: async (event) => {
		// Refused on the SERVER as well as hidden in the page. The tab being gone
		// stops the honest route in; this stops a saved bookmark, a stale tab and a
		// posted form — the action is a URL, and a hidden button is not a lock.
		if (!isSignupEnabled())
			return fail(403, {
				mode: 'signUp',
				message: 'New accounts are closed for the moment. Try the demo, or get in touch.'
			});

		const form = await event.request.formData();
		const email = (form.get('email')?.toString() ?? '').trim();
		const password = form.get('password')?.toString() ?? '';
		const name = (form.get('name')?.toString() ?? '').trim();
		if (!EMAIL_SHAPE.test(email))
			return fail(400, {
				mode: 'signUp',
				message: 'Enter a real email address — a verification link will be sent to it.'
			});
		try {
			// Self-signup on the login page is always a contractor; customers are
			// created by contractors and join via an invite link.
			await auth.api.signUpEmail({
				body: { email, password, name, role: 'contractor' },
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) return fail(400, { mode: 'signUp', message: error.message });
			console.error('[login] signUp failed:', error);
			return fail(500, {
				mode: 'signUp',
				message: `Unexpected error: ${(error as Error)?.message ?? error}`
			});
		}
		// With verification enforced there is no session yet — the account exists
		// but stays locked until the emailed link is clicked. Tell them where to
		// look instead of bouncing them to a login that would only refuse them.
		if (isEmailConfigured()) return { mode: 'signUp' as const, verificationSent: true, email };
		redirect(302, '/');
	},

	/** Re-send the verification link — offered when an unverified sign-in is refused. */
	resendVerification: async (event) => {
		const form = await event.request.formData();
		const email = (form.get('email')?.toString() ?? '').trim();
		if (!EMAIL_SHAPE.test(email))
			return fail(400, { mode: 'signIn', message: 'Enter the email address you signed up with.' });
		try {
			await auth.api.sendVerificationEmail({
				body: { email, callbackURL: '/' },
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) return fail(400, { mode: 'signIn', message: error.message });
			console.error('[login] resendVerification failed:', error);
			return fail(500, { mode: 'signIn', message: 'Could not send the verification email.' });
		}
		return { mode: 'signIn' as const, verificationSent: true, email };
	},

	signInGithub: async (event) => {
		let result;
		try {
			result = await auth.api.signInSocial({
				body: { provider: 'github', callbackURL: '/' },
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) return fail(400, { mode: 'signIn', message: error.message });
			console.error('[login] GitHub sign-in failed:', error);
			return fail(500, {
				mode: 'signIn',
				message: `GitHub sign-in error: ${(error as Error)?.message ?? error}`
			});
		}
		if (result.url) redirect(302, result.url);
		return fail(400, { mode: 'signIn', message: 'GitHub sign-in unavailable' });
	}
};
