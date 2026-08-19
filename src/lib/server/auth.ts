import { ENV } from 'varlock/env';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { isEmailConfigured, sendVerificationEmail } from '$lib/server/email.server';

const githubClientId = ENV.GITHUB_CLIENT_ID ?? '';
const githubClientSecret = ENV.GITHUB_CLIENT_SECRET ?? '';

/**
 * Verified email is the gate on the whole app — but only where this install can
 * actually deliver the verification mail. An unconfigured self-host or dev setup
 * enforcing it would lock every new account out with no way back in, so there
 * the flow degrades to the old behavior (and the link is logged instead).
 */
const enforceVerification = isEmailConfigured();

export const auth = betterAuth({
	baseURL: ENV.ORIGIN ?? 'http://localhost:5173',
	secret: ENV.BETTER_AUTH_SECRET ?? 'dev-secret',
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: {
		enabled: true,
		// No session until the address is confirmed: sign-in is refused with
		// EMAIL_NOT_VERIFIED, which the login page turns into a resend offer.
		requireEmailVerification: enforceVerification
	},
	emailVerification: {
		sendOnSignUp: enforceVerification,
		// Clicking the link both proves the address and starts the session, so a
		// new contractor lands in the app instead of back at the sign-in form.
		autoSignInAfterVerification: true,
		sendVerificationEmail: async ({ user, url }) => {
			await sendVerificationEmail(user.email, user.name, url);
		}
	},
	user: {
		additionalFields: {
			role: {
				type: 'string',
				required: false,
				defaultValue: 'customer',
				input: true // allow the value to be set from the sign-up form
			}
		}
	},
	socialProviders: {
		github: {
			clientId: githubClientId,
			clientSecret: githubClientSecret
		}
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
