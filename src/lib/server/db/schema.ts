import { relations } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.schema';

export const order = pgTable(
	'order',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		contractorId: text('contractor_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		// Set once the invited customer signs up with a matching email.
		customerId: text('customer_id').references(() => user.id, { onDelete: 'set null' }),
		customerName: text('customer_name').notNull(),
		customerEmail: text('customer_email').notNull(),
		state: text('state').notNull().default('Inquiry'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [
		index('order_contractorId_idx').on(table.contractorId),
		index('order_customerId_idx').on(table.customerId),
		index('order_customerEmail_idx').on(table.customerEmail)
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
		kind: text('kind').notNull(), // status | invoice | message | milestone | issue
		title: text('title').notNull(),
		detail: text('detail').notNull().default(''),
		authorRole: text('author_role').notNull(), // contractor | customer
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
		orderId: text('order_id')
			.notNull()
			.references(() => order.id, { onDelete: 'cascade' }),
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
		index('invite_orderId_idx').on(table.orderId)
	]
);

export const orderRelations = relations(order, ({ one, many }) => ({
	contractor: one(user, { fields: [order.contractorId], references: [user.id] }),
	customer: one(user, { fields: [order.customerId], references: [user.id] }),
	timeline: many(timelineEntry),
	invites: many(customerInvite)
}));

export const timelineEntryRelations = relations(timelineEntry, ({ one }) => ({
	order: one(order, { fields: [timelineEntry.orderId], references: [order.id] })
}));

export const customerInviteRelations = relations(customerInvite, ({ one }) => ({
	order: one(order, { fields: [customerInvite.orderId], references: [order.id] })
}));

export * from './auth.schema';
