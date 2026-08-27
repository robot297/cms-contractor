import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { customer, lineItem, order, orderMessage, payment, timelineEntry } from './db/schema';

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

/** `daysAgo` before now, at midday — for payment dates, which want a calendar day. */
function daysAgo(days: number): Date {
	const d = dayOffset(-days);
	d.setHours(12, 0, 0, 0);
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

/**
 * Twin Cities addresses, and the reason they are: the dashboard estimates drive
 * time between the day's jobs, and the fixture set this replaced was spread
 * across three Oregon towns, which produced legs nobody could sanity-check at a
 * glance. These sit in one real metro — Minneapolis, Saint Paul, Edina,
 * Stillwater — so the estimates come out as journeys a person can recognise
 * (about nine miles city-to-city, about twenty-five out to Stillwater) and a
 * wrong one is obvious.
 *
 * One metro is a property of THIS FIXTURE, not of the app. Nothing assumes a
 * contractor works in a single state: addresses carry their own state code,
 * `customerLocation()` renders whatever pair it is given, and the validator
 * accepts any real code. A contractor working across a state line is supported —
 * it is just not what a drive-time fixture should be demonstrating.
 *
 * The ZIPs are real, which matters: coordinates are resolved from them.
 */
const CUSTOMERS: SeedCustomer[] = [
	{
		key: 'dev',
		name: 'Dev Customer',
		email: DEV_LINKED_CUSTOMER_EMAIL,
		phone: '(555) 013-0100',
		address: '2841 Girard Avenue S',
		city: 'Minneapolis',
		state: 'MN',
		postalCode: '55408'
	},
	{
		key: 'marisol',
		name: 'Marisol Vega',
		email: 'marisol.vega@example.com',
		phone: '(555) 240-8817',
		address: '1180 Selby Avenue',
		city: 'Saint Paul',
		state: 'MN',
		postalCode: '55104'
	},
	{
		key: 'theo',
		name: 'Theo Brandt',
		email: 'theo.brandt@example.com',
		phone: '(555) 771-3364',
		address: '58 Woodland Road',
		city: 'Edina',
		state: 'MN',
		postalCode: '55424'
	}
];

type SeedMessage = { from: 'customer' | 'contractor'; body: string; hoursAgo: number };

/** A payment on a seeded order. `daysAgo` keeps the dates moving with today. */
type SeedPayment = {
	kind: 'deposit' | 'progress' | 'final';
	amountCents: number;
	method: string;
	note?: string;
	daysAgo: number;
};

type SeedOrder = {
	customerKey: string;
	projectName: string;
	projectType: string;
	state: string;
	icon: string;
	/** Days from today. Negative is overdue, 0 is due today, null is no follow-up. */
	followUpDays: number | null;
	timeline: { kind: string; title: string; detail: string; internal?: boolean }[];
	/** Only meaningful on the linked customer's orders — see the note up top. */
	messages?: SeedMessage[];
	/**
	 * The agreed job total, in whole cents. Between them the seeded orders below
	 * cover every state `invoiceSummary` can report — nothing agreed, a deposit
	 * against a balance, a balance owed in full, and paid off — so the invoice
	 * card, the portal's copy and the emailed document can each be looked at in
	 * all of them without staging a job by hand first.
	 */
	totalCents?: number;
	payments?: SeedPayment[];
	/**
	 * The breakdown behind the total. When present the total is their SUM and
	 * `totalCents` is ignored (see `invoiceSummary`) — seeded on one order only, so
	 * both an itemised invoice and a lump-sum one are on screen to compare.
	 */
	lineItems?: { label: string; amountCents: number }[];
	/** Close-out details. Customer-visible: they appear on the invoice. */
	finalNotes?: string;
	/** What the job is, where it happens and when — the Details card. */
	description?: string;
	site?: { address: string; city: string; state: string; postalCode: string };
	startDays?: number;
	targetDays?: number;
	/** Days from today for the on-site visit — 0 puts the job on today's run. */
	visitDays?: number;
};

const ORDERS: SeedOrder[] = [
	{
		customerKey: 'dev',
		projectName: 'Kitchen remodel',
		projectType: 'Renovation',
		state: 'In Progress',
		icon: '🔨',
		// The headline money case: half up front, half still to come. This is the
		// one to look at when checking that "Balance due" reads correctly on the
		// contractor's card, on the portal, and in the previewed email.
		totalCents: 1_840_000,
		lineItems: [
			{ label: 'Cabinets and hardware', amountCents: 940_000 },
			{ label: 'Countertops — quartz', amountCents: 420_000 },
			{ label: 'Labour', amountCents: 460_000 },
			{ label: 'Repeat customer discount', amountCents: -20_000 }
		],
		payments: [
			{ kind: 'deposit', amountCents: 920_000, method: 'check', note: 'check #1041', daysAgo: 26 }
		],
		description:
			'Full gut of the galley kitchen. New cabinet runs both sides, quartz counters, ' +
			'move the sink to the window wall and re-route the waste. Appliances are the ' +
			"customer's own.",
		startDays: -26,
		targetDays: 12,
		visitDays: 0,
		// Overdue AND unanswered: the worst combination, and the one the dashboard
		// should be loudest about.
		followUpDays: -4,
		timeline: [
			{ kind: 'status', title: 'Quote accepted', detail: 'Signed and returned — thanks!' },
			// The invoice's own history. Seeded to match `lineItems` below, because
			// the fixture inserts those rows directly and so never goes through
			// `addLineItem` — without these the demo shows an itemised invoice with
			// no record of it being itemised, which is the opposite of the point.
			{
				kind: 'invoice',
				title: 'Invoice itemised',
				detail: 'Cabinets and hardware — $9,400.00 · Total $9,400.00'
			},
			{
				kind: 'invoice',
				title: 'Line added',
				detail: 'Countertops — quartz — $4,200.00 · Total $13,600.00'
			},
			{ kind: 'invoice', title: 'Line added', detail: 'Labour — $4,600.00 · Total $18,200.00' },
			{
				kind: 'invoice',
				title: 'Line added',
				detail: 'Repeat customer discount — -$200.00 · Total $18,000.00'
			},
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
		// A total agreed and nothing paid against it yet — the whole amount reads as
		// outstanding, which is the state a "deposit due" job is actually in.
		totalCents: 1_260_000,
		description:
			'Tear out the failing cedar deck, re-frame the two rotten joists, rebuild 16x20 with a railing and one step down to the lawn.',
		// The one seeded job that is NOT at the customer's own address, so the
		// Details card's site line has something to show.
		site: { address: '412 Nelson Street', city: 'Stillwater', state: 'MN', postalCode: '55082' },
		startDays: 5,
		targetDays: 19,
		// The second and last stop today. Two is what a real day looks like — one
		// site, sometimes two — and a different town from the first so the drive
		// time measures a real distance rather than zero.
		visitDays: 0,
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
		totalCents: 980_000,
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
		followUpDays: 0,
		timeline: [
			{ kind: 'status', title: 'Quote sent', detail: 'Powder-coated aluminium, 22 linear feet.' }
		]
	},
	{
		// Finished and square. The only seeded order whose invoice is SETTLED, which
		// makes it the one to open when checking that the email calls itself a
		// receipt rather than an invoice, and that the portal says "Paid in full"
		// instead of showing a balance of $0.00 as though something were owed.
		customerKey: 'dev',
		projectName: 'Guest bath tile',
		projectType: 'Renovation',
		state: 'Work Complete',
		icon: '🧱',
		followUpDays: null,
		totalCents: 640_000,
		finalNotes: 'Porcelain subway tile, new pan and glass door. Grout sealed on the second visit.',
		payments: [
			{ kind: 'deposit', amountCents: 320_000, method: 'card', daysAgo: 58 },
			{ kind: 'final', amountCents: 320_000, method: 'check', note: 'check #1102', daysAgo: 12 }
		],
		timeline: [
			{ kind: 'status', title: 'Quote accepted', detail: 'Tile picked, pan ordered.' },
			{ kind: 'milestone', title: 'Work Complete', detail: 'Sealed and signed off.' }
		]
	},
	{
		customerKey: 'marisol',
		projectName: 'Pole barn',
		projectType: 'Pole Barn',
		state: 'Parts Ordered',
		icon: '🚧',
		// Not due. Here so the dashboard is never checked ONLY in its alarming
		// state — an order list where every row is red proves nothing about
		// whether red reads as urgent.
		followUpDays: 4,
		timeline: [{ kind: 'status', title: 'Trusses ordered', detail: 'ETA three weeks.' }]
	}
];

/** The Details columns for one seed, re-stamped on every boot like the dates. */
function detailColumns(seed: SeedOrder) {
	return {
		description: seed.description ?? null,
		siteAddress: seed.site?.address ?? null,
		siteCity: seed.site?.city ?? null,
		siteState: seed.site?.state ?? null,
		sitePostalCode: seed.site?.postalCode ?? null,
		startDate: seed.startDays == null ? null : dayOffset(seed.startDays),
		targetDate: seed.targetDays == null ? null : dayOffset(seed.targetDays),
		visitDate: seed.visitDays == null ? null : dayOffset(seed.visitDays)
	};
}

/**
 * Create the customer if absent — and either way, re-stamp the fixture's own
 * fields and re-link it in case the user row was rebuilt.
 *
 * The re-stamp is not cosmetic. This function matches on EMAIL, and for a long
 * time it updated nothing but `userId` when it found a row. So a database seeded
 * against an older fixture set kept that set's addresses forever: the Twin
 * Cities move below never reached a dev machine that had already seeded the
 * Oregon ones, and the dashboard happily showed a Portland job sitting next to a
 * Minneapolis one. The order half of the fixture never had this problem because
 * `ensureOrder` re-stamps `detailColumns` — the site address included — on every
 * boot. This is that same rule applied to the customer half.
 *
 * The cost is the same trade `ensureOrder` documents: a fixture customer you
 * edited by hand in the UI is back to the seeded values after a restart. That is
 * correct for rows this file owns — edit a customer you made yourself.
 */
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
		await db
			.update(customer)
			.set({
				name: seed.name,
				phone: seed.phone,
				address: seed.address,
				city: seed.city,
				state: seed.state,
				postalCode: seed.postalCode,
				// Only when there IS one: a null here would unlink the portal customer
				// on any boot that runs before the user row is rebuilt.
				...(linkedUserId ? { userId: linkedUserId } : {})
			})
			.where(eq(customer.id, existing.id));
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
		// The total and the close-out notes are re-stamped along with the follow-up
		// date: they are part of what this fixture is demonstrating, so a database
		// seeded before they existed should grow them rather than stay moneyless.
		await db
			.update(order)
			.set({
				nextFollowUpAt: followUpAt,
				finalAmountCents: seed.totalCents ?? null,
				finalNotes: seed.finalNotes ?? null,
				...detailColumns(seed)
			})
			.where(eq(order.id, existing.id));
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
			nextFollowUpAt: followUpAt,
			finalAmountCents: seed.totalCents ?? null,
			finalNotes: seed.finalNotes ?? null,
			...detailColumns(seed)
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

	// Payments, seeded only while the order has none — same rule as the timeline
	// above, so a payment you record by hand while poking at the UI survives a
	// restart instead of being wiped by the fixture that seeded its neighbours.
	if (seed.payments?.length) {
		const [hasPayment] = await db
			.select({ id: payment.id })
			.from(payment)
			.where(eq(payment.orderId, orderId))
			.limit(1);
		if (!hasPayment) {
			await db.insert(payment).values(
				seed.payments.map((p) => ({
					orderId,
					kind: p.kind,
					amountCents: p.amountCents,
					method: p.method,
					note: p.note ?? null,
					receivedAt: daysAgo(p.daysAgo)
				}))
			);
		}
	}

	if (seed.lineItems?.length) {
		const [hasLine] = await db
			.select({ id: lineItem.id })
			.from(lineItem)
			.where(eq(lineItem.orderId, orderId))
			.limit(1);
		if (!hasLine) {
			await db.insert(lineItem).values(
				seed.lineItems.map((l, i) => ({
					orderId,
					label: l.label,
					amountCents: l.amountCents,
					position: i
				}))
			);
		}
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
