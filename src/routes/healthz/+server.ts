import type { RequestHandler } from './$types';

/**
 * Liveness probe, for Docker's HEALTHCHECK and whatever the host does with it.
 *
 * DELIBERATELY SHALLOW. It answers "is this process serving HTTP", not "is the
 * whole system well", and the difference matters because of what the answer is
 * wired to: an unhealthy container gets restarted. The database is already
 * proven before the server ever listens — `init` in src/hooks.server.ts runs the
 * migrations and `checkDatabaseConnection()` and throws if either fails — so a
 * boot with a bad database never reaches this route at all.
 *
 * What a DB query here would add is the failure mode where Postgres hiccups for
 * ten seconds and the orchestrator responds by killing the one component that
 * was still working. Restarting the app does not fix the database; it just
 * empties the connection pool and loses every in-flight request.
 *
 * No cache, because a probe reading a cached 200 is a probe that cannot fail.
 */
export const GET: RequestHandler = () =>
	new Response(JSON.stringify({ status: 'ok' }), {
		headers: {
			'content-type': 'application/json',
			'cache-control': 'no-store'
		}
	});
