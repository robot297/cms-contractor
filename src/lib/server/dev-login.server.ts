import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ENV } from 'varlock/env';
import { db } from './db';
import { user, account } from './db/schema';
import { auth } from './auth';
import { compSubscription } from './billing.server';
import { ensureDevWorkspace } from './dev-fixtures.server';

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
 * Its counterpart on the other side of the product: a customer login already
 * linked to a real customer record belonging to the dev contractor, with a job
 * to look at.
 *
 * The customer portal is otherwise the one surface you cannot reach from a dev
 * login — seeing it means a customer-role User bound by `userId` to a customer
 * row, which is several minutes of setup per look. Seeded, it is reachable two
 * ways: sign in as this account directly (real auth end to end), or use the
 * contractor nav's "View as" switch to jump there without changing session.
 */
export const DEV_CUSTOMER_LOGIN = {
	email: 'customer@upliftcollective.dev',
	password: 'testerooni#123',
	name: 'Dev Customer'
} as const;

/**
 * Read through varlock's typed ENV like the other dev flags (EMAIL_DEV_TOOLS
 * and friends). The flag must be declared in .env.schema: varlock treats
 * undeclared vars as sensitive, and its leak scanner then flags the value
 * "true" wherever it appears in a response — which is everywhere.
 *
 * Stringified before comparing: varlock coerces an unquoted `FLAG=true` in a
 * .env file to a real boolean and keeps `FLAG="true"` a string, so a bare
 * `=== 'true'` silently ignores half the ways you'd write it.
 */
export function isDevLoginEnabled(): boolean {
	return String(ENV.SEED_DEV_LOGIN) === 'true';
}

/**
 * Whether anyone may create their own contractor account.
 *
 * OFF unless explicitly "true", which is the opposite of how a signup form
 * normally works and is the point: creating an account sends a verification
 * email, and while this domain's DKIM is unpublished that mail is unsigned — so
 * it lands in spam or is dropped, and the person who just signed up holds an
 * account they cannot get into. A form that cannot deliver its own verification
 * link is worse than no form.
 *
 * Read the same way as the flags above, and stringified for the same reason:
 * varlock coerces an unquoted `FLAG=true` to a real boolean and keeps
 * `FLAG="true"` a string, so a bare `=== 'true'` ignores half the ways you would
 * write it.
 */
export function isSignupEnabled(): boolean {
	return String(ENV.SIGNUPS_ENABLED) === 'true';
}

/**
 * Provision (or repair) one pre-verified login and return its user id.
 *
 * Rows are written directly rather than through auth.api.signUpEmail: the
 * sign-up path fires a verification email (sendOnSignUp), and a seeder that
 * emails a dummy address on every fresh database is exactly the kind of surprise
 * these accounts exist to avoid. Only the password hash comes from Better Auth,
 * so sign-in verifies it exactly like any real account's.
 */
async function ensureLogin(login: {
	email: string;
	password: string;
	name: string;
	role: 'contractor' | 'customer';
}): Promise<string> {
	const ctx = await auth.$context;

	let row = await db.query.user.findFirst({
		where: eq(user.email, login.email),
		columns: { id: true }
	});
	if (row) {
		// Re-assert the properties that make the login useful — a database that
		// predates verification enforcement would otherwise bounce off the gate.
		await db.update(user).set({ emailVerified: true, role: login.role }).where(eq(user.id, row.id));
	} else {
		const id = randomUUID();
		await db.insert(user).values({
			id,
			name: login.name,
			email: login.email,
			emailVerified: true,
			role: login.role
		});
		row = { id };
	}

	const password = await ctx.password.hash(login.password);
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

	return row.id;
}

/** Provision (or repair) the dev logins. Called from the server init hook. */
export async function ensureDevLogin(): Promise<void> {
	if (!isDevLoginEnabled()) return;

	const contractorId = await ensureLogin({ ...DEV_LOGIN, role: 'contractor' });

	// Comped, not trialing: a long-lived local database would lapse after 14 days
	// and start refusing writes — the next footgun after the one this account
	// bypasses. Billing flows are better exercised on a throwaway account anyway.
	await compSubscription(contractorId);

	// The customer side. No subscription: customers arrive by invite and are
	// never billed.
	const customerUserId = await ensureLogin({ ...DEV_CUSTOMER_LOGIN, role: 'customer' });
	// The sample workspace: several customers, a spread of orders across every
	// follow-up state, and two live conversations. Lives in its own module — this
	// file is about logins, that one is about what they can see.
	await ensureDevWorkspace(contractorId, customerUserId);

	// The password is deliberately NOT printed. It is a hardcoded constant in this
	// file rather than anybody's secret, but stdout is not a private channel: this
	// line lands in terminal scrollback, CI job output, `docker logs`, and whatever
	// log aggregator a deployment ships to. A password-shaped string sitting in any
	// of those is a habit worth not having, and it trains readers to skim past
	// credentials in logs. Anyone who needs these can read the constants above.
	console.info(
		`[dev-login] ${DEV_LOGIN.email} (contractor) and ${DEV_CUSTOMER_LOGIN.email} (customer) ready — credentials in src/lib/server/dev-login.server.ts`
	);
}
