import postgres from 'postgres';

/**
 * Create the end-to-end test database if it isn't there yet.
 *
 * Run as the first half of Playwright's `webServer` command, and that placement
 * is load-bearing. The obvious homes for it both fail:
 *
 *   - `globalSetup` runs AFTER Playwright has already started `webServer`, so
 *     the app boots first and dies on its startup migration against a database
 *     that doesn't exist.
 *   - A top-level `await` in playwright.config.ts is not awaited by Playwright's
 *     config loader, so it silently does nothing.
 *
 * Chaining it ahead of `vite dev` with `&&` is the one arrangement that actually
 * guarantees the database exists before anything connects to it. Plain `.mjs`
 * for the same reason as scripts/migrate.mjs: it runs outside Vite, so it cannot
 * be TypeScript.
 *
 * Idempotent. Set E2E_RESET_DB=1 to drop and recreate first — never needed for
 * correctness (tests are independent and uniquely name their records), only for
 * when accumulated runs make a manual look at the data confusing.
 */

const DEFAULT_URL = 'postgresql://postgres:postgres@localhost:5432/contractor-crm-e2e';

const url = new URL(process.env.E2E_DATABASE_URL ?? DEFAULT_URL);
const name = url.pathname.replace(/^\//, '');
if (!name) {
	console.error(`[e2e] no database name in ${url.toString()}`);
	process.exit(1);
}

// `postgres` is the maintenance database — CREATE DATABASE cannot run from
// inside the database being created.
const admin = new URL(url.toString());
admin.pathname = '/postgres';
const redacted = admin.toString().replace(/:[^:@]+@/, ':****@');

const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
try {
	if (process.env.E2E_RESET_DB === '1') {
		// Stragglers first: a leftover connection from a killed run makes DROP
		// DATABASE hang rather than fail.
		await sql`
			SELECT pg_terminate_backend(pid) FROM pg_stat_activity
			WHERE datname = ${name} AND pid <> pg_backend_pid()
		`;
		await sql.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
		console.info(`[e2e] dropped ${name}`);
	}

	const [existing] = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
	if (existing) {
		console.info(`[e2e] using ${name}`);
	} else {
		// Interpolated rather than parameterised because CREATE DATABASE takes an
		// identifier, not a value. Quoted, and the name comes from our own config
		// rather than from anything a test supplies.
		await sql.unsafe(`CREATE DATABASE "${name}"`);
		console.info(`[e2e] created ${name}`);
	}
} catch (err) {
	// A clearer failure than the app's "relation does not exist" three steps later.
	console.error(`[e2e] could not reach Postgres at ${redacted}`);
	console.error(`      Start it with: docker compose up -d db`);
	console.error(err);
	process.exit(1);
} finally {
	await sql.end({ timeout: 5 });
}
