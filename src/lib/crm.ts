import { z } from 'zod';

export const CONTRACTOR_ORDER_STATES = [
	'Inquiry',
	'Quote Sent',
	'Deposit Pending',
	'Parts Ordered',
	'Work Scheduled',
	'In Progress',
	'Final Payment Pending',
	'Work Complete',
	'Work Cancelled',
	'On Hold / Archived'
] as const;

export type ContractorOrderState = (typeof CONTRACTOR_ORDER_STATES)[number];

export function isContractorOrderState(value: string): value is ContractorOrderState {
	return (CONTRACTOR_ORDER_STATES as readonly string[]).includes(value);
}

/** States a contractor picks from in the quick-update surface (excludes archive). */
export const QUICK_UPDATE_STATES: ContractorOrderState[] = CONTRACTOR_ORDER_STATES.filter(
	(s) => s !== 'On Hold / Archived'
);

export type UserRole = 'contractor' | 'customer';

export type TimelineKind = 'status' | 'invoice' | 'message' | 'milestone' | 'issue';

// ------------------------------------------------------------------ Customers

/** Email is both the identity key and the invite channel, so it is normalized. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** A customer is "linked" once a login (userId) has bound to it via an invite. */
export function isCustomerLinked(customer: { userId: string | null }): boolean {
	return customer.userId != null;
}

/** Strip everything but digits — the canonical form we validate phone numbers against. */
export function digitsOnly(value: string): string {
	return value.replace(/\D/g, '');
}

/** Progressively format a US phone number for display as the user types. */
export function formatPhone(value: string): string {
	const d = digitsOnly(value).slice(0, 10);
	if (d.length === 0) return '';
	if (d.length < 4) return `(${d}`;
	if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
	return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Split a comma-separated tag string into a trimmed, de-duplicated list. */
export function parseTags(value: string): string[] {
	return Array.from(
		new Set(
			value
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean)
		)
	);
}

/** Contact fields for a customer. Name and email are required; the rest are optional. */
export type CustomerContact = {
	name: string;
	email: string;
	phone: string | null;
	address: string | null;
	notes: string | null;
	tags: string[];
};

const blankToNull = (v?: string) => {
	const t = (v ?? '').trim();
	return t === '' ? null : t;
};

/** The single source of truth for customer-contact validation (client + server). */
export const customerContactSchema = z.object({
	name: z.string().trim().min(1, 'Name is required'),
	email: z
		.string()
		.trim()
		.min(1, 'Email is required')
		.pipe(z.email('Enter a valid email'))
		.transform(normalizeEmail),
	phone: z
		.string()
		.optional()
		.transform((v) => {
			const d = digitsOnly(v ?? '');
			return d === '' ? null : formatPhone(d);
		})
		.refine((v) => v === null || digitsOnly(v).length === 10, 'Enter a 10-digit phone number'),
	address: z
		.string()
		.optional()
		.transform((v) => blankToNull(v)),
	notes: z
		.string()
		.optional()
		.transform((v) => blankToNull(v)),
	tags: z
		.string()
		.optional()
		.transform((v) => parseTags(v ?? ''))
});

export type CustomerContactValidation =
	| { ok: true; value: CustomerContact }
	| { ok: false; field: 'name' | 'email' | 'phone'; message: string };

/** Validate a new/edited customer's fields via the shared Zod schema. */
export function validateCustomerContact(input: {
	name?: string;
	email?: string;
	phone?: string;
	address?: string;
	notes?: string;
	tags?: string;
}): CustomerContactValidation {
	const result = customerContactSchema.safeParse(input);
	if (result.success) return { ok: true, value: result.data };
	const issue = result.error.issues[0];
	const field = issue.path[0];
	return {
		ok: false,
		field: field === 'email' || field === 'phone' ? field : 'name',
		message: issue.message
	};
}

/** A customer's active order is anything not terminal or archived. */
export function isActiveState(state: ContractorOrderState): boolean {
	return state !== 'Work Complete' && state !== 'Work Cancelled' && state !== 'On Hold / Archived';
}

export type CustomerVisibleState =
	'Pending' | 'Scheduled' | 'In Progress' | 'Completed' | 'Cancelled' | 'On Hold';

export function getVisibleCustomerState(state: ContractorOrderState): CustomerVisibleState {
	switch (state) {
		case 'Inquiry':
		case 'Quote Sent':
		case 'Deposit Pending':
		case 'Parts Ordered':
			return 'Pending';
		case 'Work Scheduled':
			return 'Scheduled';
		case 'In Progress':
			return 'In Progress';
		case 'Work Complete':
			return 'Completed';
		case 'Work Cancelled':
			return 'Cancelled';
		case 'On Hold / Archived':
			return 'On Hold';
		default:
			return 'Pending';
	}
}
