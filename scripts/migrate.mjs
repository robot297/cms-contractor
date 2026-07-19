// Apply Drizzle migrations from ./drizzle. Runs at container startup (see
// Dockerfile ENTRYPOINT) and can be run locally with `pnpm migrate`.
//
// Uses drizzle-orm's runtime migrator so the production image needs neither
// drizzle-kit nor drizzle.config.ts — only drizzle-orm + postgres (already
// present) and the drizzle/ folder.

import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

function resolveDatabaseUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	try {
		const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
		const match = env.match(/^\s*DATABASE_URL\s*=\s*(.*)$/m);
		if (match) return match[1].trim().replace(/^["']|["']$/g, '');
	} catch {
		// ignore — fall through to the error below
	}
	throw new Error('DATABASE_URL is not set (checked env var and .env)');
}

const migrationsFolder = new URL('../drizzle', import.meta.url).pathname;
const sql = postgres(resolveDatabaseUrl(), { max: 1 });

try {
	console.log('Running database migrations…');
	await migrate(drizzle(sql), { migrationsFolder });
	console.log('\x1b[32m✓ Migrations applied\x1b[0m');
} catch (err) {
	console.error('\x1b[31m✗ Migration failed\x1b[0m:', err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	await sql.end();
}
