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

/**
 * @typedef {{
 *   key: string, name: string, email: string,
 *   phone: string | null, address: string | null, notes: string | null,
 *   tags: string[], avatar: string | null, preferredContact: 'email' | 'phone'
 * }} DemoCustomer
 */

/**
 * @typedef {{
 *   cust: string, project: string, type: string, state: string,
 *   followUpDays: number | null, notes?: string[], icon?: string | null
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
		email: 'mina.patel@example.com',
		phone: '(555) 201-4477',
		address: '88 Cedar Ln, Springfield',
		notes: 'Prefers cedar. Repeat client — third project.',
		tags: ['repeat', 'deck'],
		avatar: '/img/maya.png',
		preferredContact: 'phone'
	},
	{
		key: 'luis',
		name: 'Luis Ortega',
		email: 'luis.ortega@example.com',
		phone: '(555) 332-9080',
		address: '14 Elm St, Springfield',
		notes: 'Referred by Mina.',
		tags: ['referral'],
		avatar: '/img/alex.png',
		preferredContact: 'email'
	},
	{
		key: 'nina',
		name: 'Nina Brooks',
		email: 'nina.brooks@example.com',
		phone: '(555) 776-1220',
		address: '901 Oak Ave, Riverton',
		notes: 'HOA board contact — needs itemized quotes.',
		tags: ['commercial'],
		avatar: '/img/mia.png',
		preferredContact: 'phone'
	},
	{
		key: 'sam',
		name: 'Sam Rivera',
		email: 'sam.rivera@example.com',
		phone: null,
		address: null,
		notes: null,
		tags: [],
		avatar: '/img/noah.png',
		preferredContact: 'email'
	}
];

/** @type {DemoOrder[]} */
export const DEMO_ORDERS = [
	{
		cust: 'mina',
		project: 'Backyard Deck Rebuild',
		type: 'Deck',
		state: 'In Progress',
		followUpDays: -1, // overdue → shows as "due"
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
		notes: ['Left a voicemail about the deposit.'],
		icon: '🏗️'
	},
	{
		cust: 'nina',
		project: 'HOA Community Pavilion',
		type: 'Pavilion',
		state: 'Work Scheduled',
		followUpDays: 6,
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
	{ cust: 'sam', project: 'Tool Shed', type: 'Shed', state: 'Inquiry', followUpDays: 0, icon: '🏠' } // due today
];

/**
 * @typedef {{
 *   key: string, name: string, email: string, phone: string | null,
 *   company: string | null, trade: string | null, tier: 'trusted' | 'guest',
 *   licenseNumber: string | null, insuranceCarrier: string | null,
 *   insuranceDays: number | null, notes: string | null, tags: string[],
 *   avatar: string | null, invited?: boolean
 * }} DemoSubcontractor
 */

/** @type {DemoSubcontractor[]} */
export const DEMO_SUBCONTRACTORS = [
	{
		key: 'rae',
		name: 'Rae Sparks',
		email: 'rae.sparks@example.com',
		phone: '(555) 480-1122',
		company: 'Sparks Electric',
		trade: 'Electrical',
		tier: 'trusted',
		licenseNumber: 'EC-99213',
		insuranceCarrier: 'Statewide Mutual',
		insuranceDays: 120, // valid, expires in ~4 months
		notes: 'Go-to electrician. Fast, fully licensed and insured.',
		tags: ['licensed', 'insured'],
		avatar: '/img/ben.png'
	},
	{
		key: 'cody',
		name: 'Cody Nash',
		email: 'cody.nash@example.com',
		phone: '(555) 771-3346',
		company: 'Nash Concrete',
		trade: 'Concrete',
		tier: 'guest',
		licenseNumber: null,
		insuranceCarrier: 'Ironclad Insurance',
		insuranceDays: -20, // expired — stored for reference, never enforced
		notes: 'Concrete crew for footings. Insurance lapsed; kept for records only.',
		tags: ['concrete'],
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
