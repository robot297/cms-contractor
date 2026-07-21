import { relations } from 'drizzle-orm';
import {
	boolean,
	customType,
	index,
	integer,
	pgTable,
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
		state: text('state').notNull().default('Inquiry'),
		// Contractor-set date for the next follow-up (defaults to +3 days on create).
		nextFollowUpAt: timestamp('next_follow_up_at'),
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
	attachments: many(attachment)
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
