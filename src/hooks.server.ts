import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { checkDatabaseConnection, runMigrations } from '$lib/server/db';
import { ensureDevLogin } from '$lib/server/dev-login.server';
import { resolveViewAs } from '$lib/server/view-as.server';
import { sentryEnabled, sentryOptions } from '$lib/sentry';

// Init runs at module load, before any request is handled — the SDK has to be
// listening before the first thing that could throw. No-op without a DSN.
if (sentryEnabled && !building) Sentry.init(sentryOptions());

export const init: ServerInit = async () => {
	if (building) return;
	// Apply migrations before serving so the app never boots against an
	// unmigrated database. Set RUN_MIGRATIONS_ON_START=false to opt out (e.g. if
	// migrations are handled by a separate deploy step).
	if (env.RUN_MIGRATIONS_ON_START !== 'false') {
		try {
			await runMigrations();
		} catch (err) {
			// Fail loudly: a server running against an unmigrated DB just produces
			// confusing "relation does not exist" errors on every request.
			console.error('\x1b[31m✗ Startup migration failed\x1b[0m:', err);
			throw err;
		}
	}
	await checkDatabaseConnection();
	// Local convenience only (SEED_DEV_LOGIN=true): a pre-verified contractor
	// login, so a fresh database doesn't demand a real email-verification loop
	// before you can look at anything. No-op unless the flag is set.
	await ensureDevLogin();
};

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		const rawRole = session.user.role;
		event.locals.session = session.session;
		event.locals.user = {
			...session.user,
			role:
				rawRole === 'contractor'
					? 'contractor'
					: rawRole === 'subcontractor'
						? 'subcontractor'
						: 'customer'
		};
	}

	// Development-only view-as, resolved AFTER the real session and deliberately
	// beside it: `locals.user` keeps the contractor's own identity and role, and
	// only the portal's loaders consult `locals.viewAs` to pick their subject.
	// Returns null and clears the cookie unless the flag is on and this contractor
	// still owns the named customer — re-checked on every request.
	event.locals.viewAs = (await resolveViewAs(event.cookies, event.locals.user)) ?? undefined;

	return svelteKitHandler({ event, resolve, auth, building });
};

/**
 * Tag the error with WHICH account hit it, never WHO they are — see the note in
 * $lib/sentry. Runs after the auth handle, so `locals.user` is populated.
 *
 * View-as is recorded too: an error raised while a contractor is looking at the
 * portal through a customer's eyes is a different situation from the same stack
 * trace raised by that customer, and without the flag the two are
 * indistinguishable in the issue.
 */
const handleSentryScope: Handle = async ({ event, resolve }) => {
	const user = event.locals.user;
	if (user) {
		Sentry.setUser({ id: user.id, role: user.role });
		Sentry.setTag('viewing_as_customer', Boolean(event.locals.viewAs));
	}
	return resolve(event);
};

/**
 * Baseline security headers on every response. The app previously set none.
 *
 * Deliberately the uncontroversial subset. Each one below either has no effect
 * on how this app renders or is already true of it:
 *
 *   nosniff          Documents are served straight back to the browser with the
 *                    Content-Type they were uploaded under. The upload path only
 *                    admits five image/PDF types and checks the bytes against the
 *                    claimed type (crm.ts `checkUploadContent`), so this is
 *                    defence in depth rather than the thing holding the line —
 *                    but it is what stops a browser deciding for itself that some
 *                    other file is HTML and running it on our origin.
 *   frame-ancestors  Clickjacking. 'self' rather than 'none' because the document
 *                    viewer embeds `/documents/…` in an <object>.
 *   base-uri         Stops an injected <base> re-pointing every relative URL.
 *   Referrer-Policy  Order and document ids live in paths. Without this they ride
 *                    along in the Referer header to any third party a page links
 *                    or loads from.
 *
 * A full Content-Security-Policy is NOT set here, and its absence is a decision
 * rather than an oversight: the app styles almost everything through inline
 * `style="…"` attributes, so any real policy needs `style-src 'unsafe-inline'`
 * plus nonces for SvelteKit's hydration scripts, and it cannot be shipped without
 * checking every surface in a browser first. Doing it properly is its own task;
 * guessing at it here would break pages instead of protecting them.
 */
const handleSecurityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'");
	// Only over TLS. Sent on a plain-http origin it is ignored by browsers, and
	// setting it in local development is a good way to make localhost
	// unreachable over http for months afterwards.
	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	return response;
};

// Sentry's handle goes first so the request span wraps everything downstream,
// including auth resolution — a session lookup that hangs is exactly the kind of
// thing worth seeing in a trace. Headers go on last, so they land on whatever
// response the chain produced, including error responses.
export const handle: Handle = sentryEnabled
	? sequence(Sentry.sentryHandle(), handleSecurityHeaders, handleBetterAuth, handleSentryScope)
	: sequence(handleSecurityHeaders, handleBetterAuth);

/**
 * Unhandled server errors. SvelteKit's own thrown 4xx responses (`error(403, …)`
 * and friends) never reach here, so this is genuine faults only — no reporting
 * noise from a customer hitting a page they aren't allowed to see.
 *
 * The console line is kept on BOTH paths. Defining this hook at all replaces
 * SvelteKit's built-in error logging, so without it, turning Sentry off would
 * silently take server errors out of the container logs too.
 */
const logServerError: HandleServerError = ({ error, event }) => {
	console.error(`\x1b[31m✗ ${event.request.method} ${event.url.pathname}\x1b[0m:`, error);
};

export const handleError: HandleServerError = sentryEnabled
	? Sentry.handleErrorWithSentry(logServerError)
	: logServerError;
