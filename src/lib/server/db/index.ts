import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';
import { ENV } from 'varlock/env';

if (!ENV.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = postgres(ENV.DATABASE_URL, { max: 1 });

export const db = drizzle(client, { schema });

/**
 * Apply pending Drizzle migrations. Runs from the server's `init` hook so the
 * schema is guaranteed up to date before the app serves a request — regardless
 * of how the container was started. This is deliberately independent of the
 * Docker entrypoint, since some hosts (e.g. Coolify) don't run it.
 *
 * The migrations folder ships in the image at ./drizzle (see Dockerfile). It is
 * resolved relative to the process CWD; override with MIGRATIONS_FOLDER if the
 * app is ever launched from somewhere other than the app root.
 */
export async function runMigrations(): Promise<void> {
	const migrationsFolder = ENV.MIGRATIONS_FOLDER ?? 'drizzle';
	console.log(`→ Applying database migrations from ./${migrationsFolder} …`);
	await migrate(db, { migrationsFolder });
	console.log('\x1b[32m✓ Migrations applied\x1b[0m');
}

/** Redact credentials before logging a connection string. */
function safeUrl(url: string): string {
	try {
		const u = new URL(url);
		if (u.password) u.password = '****';
		return u.toString();
	} catch {
		return '<unparseable DATABASE_URL>';
	}
}

/**
 * Eagerly verify the database is reachable. postgres-js connects lazily, so
 * without this a bad connection only surfaces on the first query mid-request.
 * Call once at server startup (see hooks.server.ts).
 */
export async function checkDatabaseConnection(): Promise<void> {
	const target = safeUrl(ENV.DATABASE_URL);
	console.log(`Checking database connection → ${target}`);
	try {
		await client`select 1`;
		console.log(`\x1b[32m✓ Database connected\x1b[0m → ${target}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`\x1b[31m✗ Database connection FAILED\x1b[0m → ${target}`);
		console.error(`  ${message}`);
		console.error('  Is Postgres running? Try: docker compose up -d db');
	}
}
