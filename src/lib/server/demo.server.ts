import { eq } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { user, customer, order, timelineEntry, notification } from './db/schema';
import { auth } from './auth';

/**
 * A shared, self-provisioning demo contractor. The "Explore the live demo"
 * button on /login signs into THIS account, so a visitor experiences the full
 * contractor app — real routes, real guards, real queries — without signing up.
 *
 * It is safe to expose publicly: the account is scoped like any other
 * contractor (it can never see real customers) and holds only sample data,
 * which is re-seeded on every entry so each visitor gets a pristine tour. Turn
 * the whole feature off by setting DEMO_MODE=false in the environment.
 */
export const DEMO_CONTRACTOR = {
	email: 'demo@contractor-crm.app',
	// Intentionally shared and non-secret — this login only ever holds demo data.
	password: 'explore-the-demo-2026',
	name: 'Demo Contractor'
} as const;

/** Demo mode is on unless explicitly disabled. */
export function isDemoEnabled(): boolean {
	return env.DEMO_MODE !== 'false';
}

/**
 * Provision (if needed) and re-seed the demo contractor, then hand back its
 * credentials so the caller can establish a session the normal way. Throws if
 * the account can't be provisioned.
 */
export async function prepareDemoSession(): Promise<{ email: string; password: string }> {
	const contractorId = await ensureDemoContractor();
	await seedDemoData(contractorId);
	return { email: DEMO_CONTRACTOR.email, password: DEMO_CONTRACTOR.password };
}

/** Create the demo login if it doesn't exist yet; return its user id. */
async function ensureDemoContractor(): Promise<string> {
	const existing = await findDemoUserId();
	if (existing) return existing;

	try {
		// Goes through Better Auth so the password is hashed exactly like a real
		// sign-up. No headers passed — we don't want this to set a session cookie;
		// the caller signs in explicitly afterwards.
		await auth.api.signUpEmail({
			body: {
				email: DEMO_CONTRACTOR.email,
				password: DEMO_CONTRACTOR.password,
				name: DEMO_CONTRACTOR.name,
				role: 'contractor'
			}
		});
	} catch (error) {
		// A concurrent demo entry may have created it first — tolerate that and
		// re-read below. Any non-API error is a real failure.
		if (!(error instanceof APIError)) throw error;
	}

	const id = await findDemoUserId();
	if (!id) throw new Error('Demo contractor could not be provisioned');
	// Self-signup already defaults to contractor; enforce it in case that changes.
	await db.update(user).set({ role: 'contractor' }).where(eq(user.id, id));
	return id;
}

async function findDemoUserId(): Promise<string | undefined> {
	const row = await db.query.user.findFirst({
		where: eq(user.email, DEMO_CONTRACTOR.email),
		columns: { id: true }
	});
	return row?.id;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY_MS);

type DemoCustomer = {
	key: string;
	name: string;
	email: string;
	phone: string | null;
	address: string | null;
	notes: string | null;
	tags: string[];
};

type DemoOrder = {
	cust: string;
	project: string;
	type: string;
	state: string;
	followUp: Date | null;
	notes?: string[];
};

// A small, hand-tuned tour: a mix of lifecycle states, due/overdue/upcoming
// follow-ups, tags, and internal notes. Mirrors scripts/seed.mjs, but written
// against Drizzle so it can run inside the app at demo time.
const CUSTOMERS: DemoCustomer[] = [
	{
		key: 'mina',
		name: 'Mina Patel',
		email: 'mina.patel@example.com',
		phone: '(555) 201-4477',
		address: '88 Cedar Ln, Springfield',
		notes: 'Prefers cedar. Repeat client — third project.',
		tags: ['repeat', 'deck']
	},
	{
		key: 'luis',
		name: 'Luis Ortega',
		email: 'luis.ortega@example.com',
		phone: '(555) 332-9080',
		address: '14 Elm St, Springfield',
		notes: 'Referred by Mina.',
		tags: ['referral']
	},
	{
		key: 'nina',
		name: 'Nina Brooks',
		email: 'nina.brooks@example.com',
		phone: '(555) 776-1220',
		address: '901 Oak Ave, Riverton',
		notes: 'HOA board contact — needs itemized quotes.',
		tags: ['commercial']
	},
	{
		key: 'sam',
		name: 'Sam Rivera',
		email: 'sam.rivera@example.com',
		phone: null,
		address: null,
		notes: null,
		tags: []
	}
];

const ORDERS: DemoOrder[] = [
	{
		cust: 'mina',
		project: 'Backyard Deck Rebuild',
		type: 'Deck',
		state: 'In Progress',
		followUp: inDays(-1), // overdue → shows as "due"
		notes: ['Cedar posts confirmed. Deposit paid by check.']
	},
	{ cust: 'mina', project: 'Poolside Pergola', type: 'Pergola', state: 'Quote Sent', followUp: inDays(3) },
	{
		cust: 'luis',
		project: 'Driveway Carport',
		type: 'Carport',
		state: 'Deposit Pending',
		followUp: inDays(-4), // overdue
		notes: ['Left a voicemail about the deposit.']
	},
	{ cust: 'nina', project: 'HOA Community Pavilion', type: 'Pavilion', state: 'Work Scheduled', followUp: inDays(6) },
	{ cust: 'nina', project: 'Garden Gazebo', type: 'Gazebo', state: 'Work Complete', followUp: null },
	{ cust: 'sam', project: 'Tool Shed', type: 'Shed', state: 'Inquiry', followUp: inDays(0) } // due today
];

/** Wipe and rebuild the demo contractor's data so every entry is a fresh tour. */
async function seedDemoData(contractorId: string): Promise<void> {
	// Deleting orders cascades their timeline entries; notifications are cleared
	// by owner since some aren't tied to an order.
	await db.delete(order).where(eq(order.contractorId, contractorId));
	await db.delete(customer).where(eq(customer.contractorId, contractorId));
	await db.delete(notification).where(eq(notification.userId, contractorId));

	const idByKey = new Map<string, string>();
	for (const c of CUSTOMERS) {
		const id = crypto.randomUUID();
		idByKey.set(c.key, id);
		await db.insert(customer).values({
			id,
			contractorId,
			name: c.name,
			email: c.email,
			phone: c.phone,
			address: c.address,
			notes: c.notes,
			tags: c.tags
		});
	}

	for (const o of ORDERS) {
		const orderId = crypto.randomUUID();
		await db.insert(order).values({
			id: orderId,
			contractorId,
			customerId: idByKey.get(o.cust),
			projectName: o.project,
			projectType: o.type,
			state: o.state,
			nextFollowUpAt: o.followUp
		});
		// A customer-visible status entry...
		await db.insert(timelineEntry).values({
			orderId,
			kind: 'status',
			title: o.state,
			detail: '',
			authorRole: 'contractor',
			internal: false
		});
		// ...plus any contractor-only internal notes.
		for (const note of o.notes ?? []) {
			await db.insert(timelineEntry).values({
				orderId,
				kind: 'note',
				title: 'Note',
				detail: note,
				authorRole: 'contractor',
				internal: true
			});
		}
	}

	// A couple of unread notifications for the bell.
	await db.insert(notification).values([
		{
			userId: contractorId,
			title: 'Question from customer: Mina Patel',
			detail: 'Can we start a week earlier?',
			priority: 'standard',
			unread: true
		},
		{
			userId: contractorId,
			title: 'Issue reported: Nina Brooks',
			detail: 'Gazebo trim needs a touch-up.',
			priority: 'high',
			unread: true
		}
	]);
}
