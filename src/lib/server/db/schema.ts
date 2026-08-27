import { relations, sql } from 'drizzle-orm';
import {
	boolean,
	customType,
	date,
	doublePrecision,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema';

// Postgres `bytea` for storing document bytes directly in the database.
const bytea = customType<{ data: Buffer; default: false }>({
	dataType() {
		return 'bytea';
	}
});

// A first-class, contractor-scoped customer record. Exists independently of any
// order. Optionally links to a login (`userId`) once an invite is accepted.
export const customer = pgTable(
	'customer',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		contractorId: text('contractor_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		email: text('email').notNull(),
		phone: text('phone'),
		// The contractor's preferred way to reach this customer: 'email' | 'call' |
		// 'text' (legacy 'phone' is read as 'call'). Drives which contact action is
		// highlighted as preferred in the UI.
		preferredContact: text('preferred_contact').notNull().default('email'),
		// Service / mailing address. `address` is the street line only; city, state
		// and postal code are captured separately so "where is this job" is a field
		// we can read rather than a string we have to guess at. Rows created before
		// this split may still carry a whole address in `address` with the rest
		// null — `customerLocation` falls back to parsing it. See scripts/
		// backfill-customer-address.mjs.
		address: text('address'),
		city: text('city'),
		// Two-letter US state code, uppercase. See US_STATES.
		state: text('state'),
		postalCode: text('postal_code'),
		// Project details and any other free-form context about this customer.
		notes: text('notes'),
		// A downscaled photo of the customer, stored as a bounded data URL.
		avatar: text('avatar'),
		// Set when an invited customer accepts and binds their login (by token).
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		// Soft-archive marker: archived customers drop out of the directory.
		archivedAt: timestamp('archived_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [
		// A contractor cannot hold two customers with the same email.
		uniqueIndex('customer_contractor_email_idx').on(table.contractorId, table.email),
		index('customer_contractorId_idx').on(table.contractorId),
		index('customer_userId_idx').on(table.userId)
	]
);

// A first-class, contractor-scoped subcontractor (trade partner) record. Mirrors
// the `customer` record↔User↔Invite spine (see ADR-0003): it exists independently
// of any order and optionally links to a login (`userId`) once an invite is
// accepted. The `tier` gates portal visibility + write access across all of this
// sub's order assignments.
export const subcontractor = pgTable(
	'subcontractor',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		contractorId: text('contractor_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		email: text('email').notNull(),
		phone: text('phone'),
		address: text('address'),
		// The company/crew the sub trades under, if any.
		company: text('company'),
		// The trade/specialty (e.g. Electrical, Framing); free-form for the MVP.
		trade: text('trade'),
		// Access tier: 'trusted' (full order + write) | 'guest' (redacted PII, read-only).
		// New subs default to least privilege.
		tier: text('tier').notNull().default('guest'),
		// License / insurance are stored for reference only — no compliance alerts (v1).
		licenseNumber: text('license_number'),
		licenseExpiresAt: timestamp('license_expires_at'),
		insuranceCarrier: text('insurance_carrier'),
		insuranceExpiresAt: timestamp('insurance_expires_at'),
		notes: text('notes'),
		avatar: text('avatar'),
		// Set when an invited sub accepts and binds their login (by token).
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		// Soft-archive marker: archived subs drop out of the active roster.
		archivedAt: timestamp('archived_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [
		// A contractor cannot hold two subcontractors with the same email.
		uniqueIndex('subcontractor_contractor_email_idx').on(table.contractorId, table.email),
		index('subcontractor_contractorId_idx').on(table.contractorId),
		index('subcontractor_userId_idx').on(table.userId)
	]
);

// ---------------------------------------------------------------- Workers
//
// The people who turn up and do the work alongside the contractor — a crew hand,
// a labourer, the two peers who ride out with them on most jobs.
//
// A SEPARATE TABLE from `subcontractor`, deliberately, and the difference is not
// cosmetic. A subcontractor is a business the contractor engages: it has a tier
// governing what it may see, a licence and insurance held on file, an invite
// that grants a portal login, and its own liability. A worker has none of that
// and must never accidentally acquire it. Modelling this as a `kind` column on
// `subcontractor` would have meant every existing query needing `where kind =
// 'subcontractor'`, and the first one anybody forgot would put a crew hand in the
// roster wearing an access tier and an "Invite to portal" button.
//
// What is ABSENT here is the feature:
//   - no `tier`      — a worker is never granted portal access, so there is
//                      nothing to scope
//   - no licence/insurance — that is a compliance record for an engaged business
//   - no `userId`    — no login binds to a worker; nothing to bind
//   - no invite table — see above
//
// `email` is nullable, which `subcontractor.email` is not. A subcontractor needs
// one because the invite is delivered there; a crew hand may only ever be a name
// and a mobile number, and demanding an address for them would mean inventing
// fake ones.
export const worker = pgTable(
	'worker',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		contractorId: text('contractor_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// Optional, unlike a subcontractor's — see the note above.
		email: text('email'),
		phone: text('phone'),
		// What they do on site: "Framer", "Helper", "Operator". Free-form, because
		// a fixed list of trades is a different product's idea of a crew.
		role: text('role'),
		// Who they trade under, if anyone. The same column `subcontractor` carries,
		// and it is here because the individual/business split is not a real one: a
		// crew hand can perfectly well be an Acme employee while Acme is separately
		// engaged as a subcontractor. Company is a fact about a person, not a
		// different species of person.
		company: text('company'),
		notes: text('notes'),
		avatar: text('avatar'),
		// Soft-archive: an archived worker drops out of the crew picker but stays
		// on every job they were ever assigned to, so the history of who worked
		// where survives somebody leaving.
		archivedAt: timestamp('archived_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [
		index('worker_contractorId_idx').on(table.contractorId),
		// Only where an email was actually given. A plain unique index would treat
		// every worker without one as colliding in Postgres... except it wouldn't,
		// because NULLs are distinct — which is worse, since it silently permits
		// duplicates and looks like it doesn't. The partial index says what it
		// means: two workers may share nothing, but not an address.
		uniqueIndex('worker_contractor_email_idx')
			.on(table.contractorId, table.email)
			.where(sql`${table.email} is not null`)
	]
);

// Who is on a job, and when.
//
// A DATE RANGE rather than one row per day. "Dave is on the Miller job Monday to
// Friday" is one row here and five in a per-day model, and the per-day model
// buys nothing back: a single day is expressed by setting both ends to the same
// date, so the range subsumes it. Both ends are nullable, which means "on this
// job, no dates pinned yet" — the common case when a job is still being planned.
//
// One row per (order, worker): assigning somebody already on the job edits their
// dates rather than stacking a second entry. A worker who leaves and returns is
// two stints in real life, but showing the same name twice in a crew list reads
// as a bug far more often than it reads as history, and the timeline records
// both changes either way.
export const orderWorker = pgTable(
	'order_worker',
	{
		orderId: text('order_id')
			.notNull()
			.references(() => order.id, { onDelete: 'cascade' }),
		workerId: text('worker_id')
			.notNull()
			.references(() => worker.id, { onDelete: 'cascade' }),
		// `date`, not `timestamp`: a shift is a calendar day where the JOB is, and
		// a timestamp would drag a timezone into a question that has none. Stored
		// and returned as `YYYY-MM-DD` strings for the same reason.
		startsOn: date('starts_on'),
		endsOn: date('ends_on'),
		// What they are doing on THIS job, when it differs from their usual role.
		role: text('role'),
		notes: text('notes'),
		assignedAt: timestamp('assigned_at').defaultNow().notNull()
	},
	(table) => [
		primaryKey({ columns: [table.orderId, table.workerId] }),
		index('order_worker_workerId_idx').on(table.workerId),
		// "Who is on site today" scans by date across every job.
		index('order_worker_startsOn_idx').on(table.startsOn)
	]
);

export const order = pgTable(
	'order',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		contractorId: text('contractor_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		// The linked customer record — single source of truth for name/email.
		customerId: text('customer_id').references(() => customer.id, { onDelete: 'set null' }),
		// What the job is and the kind of structure being built.
		projectName: text('project_name'),
		projectType: text('project_type'),
		// An optional glyph from a fixed construction icon set (see ORDER_ICONS),
		// chosen by the contractor to convey status / build type at a glance.
		icon: text('icon'),
		state: text('state').notNull().default('Inquiry'),
		// What the job actually IS, in the contractor's own words. The order carried
		// a name and a type and nowhere to say "tear out the old cedar, re-frame the
		// two rotten joists, 16x20 with a railing" — so that lived in someone's head
		// or in a timeline note nobody could find again.
		description: text('description'),
		// Where the work happens, when that is NOT the customer's own address. Null
		// means "the customer's address", which is the common case and stays the
		// single source of truth for it — a second property, a rental or a
		// commercial site is what these are for. Stored as loose parts rather than
		// a formatted string so the same address helpers work on them.
		siteAddress: text('site_address'),
		siteCity: text('site_city'),
		siteState: text('site_state'),
		sitePostalCode: text('site_postal_code'),
		// The schedule, as two dates the contractor keeps by hand. Deliberately NOT
		// derived from the order state: "Work Scheduled" says what stage the job is
		// at, these say when it is meant to happen, and a job can sit in that state
		// for a fortnight before anyone books a crew.
		startDate: timestamp('start_date'),
		targetDate: timestamp('target_date'),
		// The day the contractor is actually ON SITE for this job.
		//
		// Distinct from all three of its neighbours, and the distinction is the
		// point: `state` says a job is Work Scheduled without saying when, the
		// follow-up is a reminder to make contact rather than to turn up, and
		// start/target bracket the whole job — a three-week build would otherwise
		// claim all twenty-one days as site visits. This is one day, and it is what
		// "today's jobs" is a query over.
		//
		// One date rather than a visits table: a job revisited weekly needs
		// re-setting each time, which is the accepted cost of not modelling
		// recurrence yet.
		visitDate: timestamp('visit_date'),
		// Contractor-set date for the next follow-up. On create it lands at their
		// `contractorSettings.followUpDays` interval — a fortnight unless changed.
		nextFollowUpAt: timestamp('next_follow_up_at'),
		// What the job COSTS, in whole cents (see ADR-0010: the app records money and
		// never processes it). Written at close-out and, since deposits existed,
		// settable from the moment a quote is agreed — half of an unknown total is
		// not a number, so a deposit needs this filled in first. What has been PAID
		// against it lives in the `payment` table; the balance is the subtraction and
		// is never stored.
		finalAmountCents: integer('final_amount_cents'),
		// Free-form invoice details / completion notes, customer-visible on the portal.
		finalNotes: text('final_notes'),
		// SUPERSEDED by the `payment` table, and no longer read or written. These two
		// were the whole of the money record when an order could only be unpaid or
		// paid-in-full; a job with a deposit has no single "how they paid" and no
		// single "when". Migration 0029 copied every row that had `paid_at` into a
		// `final` payment, so nothing was lost. Kept rather than dropped, matching
		// `expectedAt` above: the columns still hold what old rows said, and dropping
		// them is a separate decision from stopping using them.
		paymentMethod: text('payment_method'),
		paidAt: timestamp('paid_at'),
		// Soft-delete: "Delete order" sets this timestamp; rows with it set are
		// treated as gone everywhere in the app and never shown.
		deletedAt: timestamp('deleted_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [
		index('order_contractorId_idx').on(table.contractorId),
		index('order_customerId_idx').on(table.customerId)
	]
);

export const timelineEntry = pgTable(
	'timeline_entry',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		orderId: text('order_id')
			.notNull()
			.references(() => order.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(), // status | invoice | message | milestone | issue | note
		title: text('title').notNull(),
		detail: text('detail').notNull().default(''),
		authorRole: text('author_role').notNull(), // contractor | customer
		// When the contractor expects this to be resolved. DORMANT: nothing writes or
		// reads it any more — the follow-up/snooze on the order is how a wait is
		// tracked. Kept (rather than dropped) because rows written before the status
		// form lost its date picker still carry one, and the idea may come back.
		expectedAt: timestamp('expected_at'),
		// Internal entries (contractor notes) are never shown in the customer portal.
		internal: boolean('internal').notNull().default(false),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [index('timeline_orderId_idx').on(table.orderId)]
);

// The conversation on an order — what the contractor and the customer said to
// each other, as opposed to `timeline_entry`, which records what happened to the
// job. Kept apart deliberately: a thread reads oldest-first and carries per-side
// unread state, neither of which belongs on every status change ever written.
//
// Read state is two nullable timestamps rather than one `unread` flag because
// "unread" is asymmetric — the same row is read by its author the instant it is
// written and unread by the other side. A message is stamped for its own author
// on insert, so it is never unread to the person who sent it.
// Something the CONTRACTOR needs from the CUSTOMER before the job can go on.
//
// The gap this fills: every "waiting on you" the portal could say was DERIVED
// from the order's state, and only two of the ten states meant it — Deposit
// Pending and Final Payment Pending. So a contractor who needed a colour picked,
// a permit signed, a gate code, or somebody home on Thursday had nowhere to put
// it except a Message, where it read as conversation and scrolled away. A job
// could sit still for a week with the portal reporting "In progress".
//
// A Task is NOT a Message and NOT a Timeline entry, and the difference is the
// same one the rest of this schema keeps: a Message records what someone SAID, a
// Timeline entry records what HAPPENED, and a Task records what is OUTSTANDING.
// Only a Task has a state that the customer can change by doing something, which
// is why it is the only one of the three with a `completed_at`.
export const customerTask = pgTable(
	'customer_task',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		orderId: text('order_id')
			.notNull()
			.references(() => order.id, { onDelete: 'cascade' }),
		// What is needed, in the contractor's words but addressed to the customer:
		// "Pick your tile", "Sign the permit", "Pay the deposit".
		title: text('title').notNull(),
		// The optional half — where to send it, which of the three quotes, why it
		// is holding things up.
		detail: text('detail').notNull().default(''),
		// `date`, not `timestamp`, for the same reason a crew stint is: "by Friday"
		// is a calendar day and has no timezone. Null means "no date on it", which
		// is a real and common answer.
		dueOn: date('due_on'),
		// Whether the job cannot proceed until this is done. Drives nothing
		// automatic — it is a claim the contractor is making TO the customer, and
		// the portal says it in those words rather than silently reordering things.
		blocking: boolean('blocking').notNull().default(false),
		// Null while it is outstanding. The pair (completedAt, completedBy) is what
		// makes "done" a fact with an author: a contractor ticking it off on the
		// customer's behalf ("Dave paid me in cash") and the customer ticking it
		// themselves are both legitimate and are not the same event.
		completedAt: timestamp('completed_at'),
		// contractor | customer, and only meaningful alongside completedAt.
		completedBy: text('completed_by'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [
		// Every read is "the tasks on this order, outstanding first".
		index('customer_task_orderId_idx').on(table.orderId, table.completedAt)
	]
);

export const orderMessage = pgTable(
	'order_message',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		orderId: text('order_id')
			.notNull()
			.references(() => order.id, { onDelete: 'cascade' }),
		// Denormalized so rendering ("You" vs the contractor's business name) needs
		// no join and stays correct regardless of what happens to the user row.
		authorRole: text('author_role').notNull(), // contractor | customer
		authorUserId: text('author_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		// What the customer's quick action said this is about — question, payment,
		// scheduling, problem — so the contractor can triage without reading every
		// thread. `general` for a message typed straight in, and for every reply.
		topic: text('topic').notNull().default('general'),
		body: text('body').notNull(),
		readByContractorAt: timestamp('read_by_contractor_at'),
		readByCustomerAt: timestamp('read_by_customer_at'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [index('order_message_orderId_createdAt_idx').on(table.orderId, table.createdAt)]
);

// What the job is being charged FOR, one row per line.
//
// `order.final_amount_cents` was a single lump figure, which is fine on a
// handshake job and useless on anything a customer might query — "why is it
// $4,800?" had no answer in the app. These rows are that answer.
//
// The relationship to the total is a rule rather than a sync: when an order has
// ANY line items, the total IS their sum and the stored column is ignored (see
// `invoiceSummary`). Nothing writes a total back here, so the breakdown can never
// disagree with the figure printed above it — which is the failure mode of every
// invoice that keeps both and tries to keep them equal.
export const lineItem = pgTable(
	'line_item',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		orderId: text('order_id')
			.notNull()
			.references(() => order.id, { onDelete: 'cascade' }),
		// What it is: "Cedar decking", "Permit", "Change order — extra step".
		label: text('label').notNull(),
		// Whole cents, matching every other money column. Negative is allowed and
		// meaningful: a discount is a line, not a special case.
		amountCents: integer('amount_cents').notNull(),
		// Contractor-ordered. A float rather than an int so a row can be dropped
		// between two others without renumbering the rest.
		position: doublePrecision('position').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [index('line_item_orderId_position_idx').on(table.orderId, table.position)]
);

// Money the customer has actually handed over on one order, one row per payment.
//
// ADR-0010 established that the app RECORDS money and never processes it. This
// table is the same rule with the arithmetic finished: `order.finalAmountCents`
// is what the job COSTS, and these rows are what has been PAID against it, so the
// balance is a subtraction rather than a second thing to keep in sync. Before
// this existed a job could only be all-unpaid or all-paid, which is not how a
// contractor gets paid — a deposit up front and the rest on completion is the
// normal case, and it had nowhere to live.
//
// Rows rather than two columns on `order` deliberately: "deposit and balance" is
// the common shape, not the only one. A job paid in three instalments, a refund
// of an overpayment, a deposit taken in two goes — all of those are more rows,
// none of them is a migration.
export const payment = pgTable(
	'payment',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		orderId: text('order_id')
			.notNull()
			.references(() => order.id, { onDelete: 'cascade' }),
		// deposit | progress | final. What this payment WAS, in the contractor's
		// terms — it drives the invoice's line labels and nothing else. The
		// arithmetic never reads it: three payments of any kind still sum the same,
		// which is what keeps a mislabelled row from changing what someone owes.
		kind: text('kind').notNull().default('progress'),
		// Whole cents, matching `order.final_amount_cents`. Positive for money in;
		// a refund is a negative amount rather than a separate concept, so the
		// balance stays one sum.
		amountCents: integer('amount_cents').notNull(),
		// cash | check | card | other — the same set as the close-out record.
		method: text('method'),
		// What the contractor wants to remember about it ("check #1041").
		// Customer-visible: it appears on the invoice they are sent.
		note: text('note'),
		// When the money changed hands, which is NOT when the row was written — a
		// contractor records Friday's cheque on Monday, and the invoice should say
		// Friday. Defaults to now so the common case needs no thought.
		receivedAt: timestamp('received_at').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [index('payment_orderId_receivedAt_idx').on(table.orderId, table.receivedAt)]
);

export const notification = pgTable(
	'notification',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		orderId: text('order_id').references(() => order.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		detail: text('detail').notNull().default(''),
		priority: text('priority').notNull().default('standard'), // standard | high
		unread: boolean('unread').notNull().default(true),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [index('notification_userId_idx').on(table.userId)]
);

export const customerInvite = pgTable(
	'customer_invite',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		// The customer this invite binds a login to on acceptance.
		customerId: text('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
		// Optional order context; directory-level invites have no order.
		orderId: text('order_id').references(() => order.id, { onDelete: 'cascade' }),
		contractorId: text('contractor_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		customerEmail: text('customer_email').notNull(),
		token: text('token').notNull().unique(),
		status: text('status').notNull().default('pending'), // pending | revoked | used
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [
		index('invite_contractorId_idx').on(table.contractorId),
		index('invite_customerId_idx').on(table.customerId),
		index('invite_orderId_idx').on(table.orderId)
	]
);

// A parallel invite mechanism for subcontractors (ADR-0003), mirroring
// `customer_invite` without touching it. Acceptance binds a login to the
// subcontractor record by token (email fallback).
export const subcontractorInvite = pgTable(
	'subcontractor_invite',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		// The subcontractor this invite binds a login to on acceptance.
		subcontractorId: text('subcontractor_id').references(() => subcontractor.id, {
			onDelete: 'cascade'
		}),
		contractorId: text('contractor_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		subcontractorEmail: text('subcontractor_email').notNull(),
		token: text('token').notNull().unique(),
		status: text('status').notNull().default('pending'), // pending | revoked | used
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [
		index('sub_invite_contractorId_idx').on(table.contractorId),
		index('sub_invite_subcontractorId_idx').on(table.subcontractorId)
	]
);

// Many-to-many assignment of subcontractors to orders. A sub's "work" is the set
// of orders joined here; both sides cascade so history clears with either record.
export const orderSubcontractor = pgTable(
	'order_subcontractor',
	{
		orderId: text('order_id')
			.notNull()
			.references(() => order.id, { onDelete: 'cascade' }),
		subcontractorId: text('subcontractor_id')
			.notNull()
			.references(() => subcontractor.id, { onDelete: 'cascade' }),
		// The same stint the crew assignment carries, and for the same reason:
		// "Acme is here Monday to Friday" is exactly as useful a fact as it is for
		// a crew hand, and the order page shows both in one list. Nullable, so
		// every assignment written before this existed still reads as "on the job,
		// no dates pinned" rather than as a range starting at the epoch.
		startsOn: date('starts_on'),
		endsOn: date('ends_on'),
		// What they are doing on THIS job, when it differs from their usual trade.
		role: text('role'),
		notes: text('notes'),
		assignedAt: timestamp('assigned_at').defaultNow().notNull()
	},
	(table) => [
		primaryKey({ columns: [table.orderId, table.subcontractorId] }),
		index('order_subcontractor_subId_idx').on(table.subcontractorId),
		// "Who is on site today" scans by date across every job and both kinds.
		index('order_subcontractor_startsOn_idx').on(table.startsOn)
	]
);

// A Document: one file on one Order. Bytes live in `data`; size is stored
// separately so listings don't have to read the blob.
//
// Called `attachment` until the `order-documents` change. The word was half the
// problem — the UI said "Documents" on one surface and "Files" on another while
// the storage layer said "attachment", which is how the next person kept picking
// a third noun. See CONTEXT.md's Language section.
export const document = pgTable(
	'document',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		orderId: text('order_id')
			.notNull()
			.references(() => order.id, { onDelete: 'cascade' }),
		// Denormalized owner for cheap ownership checks on download/delete.
		contractorId: text('contractor_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		filename: text('filename').notNull(),
		mimeType: text('mime_type').notNull(),
		size: integer('size').notNull(),
		data: bytea('data').notNull(),
		// Who put it here — contractor | customer | subcontractor. Defaults to
		// contractor so rows that predate customer uploads keep their meaning.
		// The contractor's file list leads with this: a document the customer sent
		// is a different thing from one the contractor filed.
		uploadedByRole: text('uploaded_by_role').notNull().default('contractor'),
		// Who specifically, not merely what kind of person. Nullable because rows
		// that predate this cannot always be attributed — null means "unknown",
		// never "nobody".
		uploadedByUserId: text('uploaded_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		// When the contractor first opened this order's documents. Gates a
		// customer's withdrawal: a document that has been seen is a record of what
		// was exchanged, not a draft. Same shape as order_message's read state.
		readByContractorAt: timestamp('read_by_contractor_at'),
		// What this document is, in the uploader's words — "receipt for the tile",
		// "permit as approved". A filename rarely carries that on its own.
		note: text('note'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [index('document_orderId_idx').on(table.orderId)]
);

// Contractor-owned, reusable email templates (name, subject, body) offered in the
// contact composer. Scoped per contractor; ordered by `sortOrder` then `createdAt`.
// Placeholders in the subject/body are resolved client-side at send time.
export const emailTemplate = pgTable(
	'email_template',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		contractorId: text('contractor_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		subject: text('subject').notNull().default(''),
		body: text('body').notNull().default(''),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('email_template_contractorId_idx').on(table.contractorId)]
);

// Per-contractor branding settings. One row per contractor, lazily created. The
// signature is appended automatically to every templated email so branding never
// has to live inside individual templates.
export const contractorSettings = pgTable('contractor_settings', {
	contractorId: text('contractor_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	businessName: text('business_name').notNull().default(''),
	signature: text('signature').notNull().default(''),
	// How far out a new Order's first follow-up lands, in days. Stored per
	// contractor because the right interval is a trade, not a product decision — a
	// remodeller chasing a quote weekly and a roofer working a month out both
	// need the dashboard to stay believable. See DEFAULT_FOLLOWUP_DAYS.
	followUpDays: integer('follow_up_days').notNull().default(14),
	// Where the contractor app's navigation sits on a phone/tablet: 'top' keeps the
	// links behind the bar's hamburger, 'bottom' moves them to a fixed tab bar like
	// the customer portal's. A preference, not a capability — the same links either
	// way, and above the desktop breakpoint the rail in the bar is the nav
	// regardless. See NAV_PLACEMENTS.
	navPlacement: text('nav_placement').notNull().default('top'),
	// Getting-started Guide. Only the contractor's own choice is stored — whether a
	// step is done is always derived from their real Customers / Orders / Invites /
	// Assignments. See docs/adr/0004-derive-guide-progress-from-domain-data.md.
	guideState: text('guide_state').notNull().default('active'),
	// Steps the contractor chose to skip, by step id. Like `guideState`, this is a
	// choice that cannot be read back from domain data — "they didn't invite
	// anyone" and "they decided not to" look identical in the Customers table. An
	// array rather than a column per step, so a new skippable step needs no
	// migration.
	guideSkippedSteps: text('guide_skipped_steps').array().notNull().default([]),
	// The contractor put the trial welcome away. Same category as `guideState`: a
	// choice that cannot be read back from domain data, so it is the kind of thing
	// ADR-0004 says to store. The trial itself is still derived from `subscription`.
	trialNoticeDismissedAt: timestamp('trial_notice_dismissed_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

// A contractor's billing standing. Exactly one row per contractor, provisioned on
// signup (or lazily on their first contractor page load) and never absent.
//
// There is deliberately NO `plan` column: there is one thing to buy, priced per
// contractor, so a plan column would exist only to be branched on — and the first
// branch reintroduces the plan matrix we chose not to build. `status` plus
// `trialEndsAt` is the whole model. Monthly vs annual is a Stripe price the app
// never reads back. See docs/adr/0006-one-plan-priced-per-contractor.md.
//
// Lapsing is derived, not stored: a `trialing` row whose `trialEndsAt` has passed
// IS lapsed (see `subscriptionAccess` in src/lib/crm.ts). No scheduler writes here.
export const subscription = pgTable(
	'subscription',
	{
		contractorId: text('contractor_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		// trialing | active | past_due | lapsed | comped
		status: text('status').notNull().default('trialing'),
		// When the free trial runs out. Null for comped subscriptions, which never expire.
		trialEndsAt: timestamp('trial_ends_at'),
		// End of the current paid period, mirrored from Stripe for display.
		currentPeriodEnd: timestamp('current_period_end'),
		// Both null until the contractor first reaches checkout — a trial that never
		// converts leaves no Stripe record and costs nothing.
		stripeCustomerId: text('stripe_customer_id'),
		stripeSubscriptionId: text('stripe_subscription_id'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [
		// Webhook reduction keys on the Stripe subscription id, so it must be unique.
		uniqueIndex('subscription_stripe_subscription_idx').on(table.stripeSubscriptionId),
		index('subscription_stripe_customer_idx').on(table.stripeCustomerId)
	]
);

export const subscriptionRelations = relations(subscription, ({ one }) => ({
	contractor: one(user, { fields: [subscription.contractorId], references: [user.id] })
}));

export const emailTemplateRelations = relations(emailTemplate, ({ one }) => ({
	contractor: one(user, { fields: [emailTemplate.contractorId], references: [user.id] })
}));

export const contractorSettingsRelations = relations(contractorSettings, ({ one }) => ({
	contractor: one(user, { fields: [contractorSettings.contractorId], references: [user.id] })
}));

export const customerRelations = relations(customer, ({ one, many }) => ({
	contractor: one(user, { fields: [customer.contractorId], references: [user.id] }),
	account: one(user, { fields: [customer.userId], references: [user.id] }),
	orders: many(order),
	invites: many(customerInvite)
}));

export const orderRelations = relations(order, ({ one, many }) => ({
	contractor: one(user, { fields: [order.contractorId], references: [user.id] }),
	customer: one(customer, { fields: [order.customerId], references: [customer.id] }),
	timeline: many(timelineEntry),
	messages: many(orderMessage),
	invites: many(customerInvite),
	documents: many(document),
	assignments: many(orderSubcontractor),
	tasks: many(customerTask)
}));

export const orderMessageRelations = relations(orderMessage, ({ one }) => ({
	order: one(order, { fields: [orderMessage.orderId], references: [order.id] }),
	author: one(user, { fields: [orderMessage.authorUserId], references: [user.id] })
}));

export const subcontractorRelations = relations(subcontractor, ({ one, many }) => ({
	contractor: one(user, { fields: [subcontractor.contractorId], references: [user.id] }),
	account: one(user, { fields: [subcontractor.userId], references: [user.id] }),
	invites: many(subcontractorInvite),
	assignments: many(orderSubcontractor)
}));

export const subcontractorInviteRelations = relations(subcontractorInvite, ({ one }) => ({
	subcontractor: one(subcontractor, {
		fields: [subcontractorInvite.subcontractorId],
		references: [subcontractor.id]
	})
}));

export const orderSubcontractorRelations = relations(orderSubcontractor, ({ one }) => ({
	order: one(order, { fields: [orderSubcontractor.orderId], references: [order.id] }),
	subcontractor: one(subcontractor, {
		fields: [orderSubcontractor.subcontractorId],
		references: [subcontractor.id]
	})
}));

export const documentRelations = relations(document, ({ one }) => ({
	order: one(order, { fields: [document.orderId], references: [order.id] })
}));

export const lineItemRelations = relations(lineItem, ({ one }) => ({
	order: one(order, { fields: [lineItem.orderId], references: [order.id] })
}));

export const paymentRelations = relations(payment, ({ one }) => ({
	order: one(order, { fields: [payment.orderId], references: [order.id] })
}));

export const customerTaskRelations = relations(customerTask, ({ one }) => ({
	order: one(order, { fields: [customerTask.orderId], references: [order.id] })
}));

export const timelineEntryRelations = relations(timelineEntry, ({ one }) => ({
	order: one(order, { fields: [timelineEntry.orderId], references: [order.id] })
}));

export const customerInviteRelations = relations(customerInvite, ({ one }) => ({
	order: one(order, { fields: [customerInvite.orderId], references: [order.id] }),
	customer: one(customer, { fields: [customerInvite.customerId], references: [customer.id] })
}));

export * from './auth.schema';
