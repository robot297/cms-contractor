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
export type PreferredContact = 'email' | 'phone';

export type CustomerContact = {
	name: string;
	email: string;
	phone: string | null;
	address: string | null;
	notes: string | null;
	tags: string[];
	preferredContact: PreferredContact;
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
		.transform((v) => parseTags(v ?? '')),
	preferredContact: z
		.string()
		.optional()
		.transform((v): PreferredContact => (v === 'phone' ? 'phone' : 'email'))
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
	preferredContact?: string;
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

// -------------------------------------------------------------------- Orders

/** Shelter/structure options a contractor picks from when setting up an order. */
export const PROJECT_TYPES = [
	'Gazebo',
	'Pavilion',
	'Pergola',
	'Carport',
	'Pole Barn',
	'Shed',
	'Deck'
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

/**
 * A fixed palette of construction glyphs a contractor can pin to an order to
 * signal its build type or status at a glance. Capped at 10 options.
 */
export const ORDER_ICONS = ['🏗️', '🏠', '🛠️', '🔨', '🪚', '🧱', '🪵', '🚧', '📐', '✅'] as const;

export type OrderIcon = (typeof ORDER_ICONS)[number];

export function isOrderIcon(value: string): value is OrderIcon {
	return (ORDER_ICONS as readonly string[]).includes(value);
}

export function isProjectType(value: string): value is ProjectType {
	return (PROJECT_TYPES as readonly string[]).includes(value);
}

export type OrderSetup = { customerId: string; projectName: string; projectType: string };
export type OrderSetupValidation =
	| { ok: true; value: OrderSetup }
	| { ok: false; field: 'customer' | 'projectName' | 'projectType'; message: string };

/**
 * Validate the New Order form. `projectType` is a known value, or `'Other'`
 * with a non-empty `projectTypeOther` that becomes the stored type.
 */
export function validateOrderSetup(input: {
	customerId?: string;
	projectName?: string;
	projectType?: string;
	projectTypeOther?: string;
}): OrderSetupValidation {
	const customerId = (input.customerId ?? '').trim();
	if (!customerId) return { ok: false, field: 'customer', message: 'Pick a customer' };
	const projectName = (input.projectName ?? '').trim();
	if (!projectName) return { ok: false, field: 'projectName', message: 'Project name is required' };
	const rawType = (input.projectType ?? '').trim();
	let projectType: string;
	if (rawType === 'Other') {
		projectType = (input.projectTypeOther ?? '').trim();
		if (!projectType)
			return { ok: false, field: 'projectType', message: 'Describe the project type' };
	} else if (isProjectType(rawType)) {
		projectType = rawType;
	} else {
		return { ok: false, field: 'projectType', message: 'Choose a project type' };
	}
	return { ok: true, value: { customerId, projectName, projectType } };
}

// ---------------------------------------------------------------- Follow-ups

const DAY_MS = 24 * 60 * 60 * 1000;
/** New orders are followed up on 3 days out by default. */
export const DEFAULT_FOLLOWUP_DAYS = 3;

export type SnoozePreset = '1d' | '3d' | '1w';

export function isSnoozePreset(value: string): value is SnoozePreset {
	return value === '1d' || value === '3d' || value === '1w';
}

/** The default next-follow-up date for a freshly created order. */
export function defaultFollowUp(from: Date = new Date()): Date {
	return new Date(from.getTime() + DEFAULT_FOLLOWUP_DAYS * DAY_MS);
}

/** A follow-up is "due" when it is set and on or before now. */
export function isFollowUpDue(date: Date | null, now: Date = new Date()): boolean {
	return date != null && date.getTime() <= now.getTime();
}

/** Compute a snoozed follow-up date from a preset. */
export function snoozeDate(preset: SnoozePreset, from: Date = new Date()): Date {
	const days = preset === '1d' ? 1 : preset === '3d' ? 3 : 7;
	return new Date(from.getTime() + days * DAY_MS);
}

// -------------------------------------------------------------- Attachments

/** Cap on a single order attachment. Blobs live in Postgres, so keep it modest. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

/** File types a contractor may attach to an order. */
export const ALLOWED_ATTACHMENT_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'application/pdf'
] as const;

export function isAllowedAttachmentType(mime: string): boolean {
	return (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(mime);
}

/** Human-readable byte size, e.g. "2.4 MB". */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
	const mb = kb / 1024;
	return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

// ------------------------------------------------------------------ Avatars

/** Cap stored avatar data URLs so customer rows/queries stay small. */
export const MAX_AVATAR_BYTES = 200 * 1024;

/** True when the value is an image data URL within the size cap. */
export function isValidAvatarDataUrl(value: string): boolean {
	if (!/^data:image\/(png|jpe?g|webp);base64,/.test(value)) return false;
	const b64 = value.slice(value.indexOf(',') + 1);
	const bytes = Math.floor((b64.length * 3) / 4);
	return bytes > 0 && bytes <= MAX_AVATAR_BYTES;
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
