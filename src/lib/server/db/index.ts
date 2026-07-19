import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = postgres(env.DATABASE_URL, { max: 1 });

export const db = drizzle(client, { schema });

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
	const target = safeUrl(env.DATABASE_URL);
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
