import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { customer, order, orderMessage, timelineEntry } from './db/schema';

/**
 * The sample workspace behind the dev contractor login.
 *
 * Separate from the demo contractor's fixtures (scripts/demo-fixtures.js) for
 * one reason that matters: the demo's customers are records with no login behind
 * them, so that account can never show a message thread. The dev customer IS
 * bound to a real User, which makes this the only seeded account where the
 * two-sided conversation — and therefore the dashboard's "waiting on you" — can
 * be seen at all.
 *
 * The set is chosen to put every follow-up state on screen at once:
 *
 *   - two jobs overdue, by different amounts, so "4 days overdue" and "1 day
 *     overdue" can be told apart at a glance;
 *   - two due today, which must look different from overdue rather than merely
 *     less red;
 *   - one still ahead, so a dashboard of nothing but alarms isn't the only thing
 *     the styling is ever checked against;
 *   - two carrying a customer conversation, one answered and one not, because
 *     only the unanswered one belongs in "waiting on you".
 */

/** Local midnight `offset` days from today. */
function dayOffset(offset: number): Date {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() + offset);
	return d;
}

/** `hoursAgo` before now — for message timestamps, which want a time of day. */
function hoursAgo(hours: number): Date {
	return new Date(Date.now() - hours * 60 * 60 * 1000);
}

type SeedCustomer = {
	key: string;
	name: string;
	email: string;
	phone: string;
	address: string;
	city: string;
	state: string;
	postalCode: string;
};

/**
 * The linked one. Its email must match DEV_CUSTOMER_LOGIN so the portal account
 * binds to it — that binding is what the whole customer half of the app hangs
 * off, so this record is the one thing here that is not free to change.
 */
export const DEV_LINKED_CUSTOMER_EMAIL = 'customer@upliftcollective.dev';

const CUSTOMERS: SeedCustomer[] = [
	{
		key: 'dev',
		name: 'Dev Customer',
		email: DEV_LINKED_CUSTOMER_EMAIL,
		phone: '(555) 013-0100',
		address: '742 Evergreen Terrace',
		city: 'Springfield',
		state: 'OR',
		postalCode: '97477'
	},
	{
		key: 'marisol',
		name: 'Marisol Vega',
		email: 'marisol.vega@example.com',
		phone: '(555) 240-8817',
		address: '1180 Alder Street',
		city: 'Eugene',
		state: 'OR',
		postalCode: '97401'
	},
	{
		key: 'theo',
		name: 'Theo Brandt',
		email: 'theo.brandt@example.com',
		phone: '(555) 771-3364',
		address: '58 Kestrel Lane',
		city: 'Corvallis',
		state: 'OR',
		postalCode: '97330'
	}
];

type SeedMessage = { from: 'customer' | 'contractor'; body: string; hoursAgo: number };

type SeedOrder = {
	customerKey: string;
	projectName: string;
	projectType: string;
	state: string;
	icon: string;
	tags: string[];
	/** Days from today. Negative is overdue, 0 is due today, null is no follow-up. */
	followUpDays: number | null;
	timeline: { kind: string; title: string; detail: string; internal?: boolean }[];
	/** Only meaningful on the linked customer's orders — see the note up top. */
	messages?: SeedMessage[];
};

