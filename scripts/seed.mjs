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
// Single source of truth for the sample data — shared with the in-app demo
// seeder (src/lib/server/demo.server.ts).
import {
	DEMO_CUSTOMERS,
	DEMO_ORDERS,
	DEMO_NOTIFICATIONS,
	DEMO_SUBCONTRACTORS,
	DEMO_ASSIGNMENTS
} from './demo-fixtures.js';

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
// Follow-ups are stored as day offsets in the shared fixtures; resolve to a Date
// (or null) at seed time.
const followUpAt = (n) => (n === null ? null : days(n));
/**
 * The on-site day, normalised to local midday. `visitsOn` queries a calendar
 * day, so a visit seeded near midnight would land in the wrong one.
 */
const visitAt = (n) => {
	if (n === null || n === undefined) return null;
	const d = days(n);
	d.setHours(12, 0, 0, 0);
	return d;
};

const CUSTOMERS = DEMO_CUSTOMERS;
const ORDERS = DEMO_ORDERS;

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

	// Comp the seeded contractor so local development is never interrupted by a
	// trial expiring mid-session. Real signups still get the normal 14-day trial.
	await sql`
		insert into subscription (contractor_id, status, trial_ends_at)
		values (${contractor.id}, 'comped', null)
		on conflict (contractor_id) do update set status = 'comped', trial_ends_at = null`;

	// Idempotency: clear this contractor's previously seeded data.
	// Orders cascade their timeline/notifications/invites; then remove customers.
	await sql`delete from "order" where contractor_id = ${contractor.id}`;
	await sql`delete from customer where contractor_id = ${contractor.id}`;
	// Subcontractors cascade their assignments + pending invites.
	await sql`delete from subcontractor where contractor_id = ${contractor.id}`;
	await sql`delete from notification where user_id = ${contractor.id}`;

	// Create customers, linking any that match a signed-up login.
	const customerIds = {};
	for (const c of CUSTOMERS) {
		const [account] = await sql`select id from "user" where email = ${c.email}`;
		if (account) await sql`update "user" set role = 'customer' where id = ${account.id}`;
		const id = randomUUID();
		await sql`
			insert into customer (id, contractor_id, name, email, phone, address, city, state, postal_code, notes, avatar, preferred_contact, user_id)
			values (${id}, ${contractor.id}, ${c.name}, ${c.email}, ${c.phone}, ${c.address}, ${c.city ?? null}, ${c.state ?? null}, ${c.postalCode ?? null}, ${c.notes}, ${c.avatar ?? null}, ${c.preferredContact ?? 'email'}, ${account?.id ?? null})
		`;
		customerIds[c.key] = { id, userId: account?.id ?? null };
	}

	// Create orders + a customer-visible status entry (and internal notes).
	const orderIdByProject = {};
	for (const o of ORDERS) {
		const target = customerIds[o.cust];
		const orderId = randomUUID();
		orderIdByProject[o.project] = orderId;
		await sql`
			insert into "order" (id, contractor_id, customer_id, project_name, project_type, icon, state, next_follow_up_at, visit_date)
			values (${orderId}, ${contractor.id}, ${target.id}, ${o.project}, ${o.type}, ${o.icon ?? null}, ${o.state}, ${followUpAt(o.followUpDays)}, ${visitAt(o.visitDays)})
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

	// Subcontractors (Trusted + Guest), linking any that match a signed-up login,
	// plus a pending invite for those flagged `invited`.
	const subIds = {};
	for (const s of DEMO_SUBCONTRACTORS) {
		const [account] = await sql`select id from "user" where email = ${s.email}`;
		if (account) await sql`update "user" set role = 'subcontractor' where id = ${account.id}`;
		const id = randomUUID();
		subIds[s.key] = id;
		await sql`
			insert into subcontractor (id, contractor_id, name, email, phone, company, trade, tier, license_number, insurance_carrier, insurance_expires_at, notes, avatar, user_id)
			values (${id}, ${contractor.id}, ${s.name}, ${s.email}, ${s.phone}, ${s.company}, ${s.trade}, ${s.tier}, ${s.licenseNumber}, ${s.insuranceCarrier}, ${followUpAt(s.insuranceDays)}, ${s.notes}, ${s.avatar}, ${account?.id ?? null})
		`;
		if (s.invited && !account) {
			await sql`
				insert into subcontractor_invite (id, subcontractor_id, contractor_id, subcontractor_email, token, status, expires_at)
				values (${randomUUID()}, ${id}, ${contractor.id}, ${s.email}, ${randomUUID()}, 'pending', now() + interval '24 hours')
			`;
		}
	}

	// Assign subcontractors to orders (many-to-many).
	for (const a of DEMO_ASSIGNMENTS) {
		const orderId = orderIdByProject[a.order];
		const subcontractorId = subIds[a.sub];
		if (orderId && subcontractorId) {
			await sql`
				insert into order_subcontractor (order_id, subcontractor_id)
				values (${orderId}, ${subcontractorId})
				on conflict do nothing
			`;
		}
	}

	// A couple of contractor notifications for the bell.
	for (const n of DEMO_NOTIFICATIONS) {
		await sql`
			insert into notification (id, user_id, title, detail, priority, unread)
			values (${randomUUID()}, ${contractor.id}, ${n.title}, ${n.detail}, ${n.priority}, true)
		`;
	}

	const linked = Object.values(customerIds).filter((c) => c.userId).length;
	console.log(
		`\n✓ Seeded ${CUSTOMERS.length} customers and ${ORDERS.length} orders for ${contractorEmail}`
	);
	console.log(`  ${linked} customer(s) linked to a signed-up login.`);
	console.log(
		`  ${DEMO_SUBCONTRACTORS.length} subcontractors (${DEMO_SUBCONTRACTORS.filter((s) => s.tier === 'trusted').length} trusted) and ${DEMO_ASSIGNMENTS.length} assignments.`
	);
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
