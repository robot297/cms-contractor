// Seed sample CRM data for local/dev use.
//
// Prereqs:
//   1. Apply the schema first:  pnpm db:migrate
//   2. Sign up a contractor account through /login (self-signup = contractor).
//
// Usage:
//   pnpm db:seed [contractorEmail]
//   SEED_CONTRACTOR_EMAIL=me@co.com pnpm db:seed
//
// Orders are attached to an EXISTING contractor user (looked up by email) so we
// never have to reproduce Better Auth's password hashing. Customers are created
// as first-class records; if a customer's email matches a signed-up user, that
// login is linked so the portal works for them.

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

const contractorEmail = (
	process.env.SEED_CONTRACTOR_EMAIL ??
	process.argv[2] ??
	'contractor@example.com'
).toLowerCase();

const DAY = 24 * 60 * 60 * 1000;
const days = (n) => new Date(Date.now() + n * DAY);

// A few customers for this contractor.
const CUSTOMERS = [
	{
		key: 'mina',
		name: 'Mina Patel',
		email: 'mina.patel@example.com',
		phone: '(555) 201-4477',
		address: '88 Cedar Ln, Springfield',
		notes: 'Prefers cedar. Repeat client — third project.',
		tags: ['repeat', 'deck'],
		avatar: '/img/maya.png'
	},
	{
		key: 'luis',
		name: 'Luis Ortega',
		email: 'luis.ortega@example.com',
		phone: '(555) 332-9080',
		address: '14 Elm St, Springfield',
		notes: 'Referred by Mina.',
		tags: ['referral'],
		avatar: '/img/alex.png'
	},
	{
		key: 'nina',
		name: 'Nina Brooks',
		email: 'nina.brooks@example.com',
		phone: '(555) 776-1220',
		address: '901 Oak Ave, Riverton',
		notes: 'HOA board contact — needs itemized quotes.',
		tags: ['commercial'],
		avatar: '/img/mia.png'
	},
	{
		key: 'sam',
		name: 'Sam Rivera',
		email: 'sam.rivera@example.com',
		phone: null,
		address: null,
		notes: null,
		tags: [],
		avatar: '/img/noah.png'
	}
];

// A couple of orders per customer, spread across lifecycle states + follow-ups.
const ORDERS = [
	{
		cust: 'mina',
		project: 'Backyard Deck Rebuild',
		type: 'Deck',
		state: 'In Progress',
		followUp: days(-1), // overdue → shows as "due"
		notes: ['Cedar posts confirmed. Deposit paid by check.']
	},
	{
		cust: 'mina',
		project: 'Poolside Pergola',
		type: 'Pergola',
		state: 'Quote Sent',
		followUp: days(3)
	},
	{
		cust: 'luis',
		project: 'Driveway Carport',
		type: 'Carport',
		state: 'Deposit Pending',
		followUp: days(-4), // overdue
		notes: ['Left a voicemail about the deposit.']
	},
	{
		cust: 'nina',
		project: 'HOA Community Pavilion',
		type: 'Pavilion',
		state: 'Work Scheduled',
		followUp: days(6)
	},
	{
		cust: 'nina',
		project: 'Garden Gazebo',
		type: 'Gazebo',
		state: 'Work Complete',
		followUp: null // done — no follow-up
	},
	{
		cust: 'sam',
		project: 'Tool Shed',
		type: 'Shed',
		state: 'Inquiry',
		followUp: days(0) // due today
	}
];

const sql = postgres(resolveDatabaseUrl(), { max: 1 });

async function main() {
	const [contractor] = await sql`select id from "user" where email = ${contractorEmail}`;
	if (!contractor) {
		console.error(
			`\n✗ No user found with email "${contractorEmail}".\n` +
				`  Sign up that account at /login first (self-signup creates a contractor), then re-run.\n`
		);
		process.exit(1);
	}
	await sql`update "user" set role = 'contractor' where id = ${contractor.id}`;

	// Idempotency: clear this contractor's previously seeded data.
	// Orders cascade their timeline/notifications/invites; then remove customers.
	await sql`delete from "order" where contractor_id = ${contractor.id}`;
	await sql`delete from customer where contractor_id = ${contractor.id}`;
	await sql`delete from notification where user_id = ${contractor.id}`;

	// Create customers, linking any that match a signed-up login.
	const customerIds = {};
	for (const c of CUSTOMERS) {
		const [account] = await sql`select id from "user" where email = ${c.email}`;
		if (account) await sql`update "user" set role = 'customer' where id = ${account.id}`;
		const id = randomUUID();
		await sql`
			insert into customer (id, contractor_id, name, email, phone, address, notes, tags, avatar, user_id)
			values (${id}, ${contractor.id}, ${c.name}, ${c.email}, ${c.phone}, ${c.address}, ${c.notes}, ${c.tags}, ${c.avatar ?? null}, ${account?.id ?? null})
		`;
		customerIds[c.key] = { id, userId: account?.id ?? null };
	}

	// Create orders + a customer-visible status entry (and internal notes).
	for (const o of ORDERS) {
		const target = customerIds[o.cust];
		const orderId = randomUUID();
		await sql`
			insert into "order" (id, contractor_id, customer_id, project_name, project_type, state, next_follow_up_at)
			values (${orderId}, ${contractor.id}, ${target.id}, ${o.project}, ${o.type}, ${o.state}, ${o.followUp})
		`;
		await sql`
			insert into timeline_entry (id, order_id, kind, title, detail, author_role, internal)
			values (${randomUUID()}, ${orderId}, 'status', ${o.state}, '', 'contractor', false)
		`;
		for (const note of o.notes ?? []) {
			await sql`
				insert into timeline_entry (id, order_id, kind, title, detail, author_role, internal)
				values (${randomUUID()}, ${orderId}, 'note', 'Note', ${note}, 'contractor', true)
			`;
		}
	}

	// A pending invite for an unlinked customer (shows on the dashboard).
	const luis = customerIds['luis'];
	if (luis && !luis.userId) {
		await sql`
			insert into customer_invite (id, customer_id, contractor_id, customer_email, token, status, expires_at)
			values (${randomUUID()}, ${luis.id}, ${contractor.id}, 'luis.ortega@example.com', ${randomUUID()}, 'pending', now() + interval '24 hours')
		`;
	}

	// A couple of contractor notifications for the bell.
	await sql`
		insert into notification (id, user_id, title, detail, priority, unread)
		values
			(${randomUUID()}, ${contractor.id}, 'Question from customer: Mina Patel', 'Can we start a week earlier?', 'standard', true),
			(${randomUUID()}, ${contractor.id}, 'Issue reported: Nina Brooks', 'Gazebo trim needs a touch-up.', 'high', true)
	`;

	const linked = Object.values(customerIds).filter((c) => c.userId).length;
	console.log(
		`\n✓ Seeded ${CUSTOMERS.length} customers and ${ORDERS.length} orders for ${contractorEmail}`
	);
	console.log(`  ${linked} customer(s) linked to a signed-up login.`);
	console.log(
		`  Follow-ups: 3 due (In Progress, Deposit Pending, Inquiry), the rest upcoming/none.`
	);
}

main()
	.then(() => sql.end())
	.catch(async (err) => {
		console.error(err);
		await sql.end();
		process.exit(1);
	});