const ORDERS: SeedOrder[] = [
	{
		customerKey: 'dev',
		projectName: 'Kitchen remodel',
		projectType: 'Renovation',
		state: 'In Progress',
		icon: '🔨',
		tags: ['deposit paid'],
		// Overdue AND unanswered: the worst combination, and the one the dashboard
		// should be loudest about.
		followUpDays: -4,
		timeline: [
			{ kind: 'status', title: 'Quote accepted', detail: 'Signed and returned — thanks!' },
			{
				kind: 'milestone',
				title: 'Cabinets ordered',
				detail: 'Six to eight weeks out from the supplier.'
			},
			{
				kind: 'note',
				title: 'Supplier margin check',
				detail: 'Internal only — this must never appear in the portal.',
				// Deliberately present: the portal filters internal entries in the
				// query, and this row is what makes that visible when you look.
				internal: true
			},
			{
				kind: 'status',
				title: 'Demolition complete',
				detail: 'Old units out, walls patched and ready.'
			}
		],
		messages: [
			{
				from: 'contractor',
				body: 'Demo is done and the walls are patched. Cabinets are still with the supplier.',
				hoursAgo: 76
			},
			{
				from: 'customer',
				body: 'Great news. Any word on when the cabinets land? We are trying to book time off.',
				hoursAgo: 50
			},
			{
				from: 'customer',
				body: 'Also — is the old sink something we need to dispose of, or do you take it?',
				hoursAgo: 49
			}
		]
	},
	{
		customerKey: 'dev',
		projectName: 'Backyard deck rebuild',
		projectType: 'Deck',
		state: 'Work Scheduled',
		icon: '🪵',
		tags: ['cedar'],
		// Due today, and the conversation is already answered — so this one shows
		// up under follow-ups but NOT under "waiting on you".
		followUpDays: 0,
		timeline: [
			{ kind: 'status', title: 'Quote sent', detail: 'Cedar, 16x20, railing included.' },
			{ kind: 'status', title: 'Work scheduled', detail: 'Crew booked for the 14th.' }
		],
		messages: [
			{ from: 'customer', body: 'Does the crew need access to the side gate?', hoursAgo: 30 },
			{
				from: 'contractor',
				body: 'Yes please — if you can unlock it the morning of the 14th that is all we need.',
				hoursAgo: 28
			}
		]
	},
	{
		customerKey: 'marisol',
		projectName: 'Garage conversion',
		projectType: 'Renovation',
		state: 'Deposit Pending',
		icon: '🏠',
		tags: ['awaiting deposit'],
		// Overdue by one day: the near-miss case, so "1 day overdue" gets its
		// singular checked as well as the plural.
		followUpDays: -1,
		timeline: [
			{ kind: 'status', title: 'Quote sent', detail: 'Insulation, drywall and one egress window.' },
			{ kind: 'note', title: 'Left a voicemail about the deposit.', detail: '', internal: true }
		]
	},
	{
		customerKey: 'theo',
		projectName: 'Front porch railing',
		projectType: 'Deck',
		state: 'Quote Sent',
		icon: '📐',
		tags: [],
		followUpDays: 0,
		timeline: [
			{ kind: 'status', title: 'Quote sent', detail: 'Powder-coated aluminium, 22 linear feet.' }
		]
	},
	{
		customerKey: 'marisol',
		projectName: 'Pole barn',
		projectType: 'Pole Barn',
		state: 'Parts Ordered',
		icon: '🚧',
		tags: [],
		// Not due. Here so the dashboard is never checked ONLY in its alarming
		// state — an order list where every row is red proves nothing about
		// whether red reads as urgent.
		followUpDays: 4,
		timeline: [{ kind: 'status', title: 'Trusses ordered', detail: 'ETA three weeks.' }]
	}
];

/** Create the customer if absent, and re-link it in case the user row was rebuilt. */
async function ensureCustomer(
	contractorId: string,
	seed: SeedCustomer,
	linkedUserId: string | null
): Promise<string> {
	const existing = await db.query.customer.findFirst({
		where: and(eq(customer.contractorId, contractorId), eq(customer.email, seed.email)),
		columns: { id: true }
	});
	if (existing) {
		if (linkedUserId) {
			await db.update(customer).set({ userId: linkedUserId }).where(eq(customer.id, existing.id));
		}
		return existing.id;
	}
	const [row] = await db
		.insert(customer)
		.values({
			contractorId,
			name: seed.name,
			email: seed.email,
			phone: seed.phone,
			address: seed.address,
			city: seed.city,
			state: seed.state,
			postalCode: seed.postalCode,
			userId: linkedUserId
		})
		.returning({ id: customer.id });
	return row.id;
}

