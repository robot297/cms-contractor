import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ENV } from 'varlock/env';
import { db } from './db';
import { user, account } from './db/schema';
import { auth } from './auth';
import { compSubscription } from './billing.server';

/**
 * A pre-verified contractor login for local development, provisioned at boot
 * when SEED_DEV_LOGIN=true.
 *
 * Exists because email verification is now the gate on the whole app: on an
 * install with mail configured, a fresh local database means signing up and
 * completing a verification loop against your own inbox before you can look at
 * anything. This account skips that — it is born verified.
 *
 * Off unless explicitly enabled, and the credentials are deliberately public:
 * never enable this on a deployment that anyone but you can reach.
 */
export const DEV_LOGIN = {
	email: 'contractor@upliftcollective.dev',
	password: 'testerooni#123',
	name: 'Dev Contractor'
} as const;

/**
 * Read through varlock's typed ENV like the other dev flags (EMAIL_DEV_TOOLS
 * and friends). The flag must be declared in .env.schema: varlock treats
 * undeclared vars as sensitive, and its leak scanner then flags the value
 * "true" wherever it appears in a response — which is everywhere.
 */
export function isDevLoginEnabled(): boolean {
	return ENV.SEED_DEV_LOGIN === 'true';
}

/** Provision (or repair) the dev login. Called from the server init hook. */
export async function ensureDevLogin(): Promise<void> {
	if (!isDevLoginEnabled()) return;

	// Rows are written directly rather than through auth.api.signUpEmail: the
	// sign-up path fires a verification email (sendOnSignUp), and a seeder that
	// emails a dummy address on every fresh database is exactly the kind of
	// surprise this account exists to avoid. Only the password hash comes from
	// Better Auth, so sign-in verifies it exactly like any real account's.
	const ctx = await auth.$context;

	let row = await db.query.user.findFirst({
		where: eq(user.email, DEV_LOGIN.email),
		columns: { id: true }
	});
	if (row) {
		// Re-assert the properties that make the login useful — a database that
		// predates verification enforcement would otherwise bounce off the gate.
		await db
			.update(user)
			.set({ emailVerified: true, role: 'contractor' })
			.where(eq(user.id, row.id));
	} else {
		const id = randomUUID();
		await db.insert(user).values({
			id,
			name: DEV_LOGIN.name,
			email: DEV_LOGIN.email,
			emailVerified: true,
			role: 'contractor'
		});
		row = { id };
	}

	const password = await ctx.password.hash(DEV_LOGIN.password);
	const credential = await db.query.account.findFirst({
		where: and(eq(account.userId, row.id), eq(account.providerId, 'credential')),
		columns: { id: true }
	});
	if (credential) {
		// Pin the password to the documented value so a drifted local database
		// can't turn the seeded login into a guessing game.
		await db
			.update(account)
			.set({ password, updatedAt: new Date() })
			.where(eq(account.id, credential.id));
	} else {
		await db.insert(account).values({
			id: randomUUID(),
			accountId: row.id,
			providerId: 'credential',
			userId: row.id,
			password,
			updatedAt: new Date()
		});
	}

	// Comped, not trialing: a long-lived local database would lapse after 14 days
	// and start refusing writes — the next footgun after the one this account
	// bypasses. Billing flows are better exercised on a throwaway account anyway.
	await compSubscription(row.id);

	console.info(`[dev-login] ${DEV_LOGIN.email} ready (password: ${DEV_LOGIN.password})`);
}
