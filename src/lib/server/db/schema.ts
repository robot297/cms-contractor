import { relations } from 'drizzle-orm';
import {
	boolean,
	customType,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema';

// Postgres `bytea` for storing attachment bytes directly in the database.
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
		// Service / mailing address, free-form for the MVP.
		address: text('address'),
		// Project details and any other free-form context about this customer.
		notes: text('notes'),
		// Free-form labels the contractor applies to organize customers.
		tags: text('tags').array().notNull().default([]),
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
		insuranceCarrier: text('insurance_carrier'),
		insuranceExpiresAt: timestamp('insurance_expires_at'),
		notes: text('notes'),
		tags: text('tags').array().notNull().default([]),
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
		// Contractor-set date for the next follow-up (defaults to +3 days on create).
		nextFollowUpAt: timestamp('next_follow_up_at'),
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
		// Internal entries (contractor notes) are never shown in the customer portal.
		internal: boolean('internal').notNull().default(false),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [index('timeline_orderId_idx').on(table.orderId)]
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
		assignedAt: timestamp('assigned_at').defaultNow().notNull()
	},
	(table) => [
		primaryKey({ columns: [table.orderId, table.subcontractorId] }),
		index('order_subcontractor_subId_idx').on(table.subcontractorId)
	]
);

// Files (photos, quotes, invoices) attached to an order. Bytes live in `data`;
// size is stored separately so listings don't have to read the blob.
export const attachment = pgTable(
	'attachment',
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
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [index('attachment_orderId_idx').on(table.orderId)]
);

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
	invites: many(customerInvite),
	attachments: many(attachment),
	assignments: many(orderSubcontractor)
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

export const attachmentRelations = relations(attachment, ({ one }) => ({
	order: one(order, { fields: [attachment.orderId], references: [order.id] })
}));

export const timelineEntryRelations = relations(timelineEntry, ({ one }) => ({
	order: one(order, { fields: [timelineEntry.orderId], references: [order.id] })
}));

export const customerInviteRelations = relations(customerInvite, ({ one }) => ({
	order: one(order, { fields: [customerInvite.orderId], references: [order.id] }),
	customer: one(customer, { fields: [customerInvite.customerId], references: [customer.id] })
}));

export * from './auth.schema';
