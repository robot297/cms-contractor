// One-time backfill: split the free-form `customer.address` written before
// city / state / postal_code were their own columns into those columns.
//
// Run AFTER `pnpm migrate` has added them:
//
//   pnpm backfill:address           # report what would change, write nothing
//   pnpm backfill:address --apply   # actually write
//
// Idempotent and conservative: it only touches rows where city, state and
// postal_code are ALL still null, so a contractor who has since corrected an
// address by hand is never overwritten, and a second run is a no-op. Rows the
// parser can't split are left exactly as they are — `customerLocation` still
// falls back to parsing their street line, so nothing gets worse by skipping.

import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { splitAddress } from '../src/lib/address.js';

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

const apply = process.argv.includes('--apply');
const sql = postgres(resolveDatabaseUrl(), { max: 1 });

try {
	const rows = await sql`
		select id, name, address from customer
		where address is not null and address <> ''
			and city is null and state is null and postal_code is null
	`;

	let split = 0;
	let skipped = 0;
	for (const row of rows) {
		const parts = splitAddress(row.address);
		// Nothing worth writing: the parser found no city, state or ZIP, so the
		// address stays whole and keeps being read the way it is today.
		if (!parts.city && !parts.state && !parts.postalCode) {
			skipped++;
			console.log(`  – ${row.name}: "${row.address}" — left as is`);
			continue;
		}
		split++;
		const shown = [
			parts.address,
			[parts.city, parts.state].filter(Boolean).join(', '),
			parts.postalCode
		]
			.filter(Boolean)
			.join(' | ');
		console.log(`  ✓ ${row.name}: "${row.address}" → ${shown}`);
		if (apply) {
			await sql`
				update customer set
					address = ${parts.address},
					city = ${parts.city},
					state = ${parts.state},
					postal_code = ${parts.postalCode}
				where id = ${row.id}
			`;
		}
	}

	console.log('');
	console.log(`${rows.length} address(es) examined — ${split} split, ${skipped} left alone.`);
	if (!apply && split > 0) {
		console.log('\x1b[33mDry run — nothing written. Re-run with --apply to save.\x1b[0m');
	} else if (apply) {
		console.log('\x1b[32m✓ Backfill applied\x1b[0m');
	}
} catch (err) {
	console.error('\x1b[31m✗ Backfill failed\x1b[0m:', err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	await sql.end();
}
