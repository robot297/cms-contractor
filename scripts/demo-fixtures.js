// Shared sample/demo fixtures used by BOTH seeding paths:
//   - the in-app demo seeder      (src/lib/server/demo.server.ts, Drizzle)
//   - the standalone seed script  (scripts/seed.mjs, raw `node` + postgres)
//
// Plain data + pure shapes only — NO database, env, or framework imports — so
// it can be imported from a Vite-bundled server module AND a raw node script,
// and so it ships in the runtime image (Dockerfile copies scripts/). Keep this
// the single source of truth: edit the fixtures here, never in the seeders.
//
// Follow-ups are expressed as a day offset from seed time (`followUpDays`);
// each seeder converts that to an absolute Date when it runs. `null` = none.
//
// Every seeded address is one of Resend's own test addresses
// (https://resend.com/docs/dashboard/emails/send-test-emails). `example.com` is
// a reserved domain the provider rejects with a 422, so a demo contractor who
// hit "Send" filled the Resend logs with errors. `delivered+<label>@resend.dev`
// accepts the send and drops it, and the `+label` keeps each fixture address
// distinct — customer and subcontractor emails are unique per contractor.

/**
 * @typedef {{
 *   key: string, name: string, email: string,
 *   phone: string | null, address: string | null, city: string | null,
 *   state: string | null, postalCode: string | null, notes: string | null,
 *   avatar: string | null, preferredContact: 'email' | 'call' | 'text'
 * }} DemoCustomer
 */

/**
 * @typedef {{
 *   cust: string, project: string, type: string, state: string,
 *   followUpDays: number | null, notes?: string[], icon?: string | null,
 *   visitDays?: number | null
 * }} DemoOrder
 */

/**
 * @typedef {{ title: string, detail: string, priority: string }} DemoNotification
 */

