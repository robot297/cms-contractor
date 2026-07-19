import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';

const githubClientId = env.GITHUB_CLIENT_ID ?? '';
const githubClientSecret = env.GITHUB_CLIENT_SECRET ?? '';

export const auth = betterAuth({
	baseURL: env.ORIGIN ?? 'http://localhost:5173',
	secret: env.BETTER_AUTH_SECRET ?? 'dev-secret',
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { enabled: true },
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
