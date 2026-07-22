import type { Handle, ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { checkDatabaseConnection, runMigrations } from '$lib/server/db';

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

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