/** @type {DemoCustomer[]} */
export const DEMO_CUSTOMERS = [
	{
		key: 'mina',
		name: 'Mina Patel',
		email: 'delivered+mina.patel@resend.dev',
		phone: '(555) 201-4477',
		address: '88 Cedar Lane',
		city: 'Minneapolis',
		state: 'MN',
		postalCode: '55408',
		notes: 'Prefers cedar. Repeat client — third project.',
		avatar: '/img/maya.png',
		preferredContact: 'call'
	},
	{
		key: 'luis',
		name: 'Luis Ortega',
		email: 'delivered+luis.ortega@resend.dev',
		phone: '(555) 332-9080',
		address: '14 Elm Street',
		city: 'Minneapolis',
		state: 'MN',
		postalCode: '55408',
		notes: 'Referred by Mina.',
		avatar: '/img/alex.png',
		preferredContact: 'email'
	},
	{
		key: 'nina',
		name: 'Nina Brooks',
		email: 'delivered+nina.brooks@resend.dev',
		phone: '(555) 776-1220',
		address: '901 Oak Avenue',
		city: 'Saint Paul',
		state: 'MN',
		postalCode: '55104',
		notes: 'HOA board contact — needs itemized quotes.',
		avatar: '/img/mia.png',
		preferredContact: 'call'
	},
	{
		key: 'sam',
		name: 'Sam Rivera',
		email: 'delivered+sam.rivera@resend.dev',
		phone: null,
		address: null,
		city: null,
		state: null,
		postalCode: null,
		notes: null,
		avatar: '/img/noah.png',
		preferredContact: 'email'
	},
	// Extra roster (no avatars → exercises the initials placeholder) spread
	// across the alphabet so the A–Z jump rail has something to scrub through.
	{
		key: 'aisha',
		name: 'Aisha Khan',
		email: 'delivered+aisha.khan@resend.dev',
		phone: '(555) 118-2043',
		address: '27 Birch Road',
		city: 'Saint Paul',
		state: 'MN',
		postalCode: '55104',
		notes: 'Wants a shaded patio before summer.',
		avatar: null,
		preferredContact: 'call'
	},
	{
		key: 'bianca',
		name: 'Bianca Rossi',
		email: 'delivered+bianca.rossi@resend.dev',
		phone: '(555) 204-8891',
		address: '3 Willow Court',
		city: 'Minneapolis',
		state: 'MN',
		postalCode: '55408',
		notes: null,
		avatar: null,
		preferredContact: 'email'
	},
	{
		key: 'caleb',
		name: 'Caleb Nguyen',
		email: 'delivered+caleb.nguyen@resend.dev',
		phone: '(555) 660-1177',
		address: '410 Lakeview Avenue',
		city: 'Edina',
		state: 'MN',
		postalCode: '55424',
		notes: 'Referred by Bianca.',
		avatar: null,
		preferredContact: 'call'
	},
	{
		key: 'divya',
		name: 'Divya Rao',
		email: 'delivered+divya.rao@resend.dev',
		phone: null,
		address: '88 Maple Way',
		city: 'Saint Paul',
		state: 'MN',
		postalCode: '55104',
		notes: 'HOA approval needed before scheduling.',
		avatar: null,
		preferredContact: 'email'
	},
	{
		key: 'elena',
		name: 'Elena Popov',
		email: 'delivered+elena.popov@resend.dev',
		phone: '(555) 771-3320',
		address: '15 Harbor St',
		city: 'Minneapolis',
		state: 'MN',
		postalCode: '55408',
		notes: null,
		avatar: null,
		preferredContact: 'call'
	},
	{
		key: 'grace',
		name: 'Grace Owusu',
		email: 'delivered+grace.owusu@resend.dev',
		phone: '(555) 902-4415',
		address: '502 Ridgeline Dr',
		city: 'Edina',
		state: 'MN',
		postalCode: '95628',
		notes: 'Prefers weekend site visits.',
		avatar: null,
		preferredContact: 'text'
	},
	{
		key: 'hank',
		name: 'Hank Miller',
		email: 'delivered+hank.miller@resend.dev',
		phone: '(555) 335-7788',
		address: '9 Foundry Ln',
		city: 'Saint Paul',
		state: 'MN',
		postalCode: '55104',
		notes: null,
		avatar: null,
		preferredContact: 'call'
	},
	{
		key: 'priya',
		name: 'Priya Shah',
		email: 'delivered+priya.shah@resend.dev',
		phone: '(555) 447-9012',
		address: '221 Orchard Ave',
		city: 'Minneapolis',
		state: 'MN',
		postalCode: '55408',
		notes: 'Repeat client — pole barn next.',
		avatar: null,
		preferredContact: 'email'
	},
	{
		key: 'quentin',
		name: 'Quentin Blake',
		email: 'delivered+quentin.blake@resend.dev',
		phone: null,
		address: '64 Cannery Row',
		city: 'Edina',
		state: 'MN',
		postalCode: '95628',
		notes: null,
		avatar: null,
		preferredContact: 'email'
	},
	{
		key: 'tomas',
		name: 'Tomás Vega',
		email: 'delivered+tomas.vega@resend.dev',
		phone: '(555) 613-5540',
		address: '7 Kiln St',
		city: 'Saint Paul',
		state: 'MN',
		postalCode: '55104',
		notes: 'Bilingual — Spanish preferred.',
		avatar: null,
		preferredContact: 'call'
	},
	{
		key: 'wendy',
		name: 'Wendy Zhao',
		email: 'delivered+wendy.zhao@resend.dev',
		phone: '(555) 288-6603',
		address: '133 Lakeview Ter',
		city: 'Minneapolis',
		state: 'MN',
		postalCode: '55408',
		notes: 'Detailed itemized quotes, please.',
		avatar: null,
		preferredContact: 'email'
	}
];

/**
 * @type {DemoOrder[]}
 *
 * `visitDays` is the day the crew is on site, as an offset from seed time — the
 * same trick `followUpDays` uses, and for the same reason: a date seeded once is
 * only right on the day it was written.
 *
 * TWO of them sit on 0, because that is what a real day looks like: a contractor
 * is on one site, sometimes two. A fixture showing five stops would be
 * demonstrating a route planner this product is not. The other two sit just
 * ahead, so "on site today" reads as a filter rather than as the whole list.
 */