/**
 * Create the order if absent — and either way, re-stamp its follow-up date.
 *
 * The re-stamp is the point. These dates are the whole reason the fixture
 * exists, and a date stored once is only correct on the day it was written: a
 * database seeded last week has five orders that are all "overdue" by however
 * long the laptop was shut, and the due-today case can never be seen again. So
 * the OFFSETS are what is seeded, and the dates are recomputed on every boot.
 *
 * The cost is that a follow-up you snoozed by hand while poking at the UI is
 * back where it started after a restart. That is the right trade for a fixture
 * whose job is to show these states — snoozing is better exercised on an order
 * you made yourself.
 */
async function ensureOrder(
	contractorId: string,
	customerId: string,
	seed: SeedOrder
): Promise<{ id: string; created: boolean }> {
	const followUpAt = seed.followUpDays === null ? null : dayOffset(seed.followUpDays);

	const existing = await db.query.order.findFirst({
		where: and(eq(order.contractorId, contractorId), eq(order.projectName, seed.projectName)),
		columns: { id: true }
	});
	if (existing) {
		await db.update(order).set({ nextFollowUpAt: followUpAt }).where(eq(order.id, existing.id));
		return { id: existing.id, created: false };
	}

	const [row] = await db
		.insert(order)
		.values({
			contractorId,
			customerId,
			projectName: seed.projectName,
			projectType: seed.projectType,
			state: seed.state,
			icon: seed.icon,
			tags: seed.tags,
			nextFollowUpAt: followUpAt
		})
		.returning({ id: order.id });
	return { id: row.id, created: true };
}

/**
 * Seed an order's history and conversation, but only while both are empty.
 *
 * A portal you have been messing with keeps what you said to it across a
 * restart — the alternative is a fixture that quietly deletes your test messages
 * every time the server reloads.
 */
async function ensureOrderContent(
	orderId: string,
	seed: SeedOrder,
	contractorUserId: string,
	customerUserId: string
): Promise<void> {
	const [hasTimeline] = await db
		.select({ id: timelineEntry.id })
		.from(timelineEntry)
		.where(eq(timelineEntry.orderId, orderId))
		.limit(1);
	if (!hasTimeline && seed.timeline.length > 0) {
		await db.insert(timelineEntry).values(
			seed.timeline.map((t) => ({
				orderId,
				kind: t.kind,
				title: t.title,
				detail: t.detail,
				authorRole: 'contractor',
				internal: t.internal ?? false
			}))
		);
	}

	if (!seed.messages?.length) return;
	const [hasMessages] = await db
		.select({ id: orderMessage.id })
		.from(orderMessage)
		.where(eq(orderMessage.orderId, orderId))
		.limit(1);
	if (hasMessages) return;

	await db.insert(orderMessage).values(
		seed.messages.map((m) => {
			const createdAt = hoursAgo(m.hoursAgo);
			return {
				orderId,
				authorRole: m.from,
				authorUserId: m.from === 'customer' ? customerUserId : contractorUserId,
				topic: 'general',
				body: m.body,
				// Marked read on both sides. "Waiting on you" is decided by who spoke
				// LAST, not by what is unread (see threadsAwaitingReply), so seeding
				// these read is the more demanding fixture: the kitchen remodel still
				// has to show up as owed even though the contractor has already seen
				// the questions — which is the exact case an unread-based signal got
				// wrong, by vanishing the moment you glanced at the thread.
				readByContractorAt: createdAt,
				readByCustomerAt: createdAt,
				createdAt
			};
		})
	);
}

/**
 * Provision the dev contractor's sample workspace. Idempotent: safe to run at
 * every boot, and it will repair a partially-seeded database rather than
 * duplicating it.
 */
export async function ensureDevWorkspace(
	contractorUserId: string,
	customerUserId: string
): Promise<void> {
	const customerIds = new Map<string, string>();
	for (const seed of CUSTOMERS) {
		const linkedUserId = seed.email === DEV_LINKED_CUSTOMER_EMAIL ? customerUserId : null;
		customerIds.set(seed.key, await ensureCustomer(contractorUserId, seed, linkedUserId));
	}

	for (const seed of ORDERS) {
		const customerId = customerIds.get(seed.customerKey);
		if (!customerId) continue;
		const { id } = await ensureOrder(contractorUserId, customerId, seed);
		await ensureOrderContent(id, seed, contractorUserId, customerUserId);
	}
}
