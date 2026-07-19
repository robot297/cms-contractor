// Seed sample CRM data for local/dev use.
//
// Prereqs:
//   1. Run the migration first:  pnpm db:migrate   (or pnpm db:push)
//   2. Sign up a contractor account through /login (role: contractor).
//   3. Optionally sign up a customer account too (role: customer).
//
// Usage:
//   pnpm db:seed [contractorEmail] [customerEmail]
//   SEED_CONTRACTOR_EMAIL=me@co.com SEED_CUSTOMER_EMAIL=cust@x.com pnpm db:seed
//
// The script attaches orders to an EXISTING contractor user (looked up by
// email) so we never have to reproduce Better Auth's password hashing.

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

function resolveDatabaseUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	try {
		const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
		const match = env.match(/^\s*DATABASE_URL\s*=\s*(.*)$/m);
		if (match) return match[1].trim().replace(/^["']|["']$/g, '');
	} catch {
		// ignore
	}
	throw new Error('DATABASE_URL is not set (checked env var and .env)');
}

const contractorEmail = (process.env.SEED_CONTRACTOR_EMAIL ?? process.argv[2] ?? 'contractor@example.com').toLowerCase();
const customerEmail = (process.env.SEED_CUSTOMER_EMAIL ?? process.argv[3] ?? 'customer@example.com').toLowerCase();

const sql = postgres(resolveDatabaseUrl(), { max: 1 });

async function main() {
	const [contractor] = await sql`select id from "user" where email = ${contractorEmail}`;
	if (!contractor) {
		console.error(
			`\n✗ No user found with email "${contractorEmail}".\n` +
				`  Sign up that account at /login (role: contractor) first, then re-run.\n`
		);
		process.exit(1);
	}
	await sql`update "user" set role = 'contractor' where id = ${contractor.id}`;

	const [customer] = await sql`select id from "user" where email = ${customerEmail}`;
	if (customer) await sql`update "user" set role = 'customer' where id = ${customer.id}`;
	const customerId = customer?.id ?? null;

	// Idempotency: clear this contractor's previously seeded data.
	await sql`delete from "order" where contractor_id = ${contractor.id}`;
	await sql`delete from notification where user_id = ${contractor.id}`;

	const orders = [
		{ name: 'Mina Patel', email: customerEmail, state: 'In Progress', linked: true },
		{ name: 'Luis Ortega', email: 'luis.ortega@example.com', state: 'Deposit Pending', linked: false },
		{ name: 'Nina Brooks', email: 'nina.brooks@example.com', state: 'Work Complete', linked: false }
	];

	let activeOrderId = null;
	for (const o of orders) {
		const id = randomUUID();
		await sql`
			insert into "order" (id, contractor_id, customer_id, customer_name, customer_email, state)
			values (${id}, ${contractor.id}, ${o.linked ? customerId : null}, ${o.name}, ${o.email.toLowerCase()}, ${o.state})
		`;
		if (o.linked) activeOrderId = id;

		await sql`
			insert into timeline_entry (id, order_id, kind, title, detail, author_role)
			values (${randomUUID()}, ${id}, 'status', ${o.state}, 'Status set by contractor.', 'contractor')
		`;
	}

	if (activeOrderId) {
		await sql`
			insert into timeline_entry (id, order_id, kind, title, detail, author_role)
			values (${randomUUID()}, ${activeOrderId}, 'invoice', 'Invoice shared', 'Invoice attached for review.', 'contractor')
		`;
		await sql`
			insert into customer_invite (id, order_id, contractor_id, customer_email, token, status, expires_at)
			values (${randomUUID()}, ${activeOrderId}, ${contractor.id}, ${customerEmail}, ${randomUUID()}, 'pending', now() + interval '24 hours')
		`;
		if (customerId) {
			await sql`
				insert into notification (id, user_id, order_id, title, detail, priority, unread)
				values (${randomUUID()}, ${customerId}, ${activeOrderId}, 'Order update: In Progress', 'Work is underway.', 'standard', true)
			`;
		}
	}

	await sql`
		insert into notification (id, user_id, title, detail, priority, unread)
		values (${randomUUID()}, ${contractor.id}, 'Deposit reminder', 'Luis Ortega still needs to confirm the deposit.', 'high', true)
	`;

	console.log(`\n✓ Seeded ${orders.length} orders for ${contractorEmail}`);
	if (customerId) console.log(`  Linked active order to customer ${customerEmail}`);
	else console.log(`  (Sign up ${customerEmail} as a customer to see the linked order in the portal.)`);
}

main()
	.then(() => sql.end())
	.catch(async (err) => {
		console.error(err);
		await sql.end();
		process.exit(1);
	});