export const DEMO_ORDERS = [
	{
		cust: 'mina',
		project: 'Backyard Deck Rebuild',
		type: 'Deck',
		state: 'In Progress',
		followUpDays: -1, // overdue → shows as "due"
		visitDays: 0, // stop 1 — Minneapolis
		notes: ['Cedar posts confirmed. Deposit paid by check.'],
		icon: '🪵'
	},
	{
		cust: 'mina',
		project: 'Poolside Pergola',
		type: 'Pergola',
		state: 'Quote Sent',
		followUpDays: 3,
		icon: '📐'
	},
	{
		cust: 'luis',
		project: 'Driveway Carport',
		type: 'Carport',
		state: 'Deposit Pending',
		followUpDays: -4, // overdue
		visitDays: 0, // the second site today — Saint Paul, ~9 miles from the first
		notes: ['Left a voicemail about the deposit.'],
		icon: '🏗️'
	},
	{
		cust: 'nina',
		project: 'HOA Community Pavilion',
		type: 'Pavilion',
		state: 'Work Scheduled',
		followUpDays: 6,
		visitDays: 2, // later in the week, not today
		icon: '🚧'
	},
	{
		cust: 'nina',
		project: 'Garden Gazebo',
		type: 'Gazebo',
		state: 'Work Complete',
		followUpDays: null,
		icon: '✅'
	},
	{
		cust: 'sam',
		project: 'Tool Shed',
		type: 'Shed',
		state: 'Inquiry',
		followUpDays: 0, // due today
		visitDays: 1, // tomorrow — so "on site today" is visibly a filter, not a list of everything
		icon: '🏠'
	}
];

/**
 * @typedef {{
 *   key: string, name: string, email: string, phone: string | null,
 *   company: string | null, trade: string | null, tier: 'trusted' | 'guest',
 *   licenseNumber: string | null, insuranceCarrier: string | null,
 *   insuranceDays: number | null, notes: string | null,
 *   avatar: string | null, invited?: boolean
 * }} DemoSubcontractor
 */

/** @type {DemoSubcontractor[]} */
export const DEMO_SUBCONTRACTORS = [
	{
		key: 'rae',
		name: 'Rae Sparks',
		email: 'delivered+rae.sparks@resend.dev',
		phone: '(555) 480-1122',
		company: 'Sparks Electric',
		trade: 'Electrical',
		tier: 'trusted',
		licenseNumber: 'EC-99213',
		insuranceCarrier: 'Statewide Mutual',
		insuranceDays: 120, // valid, expires in ~4 months
		notes: 'Go-to electrician. Fast, fully licensed and insured.',
		avatar: '/img/ben.png'
	},
	{
		key: 'cody',
		name: 'Cody Nash',
		email: 'delivered+cody.nash@resend.dev',
		phone: '(555) 771-3346',
		company: 'Nash Concrete',
		trade: 'Concrete',
		tier: 'guest',
		licenseNumber: null,
		insuranceCarrier: 'Ironclad Insurance',
		insuranceDays: -20, // expired — stored for reference, never enforced
		notes: 'Concrete crew for footings. Insurance lapsed; kept for records only.',
		avatar: '/img/liam.png',
		invited: true // shows the "Invited" status in the roster
	}
];

/**
 * Assignments join a subcontractor (by key) to an order (by project name).
 * @type {{ sub: string, order: string }[]}
 */
export const DEMO_ASSIGNMENTS = [
	{ sub: 'rae', order: 'Backyard Deck Rebuild' }, // Trusted on an in-progress job
	{ sub: 'rae', order: 'HOA Community Pavilion' },
	{ sub: 'cody', order: 'Backyard Deck Rebuild' } // Guest on the same job → both tiers
];

/** @type {DemoNotification[]} */
export const DEMO_NOTIFICATIONS = [
	{
		title: 'Question from customer: Mina Patel',
		detail: 'Can we start a week earlier?',
		priority: 'standard'
	},
	{
		title: 'Issue reported: Nina Brooks',
		detail: 'Gazebo trim needs a touch-up.',
		priority: 'high'
	}
];
