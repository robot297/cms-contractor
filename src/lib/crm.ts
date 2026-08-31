import { z } from 'zod';
import { isStateCode } from './address.js';

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

export type UserRole = 'contractor' | 'customer' | 'subcontractor';

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

/** Contact fields for a customer. Name and email are required; the rest are optional. */
export type PreferredContact = 'email' | 'call' | 'text';

/** The ways a contractor can reach a customer, in display order. */
export const CONTACT_METHODS = ['email', 'call', 'text'] as const;

/** Normalize a stored/submitted value, mapping the legacy 'phone' to 'call'. */
export function normalizePreferredContact(value: string | null | undefined): PreferredContact {
	if (value === 'call' || value === 'phone') return 'call';
	if (value === 'text' || value === 'sms') return 'text';
	return 'email';
}

/** Human label for a contact method. */
export function preferredContactLabel(p: PreferredContact): string {
	return p === 'call' ? 'Call' : p === 'text' ? 'Text' : 'Email';
}

export type CustomerContact = {
	name: string;
	email: string;
	phone: string | null;
	/** Street line only — city/state/postalCode are their own fields. */
	address: string | null;
	city: string | null;
	state: string | null;
	postalCode: string | null;
	notes: string | null;
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
	city: z
		.string()
		.optional()
		.transform((v) => blankToNull(v)),
	// The form offers a picker, so anything else arrived by hand — reject it
	// rather than store a state nothing else will recognise.
	state: z
		.string()
		.optional()
		.transform((v) => blankToNull(v)?.toUpperCase() ?? null)
		.refine((v) => v === null || isStateCode(v), 'Choose a state'),
	postalCode: z
		.string()
		.optional()
		.transform((v) => blankToNull(v))
		.refine((v) => v === null || /^\d{5}(-\d{4})?$/.test(v), 'Enter a 5-digit ZIP'),
	notes: z
		.string()
		.optional()
		.transform((v) => blankToNull(v)),
	preferredContact: z
		.string()
		.optional()
		.transform((v): PreferredContact => normalizePreferredContact(v))
});

// Address capture + parsing lives in plain JS so the backfill script can share
// it (see src/lib/address.js). Re-exported here so the app has one import site.
export {
	US_STATES,
	isStateCode,
	splitAddress,
	customerLocation,
	formatLocation
} from './address.js';
/** @see src/lib/address.js */
export type { AddressParts } from './address.js';

/** Fields a contact error can be attributed to; anything else reports as `name`. */
const REPORTABLE_FIELDS = ['email', 'phone', 'state', 'postalCode'] as const;
export type CustomerContactField = 'name' | (typeof REPORTABLE_FIELDS)[number];

export type CustomerContactValidation =
	| { ok: true; value: CustomerContact }
	| { ok: false; field: CustomerContactField; message: string };

/** Validate a new/edited customer's fields via the shared Zod schema. */
export function validateCustomerContact(input: {
	name?: string;
	email?: string;
	phone?: string;
	address?: string;
	city?: string;
	state?: string;
	postalCode?: string;
	notes?: string;
	preferredContact?: string;
}): CustomerContactValidation {
	const result = customerContactSchema.safeParse(input);
	if (result.success) return { ok: true, value: result.data };
	const issue = result.error.issues[0];
	const field = issue.path[0];
	return {
		ok: false,
		field: (REPORTABLE_FIELDS as readonly unknown[]).includes(field)
			? (field as CustomerContactField)
			: 'name',
		message: issue.message
	};
}

// ------------------------------------------------------------ Subcontractors

/**
 * Access tier on a subcontractor record. `trusted` sees the full assigned order
 * (customer contact + timeline) and may write; `guest` sees work details only,
 * with customer PII redacted, read-only. New subs default to `guest` (least
 * privilege).
 */
export const SUBCONTRACTOR_TIERS = ['trusted', 'guest'] as const;
export type SubcontractorTier = (typeof SUBCONTRACTOR_TIERS)[number];

export function isSubcontractorTier(value: string): value is SubcontractorTier {
	return (SUBCONTRACTOR_TIERS as readonly string[]).includes(value);
}

/** Human label for a tier badge. */
export function tierLabel(tier: SubcontractorTier): string {
	return tier === 'trusted' ? 'Trusted Subcontractor' : 'Guest Contractor';
}

/**
 * Suggested trades for the profile's trade/specialty field. The field is
 * free-form (any string is accepted); this list only powers a datalist of
 * common options in the UI.
 */
export const TRADES = [
	'Electrical',
	'Plumbing',
	'Framing',
	'Concrete',
	'Roofing',
	'HVAC',
	'Drywall',
	'Painting',
	'Landscaping',
	'Excavation'
] as const;

/** A subcontractor is "linked" once a login (userId) has bound to it via an invite. */
export function isSubcontractorLinked(sub: { userId: string | null }): boolean {
	return sub.userId != null;
}

export type SubcontractorContact = {
	name: string;
	email: string;
	phone: string | null;
	address: string | null;
	company: string | null;
	trade: string | null;
	tier: SubcontractorTier;
	licenseNumber: string | null;
	licenseExpiresAt: Date | null;
	insuranceCarrier: string | null;
	insuranceExpiresAt: Date | null;
	notes: string | null;
};

/** The single source of truth for subcontractor-profile validation (client + server). */
export const subcontractorContactSchema = z.object({
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
	company: z
		.string()
		.optional()
		.transform((v) => blankToNull(v)),
	trade: z
		.string()
		.optional()
		.transform((v) => blankToNull(v)),
	tier: z
		.string()
		.optional()
		.transform((v): SubcontractorTier => (v === 'trusted' ? 'trusted' : 'guest')),
	licenseNumber: z
		.string()
		.optional()
		.transform((v) => blankToNull(v)),
	licenseExpiresAt: z
		.string()
		.optional()
		.transform((v) => parseDateInput(v)),
	insuranceCarrier: z
		.string()
		.optional()
		.transform((v) => blankToNull(v)),
	insuranceExpiresAt: z
		.string()
		.optional()
		.transform((v) => parseDateInput(v)),
	notes: z
		.string()
		.optional()
		.transform((v) => blankToNull(v))
});

export type SubcontractorContactValidation =
	| { ok: true; value: SubcontractorContact }
	| { ok: false; field: 'name' | 'email' | 'phone'; message: string };

/** Validate a new/edited subcontractor's profile via the shared Zod schema. */
export function validateSubcontractorContact(input: {
	name?: string;
	email?: string;
	phone?: string;
	address?: string;
	company?: string;
	trade?: string;
	tier?: string;
	licenseNumber?: string;
	licenseExpiresAt?: string;
	insuranceCarrier?: string;
	insuranceExpiresAt?: string;
	notes?: string;
}): SubcontractorContactValidation {
	const result = subcontractorContactSchema.safeParse(input);
	if (result.success) return { ok: true, value: result.data };
	const issue = result.error.issues[0];
	const field = issue.path[0];
	return {
		ok: false,
		field: field === 'email' || field === 'phone' ? field : 'name',
		message: issue.message
	};
}

/**
 * The customer identity/contact fields a Guest Contractor must never receive.
 * Redaction is done here so a guest order view can be assembled server-side with
 * PII stripped — it never reaches the client. Trusted subs bypass this entirely.
 */
export type RedactedCustomer = {
	name: null;
	email: null;
	phone: null;
	address: null;
};

/** Project any customer-ish record down to a PII-free stub for Guest views. */
export function redactCustomerForGuest(): RedactedCustomer {
	return { name: null, email: null, phone: null, address: null };
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
/**
 * New orders are followed up a week out unless the contractor says otherwise.
 * A week is the shortest interval that doesn't nag: a job that went quiet for
 * three days usually hasn't gone quiet at all, and a dashboard full of
 * not-yet-real follow-ups is one contractors learn to ignore.
 */
/**
 * The house cadence: how long after speaking to a customer the contractor should
 * be reminded to speak to them again.
 *
 * Two weeks rather than one. A week was chosen when the follow-up was purely
 * manual; now that sending a message pushes the date out by this amount, a
 * seven-day cadence means a contractor who answers a question on Monday is being
 * chased about the same job the following Monday, which teaches them to ignore
 * the list.
 */
export const DEFAULT_FOLLOWUP_DAYS = 14;

/**
 * What a contractor may set their default to. A short list rather than a free
 * number field: the choice is "how patient are you", not an exact day count.
 */
export const FOLLOWUP_DAY_CHOICES = [3, 7, 14, 30] as const;
export type FollowUpDays = (typeof FOLLOWUP_DAY_CHOICES)[number];

export function isFollowUpDays(value: number): value is FollowUpDays {
	return (FOLLOWUP_DAY_CHOICES as readonly number[]).includes(value);
}

/**
 * Where the contractor app's navigation lives on a phone or tablet.
 *
 * `top` is the original: links collapse behind the hamburger on the bar. `bottom`
 * is the customer portal's shape — a fixed tab bar at the foot of the screen,
 * which is a shorter reach one-handed on a job site. Only the narrow widths
 * differ; above the desktop breakpoint the bar's rail navigates either way, so
 * this is a preference rather than two different apps.
 */
export const NAV_PLACEMENTS = ['top', 'bottom'] as const;
export type NavPlacement = (typeof NAV_PLACEMENTS)[number];

/**
 * Where a contractor's phone navigation sits until they say otherwise.
 *
 * BOTTOM, matching the customer portal — which has always put its tabs at the
 * foot of the screen and never offered the other option. The two halves of one
 * product disagreeing about where navigation lives is a thing a contractor
 * notices every time they use the view switcher, and the reach is the argument
 * either way: a phone is held low and the thumb is nowhere near the top corner.
 *
 * Named rather than repeated so the column default, the layout's fallback and
 * the settings page's fallback cannot drift apart — they were three copies of
 * the string 'top'.
 */
export const DEFAULT_NAV_PLACEMENT: NavPlacement = 'bottom';

export function isNavPlacement(value: unknown): value is NavPlacement {
	return (NAV_PLACEMENTS as readonly unknown[]).includes(value);
}

/** How the interval reads in a sentence: "a week", not "7 days". */
export function followUpDaysLabel(days: number): string {
	if (days === 1) return 'a day';
	if (days === 7) return 'a week';
	if (days % 7 === 0) return `${days / 7} weeks`;
	return `${days} days`;
}

/**
 * The default next-follow-up date for a freshly created order. `days` is the
 * contractor's own setting; it falls back to the house default so callers that
 * genuinely have no contractor in hand (tests, fixtures) still get a date.
 */
export function defaultFollowUp(
	days: number = DEFAULT_FOLLOWUP_DAYS,
	from: Date = new Date()
): Date {
	return new Date(from.getTime() + days * DAY_MS);
}

export type SnoozePreset = '1d' | '3d' | '1w' | '1m';

/** Days each preset pushes the follow-up out by. A month is taken as 30 days. */
const SNOOZE_DAYS: Record<SnoozePreset, number> = { '1d': 1, '3d': 3, '1w': 7, '1m': 30 };

export function isSnoozePreset(value: string): value is SnoozePreset {
	return Object.hasOwn(SNOOZE_DAYS, value);
}

/** A follow-up is "due" when it is set and on or before now. */
export function isFollowUpDue(date: Date | null, now: Date = new Date()): boolean {
	return date != null && date.getTime() <= now.getTime();
}

/** Compute a snoozed follow-up date from a preset. */
export function snoozeDate(preset: SnoozePreset, from: Date = new Date()): Date {
	return new Date(from.getTime() + SNOOZE_DAYS[preset] * DAY_MS);
}

/**
 * `<input type="date">` ↔ Date, as a LOCAL calendar day.
 *
 * `new Date('2026-08-14')` is UTC midnight, which is the evening of the 13th
 * everywhere west of Greenwich. Feeding a date picker's value straight into it
 * therefore stores the day BEFORE the one the contractor clicked, for every user
 * in the Americas — so a follow-up set for today was born a day overdue.
 *
 * It went unnoticed while the dashboard only said "Needs update". It stopped
 * being invisible the moment that badge started counting days.
 *
 * `toISOString().slice(0, 10)` is the same mistake in reverse and is why these
 * come as a pair: only used together do they round-trip the day the user meant.
 *
 * Every date the app takes from a picker comes through here — follow-ups and a
 * subcontractor's licence and insurance expiry — because they all had their own
 * copy of the same one-line mistake.
 */
export function parseDateInput(value?: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? '').trim());
	if (!match) return null;
	const [, y, m, d] = match.map(Number) as unknown as [string, number, number, number];
	const date = new Date(y, m - 1, d);
	// Rejects the impossible (2026-02-31 rolls into March) rather than silently
	// accepting whatever the constructor decided it meant.
	if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
	return date;
}

/** The inverse: a Date as the `yyyy-mm-dd` its own local calendar day. */
export function toDateInput(date: Date | string | null): string {
	if (date == null) return '';
	const at = typeof date === 'string' ? new Date(date) : date;
	if (Number.isNaN(at.getTime())) return '';
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * How badly a follow-up wants attention.
 *
 * Separate from `isFollowUpDue`, which decides whether an order appears at all.
 * This decides how it should *look* once it does, and the difference is the
 * point: a job you meant to chase last Tuesday and one you planned to call about
 * this morning are not the same situation, and a dashboard that renders them
 * identically makes the contractor re-derive that from a date every time.
 *
 * Compared by calendar day rather than by elapsed hours. "Due today" has to mean
 * the day on the wall, so a follow-up set for this morning still reads as
 * today's work at 4pm rather than as nine hours overdue.
 */
export type FollowUpUrgency = 'overdue' | 'today' | 'upcoming' | 'none';

/** Midnight at the start of `date`'s local calendar day. */
function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function followUpUrgency(
	date: Date | string | null,
	now: Date = new Date()
): FollowUpUrgency {
	if (date == null) return 'none';
	const at = typeof date === 'string' ? new Date(date) : date;
	if (Number.isNaN(at.getTime())) return 'none';
	const diffDays = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
	if (diffDays < 0) return 'overdue';
	if (diffDays === 0) return 'today';
	return 'upcoming';
}

/** Whole calendar days a follow-up is past due; 0 when it is not overdue. */
export function followUpDaysOverdue(date: Date | string | null, now: Date = new Date()): number {
	if (date == null) return 0;
	const at = typeof date === 'string' ? new Date(date) : date;
	if (Number.isNaN(at.getTime())) return 0;
	return Math.max(0, Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS));
}

/**
 * What the badge on a due order says. Counts the days rather than saying only
 * "overdue": three days late and three weeks late are different conversations,
 * and the number is the whole reason to sort the list the way it is sorted.
 */
export function followUpLabel(date: Date | string | null, now: Date = new Date()): string {
	const urgency = followUpUrgency(date, now);
	if (urgency === 'today') return 'Due today';
	if (urgency === 'overdue') {
		const days = followUpDaysOverdue(date, now);
		return days === 1 ? '1 day overdue' : `${days} days overdue`;
	}
	if (urgency === 'upcoming') return `Due in ${followUpDaysLabel(daysUntil(date, now))}`;
	return 'No follow-up set';
}

/** Whole calendar days from now until `date`; 0 when it is today or past. */
function daysUntil(date: Date | string | null, now: Date): number {
	if (date == null) return 0;
	const at = typeof date === 'string' ? new Date(date) : date;
	if (Number.isNaN(at.getTime())) return 0;
	return Math.max(0, Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS));
}

// ---------------------------------------------------------------- Documents

/** Cap on a single Document. Blobs live in Postgres, so keep it modest. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

/** File types any role may put on an Order. */
export const ALLOWED_DOCUMENT_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'application/pdf'
] as const;

export function isAllowedDocumentType(mime: string): boolean {
	return (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(mime);
}

/** The minimum a surface needs to hand a Document to the shared viewer. */
export type DocumentRef = { id: string; filename: string; mimeType: string };

/**
 * Where a Document's bytes are served from — one path for every role and every
 * surface. Built here rather than at each call site so no list has to know the
 * shape of it, and so `?dl` is spelled the same way everywhere.
 */
export function documentHref(id: string, download = false): string {
	return `/documents/${id}${download ? '?dl' : ''}`;
}

/** How the shared viewer should try to render a document. */
export function documentKind(mimeType: string): 'image' | 'pdf' | 'other' {
	if (mimeType.startsWith('image/')) return 'image';
	if (mimeType === 'application/pdf') return 'pdf';
	return 'other';
}

/** A short type badge for a document tile — "PDF", "JPG", or the extension. */
export function documentExtLabel(filename: string, mimeType: string): string {
	const { ext } = splitFilename(filename);
	if (ext) return ext.slice(1).toUpperCase().slice(0, 4);
	return mimeType === 'application/pdf' ? 'PDF' : 'FILE';
}

/**
 * What the bytes actually are, regardless of what the upload claimed.
 *
 * The MIME type on an upload is supplied by the browser and is trivially
 * spoofed — a shell script renamed `receipt.pdf` and posted with
 * `Content-Type: application/pdf` passes an allowlist check on its own. So the
 * content is read too, and the two have to agree.
 *
 * Returns a recognized type, one of the deliberately-named dangerous families,
 * or null when the signature matches nothing we know.
 */
export function sniffFileType(bytes: Uint8Array): string | null {
	const at = (offset: number, sig: number[]) => sig.every((byte, i) => bytes[offset + i] === byte);

	// --- Accepted ---
	if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
	// RIFF....WEBP
	if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
	if (at(0, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';

	// --- Named so the refusal can say what it actually found ---
	// PK.. — every zip, and therefore also .docx/.xlsx/.pptx, which are zip
	// containers. Accepting Office formats would contradict "no compressed
	// content"; that is a decision to take deliberately, not by accident.
	if (at(0, [0x50, 0x4b, 0x03, 0x04]) || at(0, [0x50, 0x4b, 0x05, 0x06])) return 'archive';
	if (at(0, [0x1f, 0x8b])) return 'archive'; // gzip
	if (at(0, [0x37, 0x7a, 0xbc, 0xaf])) return 'archive'; // 7z
	if (at(0, [0x52, 0x61, 0x72, 0x21])) return 'archive'; // rar
	if (at(0, [0x7f, 0x45, 0x4c, 0x46])) return 'executable'; // ELF
	if (at(0, [0x4d, 0x5a])) return 'executable'; // DOS/PE
	if (at(0, [0xcf, 0xfa, 0xed, 0xfe]) || at(0, [0xfe, 0xed, 0xfa, 0xcf])) return 'executable'; // Mach-O
	if (at(0, [0x23, 0x21])) return 'script'; // #!

	return null;
}

/** Why an upload was refused, phrased for the person who chose the file. */
export type UploadRefusal =
	| 'unsupported type'
	| 'compressed archives are not accepted'
	| 'programs are not accepted'
	| 'scripts are not accepted'
	| 'file content does not match its type';

/**
 * Decide whether bytes may be stored, from the claimed type AND the content.
 *
 * Both must pass: the claimed type must be on the allowlist, and the signature
 * must agree with it. Disagreement is refused even when the sniffed type is
 * itself allowed — a PNG posted as a PDF is either a broken client or someone
 * probing, and neither is worth storing.
 */
export function checkUploadContent(claimedMime: string, bytes: Uint8Array): UploadRefusal | null {
	const actual = sniffFileType(bytes);
	if (actual === 'archive') return 'compressed archives are not accepted';
	if (actual === 'executable') return 'programs are not accepted';
	if (actual === 'script') return 'scripts are not accepted';
	if (!isAllowedDocumentType(claimedMime)) return 'unsupported type';
	if (actual === null) return 'file content does not match its type';
	if (actual !== claimedMime) return 'file content does not match its type';
	return null;
}

/**
 * Split a filename into the part worth editing and the extension.
 *
 * The extension is kept OUT of the editable field: a customer renaming
 * "IMG_4821.jpg" to "Kitchen before" should not have to remember to type ".jpg",
 * and a file that loses its extension stops opening.
 */
export function splitFilename(name: string): { stem: string; ext: string } {
	const dot = name.lastIndexOf('.');
	if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' };
	return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Rebuild a filename from a user-supplied stem and a trusted extension.
 *
 * The stem came from a text input, so it is stripped of path separators and
 * control characters and capped — this value ends up in a Content-Disposition
 * header and on disk. The extension is never taken from the input; it comes from
 * the uploaded file itself.
 */
export function safeFilename(stem: string, ext: string, fallback = 'document'): string {
	const cleaned = stem
		// eslint-disable-next-line no-control-regex -- stripping control chars is the point
		.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '')
		// A leading dot would hide the file, or read as an extension.
		.replace(/^\.+/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80);
	return (cleaned || fallback) + ext;
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

/**
 * Which stage of the customer's four-step rail an Order sits in.
 *
 * This is the COARSE reading, and it is coarse on purpose: a rail with ten dots
 * is unreadable on a phone. What the customer is actually waiting on is said in
 * words by `customerStateLabel` beside it, so nothing is hidden by the grouping —
 * the rail answers "how far along", the label answers "what now".
 *
 * NOTE the switch is exhaustive and has NO `default`. That is load-bearing: a
 * `default` clause here previously swallowed `Final Payment Pending`, which had
 * never been added, and reported it to the customer as `Pending` — sending the
 * rail backwards from In Progress to the first step on a job whose work was
 * finished. Without a default, adding an eleventh contractor state is a type
 * error rather than a silent wrong answer.
 */
export function getVisibleCustomerState(state: ContractorOrderState): CustomerVisibleState {
	switch (state) {
		case 'Inquiry':
		case 'Quote Sent':
		case 'Deposit Pending':
		case 'Parts Ordered':
			return 'Pending';
		case 'Work Scheduled':
			return 'Scheduled';
		// `Final Payment Pending` sits here rather than in Completed: the work is
		// done but the job is not closed until it has been paid for.
		case 'In Progress':
		case 'Final Payment Pending':
			return 'In Progress';
		case 'Work Complete':
			return 'Completed';
		case 'Work Cancelled':
			return 'Cancelled';
		case 'On Hold / Archived':
			return 'On Hold';
	}
}

/**
 * What the customer is actually waiting on, in their own words.
 *
 * One label per contractor state, so the portal's headline tracks the workflow
 * one-for-one even though the rail beneath it groups. "Pending" covered four
 * genuinely different situations — two of which are waiting on the CUSTOMER, not
 * on the contractor — and a customer who owes a deposit should be told that
 * rather than shown a word that sounds like the contractor is busy.
 *
 * The contractor's own vocabulary is not reused verbatim: "Deposit Pending" is
 * bookkeeping, "Deposit due" is a thing to act on. Exhaustive for the same reason
 * as above.
 */
export function customerStateLabel(state: ContractorOrderState): string {
	switch (state) {
		case 'Inquiry':
			return 'Received';
		case 'Quote Sent':
			return 'Quote sent';
		case 'Deposit Pending':
			return 'Deposit due';
		case 'Parts Ordered':
			return 'Parts ordered';
		case 'Work Scheduled':
			return 'Scheduled';
		case 'In Progress':
			return 'In progress';
		case 'Final Payment Pending':
			return 'Final payment due';
		case 'Work Complete':
			return 'Completed';
		case 'Work Cancelled':
			return 'Cancelled';
		case 'On Hold / Archived':
			return 'On hold';
	}
}

/**
 * Whether this state is one the CUSTOMER has to act on. Drives the emphasis on
 * the portal's headline: "we're working on it" and "you owe us money" should not
 * look the same.
 */
export function isCustomerActionState(state: ContractorOrderState): boolean {
	return state === 'Deposit Pending' || state === 'Final Payment Pending';
}

// ------------------------------------------------------------ Support feedback

/** The kind of feedback a contractor can file from the support page. */
/**
 * The customer-facing states an Order passes through, in order. This is the
 * progress a Customer is shown — "where is my job" — rather than the
 * contractor's ten-state workflow.
 *
 * Cancelled and On Hold are deliberately absent: they are not points on the path,
 * they are departures from it, so `customerProgress` reports them separately
 * rather than pretending they sit between two steps.
 */
export const CUSTOMER_PROGRESS_STEPS = [
	'Pending',
	'Scheduled',
	'In Progress',
	'Completed'
] as const satisfies readonly CustomerVisibleState[];

export type CustomerProgress =
	| { onPath: true; steps: readonly string[]; currentIndex: number }
	| { onPath: false; label: CustomerVisibleState };

/** Where an Order sits on the customer-visible path, or why it is off it. */
export function customerProgress(state: CustomerVisibleState): CustomerProgress {
	const index = (CUSTOMER_PROGRESS_STEPS as readonly string[]).indexOf(state);
	if (index === -1) return { onPath: false, label: state };
	return { onPath: true, steps: CUSTOMER_PROGRESS_STEPS, currentIndex: index };
}

/**
 * A glyph per timeline entry kind, so a list of updates reads as a shape before
 * it reads as text. Falls back to a neutral dot for a kind added later.
 */
export function timelineKindIcon(kind: string): string {
	switch (kind) {
		case 'milestone':
			return '◆';
		case 'issue':
			return '!';
		case 'invoice':
			return '$';
		case 'message':
			return '✉';
		default:
			return '●';
	}
}

// ------------------------------------------------------------ Order messages

/**
 * What a customer's message is about, chosen by which quick action they tapped.
 *
 * The point is the contractor's inbox: "payment" and "question" want different
 * response times, and a wall of untyped messages makes that invisible. `general`
 * is the fallback for a message typed straight into the composer, and the only
 * topic a contractor's own reply ever carries.
 *
 * Note `payment` does NOT move money. This product tracks payment as an order
 * status and never processes it (see CONTEXT.md, "Payments") — the topic asks the
 * contractor to arrange it, exactly as a phone call would.
 */
export const MESSAGE_TOPICS = ['general', 'question', 'payment', 'schedule', 'issue'] as const;
export type MessageTopic = (typeof MESSAGE_TOPICS)[number];

export function isMessageTopic(value: string): value is MessageTopic {
	return (MESSAGE_TOPICS as readonly string[]).includes(value);
}

/** Falls back to `general` rather than throwing — an unknown topic is not an error. */
export function normalizeMessageTopic(value: string | null | undefined): MessageTopic {
	return value && isMessageTopic(value) ? value : 'general';
}

export function messageTopicLabel(topic: MessageTopic): string {
	switch (topic) {
		case 'question':
			return 'Question';
		case 'payment':
			return 'Payment';
		case 'schedule':
			return 'Scheduling';
		case 'issue':
			return 'Problem';
		default:
			return 'Message';
	}
}

/**
 * The quick actions the portal used to offer, each opening the composer with its
 * topic set.
 *
 * NOT CURRENTLY RENDERED. The portal's composer is now a plain box: four buttons
 * above it asked the customer to categorise a message before writing it, which is
 * work for them and not much use to the contractor. Kept, with its tests, because
 * Messages sent while they existed still carry a Topic and still display it — and
 * because the labels are the record of what those Topics meant. See CONTEXT.md
 * under Topic before wiring any of this back up.
 */
export const CUSTOMER_QUICK_ACTIONS = [
	{
		topic: 'question' as const,
		label: 'Ask a question',
		placeholder: 'What would you like to know about your project?'
	},
	{
		topic: 'payment' as const,
		label: 'Make a payment',
		// Deliberately explicit: the app never takes a payment, so the button must
		// not imply a checkout that does not exist.
		placeholder: 'Ask about paying — your contractor will send you the details.',
		note: 'Payments are handled directly by your contractor, not through this app.'
	},
	{
		topic: 'schedule' as const,
		label: 'Scheduling',
		placeholder: 'Need to change a date, or want to know when work happens next?'
	},
	{
		topic: 'issue' as const,
		label: 'Report a problem',
		placeholder: 'What went wrong? Include where and when if you can.'
	}
] satisfies readonly {
	topic: MessageTopic;
	label: string;
	placeholder: string;
	note?: string;
}[];

export const FEEDBACK_TYPES = ['bug', 'feature'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export function isFeedbackType(value: string): value is FeedbackType {
	return (FEEDBACK_TYPES as readonly string[]).includes(value);
}

/** Human label for a feedback type. */
export function feedbackTypeLabel(type: FeedbackType): string {
	return type === 'bug' ? 'Bug report' : 'Feature request';
}

/**
 * Which pane a piece of feedback was filed from. Carried through to the issue so
 * a report can be read without guessing whose experience broke — "the order page
 * is blank" means something different from a contractor than from a customer.
 */
export const FEEDBACK_SURFACES = ['contractor', 'customer'] as const;
export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number];

export function feedbackSurfaceLabel(surface: FeedbackSurface): string {
	return surface === 'customer' ? 'Customer portal' : 'Contractor app';
}

export type Feedback = {
	type: FeedbackType;
	title: string;
	detail: string;
	/** Set by the route, never by the form — a browser cannot claim to be elsewhere. */
	surface: FeedbackSurface;
};

/** Shared validation for the support form (client pre-check + server). */
export const feedbackSchema = z.object({
	type: z
		.string()
		.optional()
		.transform((v): FeedbackType => (v === 'bug' ? 'bug' : 'feature'))
		.refine((v) => isFeedbackType(v), 'Choose a feedback type'),
	title: z
		.string()
		.trim()
		.min(1, 'A short summary is required')
		.max(140, 'Keep the summary under 140 characters'),
	detail: z.string().trim().min(1, 'Please describe your feedback')
});

export type FeedbackValidation =
	| { ok: true; value: Feedback }
	| { ok: false; field: 'type' | 'title' | 'detail'; message: string };

/**
 * `surface` is a required argument rather than a form field: it says where the
 * report came from, and a value the browser supplies could say anything.
 */
export function validateFeedback(
	input: {
		type?: string;
		title?: string;
		detail?: string;
	},
	surface: FeedbackSurface
): FeedbackValidation {
	const result = feedbackSchema.safeParse(input);
	if (result.success) return { ok: true, value: { ...result.data, surface } };
	const issue = result.error.issues[0];
	const field = issue.path[0];
	return {
		ok: false,
		field: field === 'title' || field === 'detail' ? field : 'type',
		message: issue.message
	};
}

/**
 * Build the GitHub issue title + body for a piece of feedback. Pure (no network)
 * so it can be unit-tested; the server layer adds the labels + files it. The
 * submitter is recorded in the body so maintainers can follow up.
 */
export function buildFeedbackIssue(
	feedback: Feedback,
	submittedBy?: { name?: string | null; email?: string | null },
	screenshot?: { imageUrl: string; linkUrl: string } | null
): { title: string; body: string } {
	const prefix = feedback.type === 'bug' ? '[Bug]' : '[Feature]';
	// The surface leads the title: triage reads a list, and "is this a customer
	// hitting this or a contractor" is the first thing worth knowing about a report.
	const from = feedback.surface === 'customer' ? '[Customer]' : '[Contractor]';
	const who = submittedBy?.name || submittedBy?.email || 'someone';
	const contact = submittedBy?.email ? ` (${submittedBy.email})` : '';
	const body = [
		feedback.detail,
		// The inline embed renders on public repos; the blob link keeps working for
		// anyone with repo access even where the raw URL won't render (private repos).
		...(screenshot
			? ['', `![Screenshot](${screenshot.imageUrl})`, `*[View screenshot](${screenshot.linkUrl})*`]
			: []),
		'',
		'---',
		`*Filed from the in-app support form by ${who}${contact}.*`,
		`*Surface: ${feedbackSurfaceLabel(feedback.surface)}*`,
		`*Type: ${feedbackTypeLabel(feedback.type)}*`
	].join('\n');
	return { title: `${prefix}${from} ${feedback.title}`, body };
}

// -------------------------------------------------------------- Subscriptions

/**
 * A contractor's billing standing. Every contractor has exactly one subscription,
 * created at signup and never absent.
 *
 * - `trialing`  — inside the 14-day trial; trial limits apply.
 * - `active`    — paid and current; no limits.
 * - `past_due`  — payment failed but Stripe is still retrying. Deliberately still
 *                 writes: locking out a paying contractor over a temporarily
 *                 declined card is exactly the reputational damage ADR-0005 exists
 *                 to prevent. Stripe moves them to canceled when it gives up.
 * - `lapsed`    — trial ended or subscription ended. Read-only; nothing deleted.
 * - `comped`    — permanently free, no Stripe record, never expires. Held by
 *                 contractors who predate billing and by the demo contractor.
 */
export const SUBSCRIPTION_STATUSES = [
	'trialing',
	'active',
	'past_due',
	'lapsed',
	'comped'
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
	return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);

/** Length of the free trial a new contractor account starts with. */
export const TRIAL_DAYS = 14;

/**
 * The line between a comped and a trialing subscription: any contractor whose
 * login predates this instant was using the product before billing existed and is
 * comped permanently. Both the backfill migration and `ensureSubscription` read
 * this same constant, so the two can never disagree about who is grandfathered.
 *
 * Must be in the PAST for billing to do anything: a future date means every new
 * signup looks like it predates billing and is comped, switching the paywall off
 * entirely. That is the documented rollback — push this forward to comp everyone —
 * but it is not a safe default, so keep it pinned to when the backfill ran.
 */
export const BILLING_LAUNCHED_AT = new Date('2026-07-30T00:00:00.000Z');

/**
 * The record types a trial caps, and the caps themselves. Counted over *active*
 * records only — archiving a customer or deleting an order frees capacity — so
 * these are limits on how much work a contractor is juggling now, not on how much
 * they have ever done. A paid or comped subscription applies no limits at all.
 */
export const LIMITED_RECORDS = ['customer', 'order', 'subcontractor'] as const;
export type LimitedRecord = (typeof LIMITED_RECORDS)[number];

export const TRIAL_LIMITS: Record<LimitedRecord, number> = {
	customer: 25,
	order: 25,
	subcontractor: 3
};

/** Human label for a capped record type, singular and plural. */
export function limitedRecordLabel(kind: LimitedRecord, plural = false): string {
	const base = kind === 'subcontractor' ? 'subcontractor' : kind;
	const word = base.charAt(0).toUpperCase() + base.slice(1);
	return plural ? `${word}s` : word;
}

export type SubscriptionLike = {
	status: SubscriptionStatus;
	trialEndsAt: Date | null;
};

/** Why a contractor write was refused. `null` when the write is allowed. */
export type BlockedReason = 'trial-ended' | 'subscription-ended';

export type SubscriptionAccess = {
	/** Whether contractor-initiated writes are permitted at all. */
	canWrite: boolean;
	/** Set when `canWrite` is false. */
	reason: BlockedReason | null;
	/** True while inside a live trial — the only state where limits apply. */
	limitsApply: boolean;
	/** Whole days left in the trial, rounded up; null outside a live trial. */
	trialDaysRemaining: number | null;
};

/**
 * Decide what a subscription permits, right now. Pure, so the whole gate is
 * unit-testable without a database.
 *
 * Lapsing is *derived* rather than written by a scheduler: a `trialing` row whose
 * `trialEndsAt` has passed simply is lapsed. There is no job runner in this stack,
 * and deriving means the database can never report `trialing` while the truth is
 * otherwise.
 */
export function subscriptionAccess(
	sub: SubscriptionLike,
	now: Date = new Date()
): SubscriptionAccess {
	const allow = (limitsApply = false, trialDaysRemaining: number | null = null) => ({
		canWrite: true,
		reason: null,
		limitsApply,
		trialDaysRemaining
	});
	const block = (reason: BlockedReason): SubscriptionAccess => ({
		canWrite: false,
		reason,
		limitsApply: false,
		trialDaysRemaining: null
	});

	switch (sub.status) {
		case 'comped':
		case 'active':
			return allow();
		// Stripe is still retrying — keep them working (ADR-0005).
		case 'past_due':
			return allow();
		case 'trialing': {
			// A trial with no end date can't expire; treat it as live rather than
			// silently locking someone out on a null.
			if (sub.trialEndsAt == null) return allow(true, null);
			const remainingMs = sub.trialEndsAt.getTime() - now.getTime();
			if (remainingMs <= 0) return block('trial-ended');
			return allow(true, Math.ceil(remainingMs / DAY_MS));
		}
		case 'lapsed':
		default:
			return block('subscription-ended');
	}
}

export type LimitUsage = Record<LimitedRecord, number>;

export type LimitStatusEntry = {
	kind: LimitedRecord;
	used: number;
	limit: number;
	atLimit: boolean;
	remaining: number;
};

/**
 * Compare live usage against the caps. Limits gate *creation* only — a contractor
 * at or over a limit keeps every record they already hold fully editable.
 */
export function limitStatus(
	usage: LimitUsage,
	limits: Record<LimitedRecord, number> = TRIAL_LIMITS
): Record<LimitedRecord, LimitStatusEntry> {
	const entries = LIMITED_RECORDS.map((kind) => {
		const used = usage[kind] ?? 0;
		const limit = limits[kind];
		return [
			kind,
			{ kind, used, limit, atLimit: used >= limit, remaining: Math.max(0, limit - used) }
		] as const;
	});
	return Object.fromEntries(entries) as Record<LimitedRecord, LimitStatusEntry>;
}

/** The trial end for a contractor signing up at `from`. */
export function trialEndFrom(from: Date = new Date()): Date {
	return new Date(from.getTime() + TRIAL_DAYS * DAY_MS);
}

/**
 * Whether a login predating billing should be comped. Shared by the backfill
 * migration's intent and by `ensureSubscription` so they cannot classify the same
 * contractor differently.
 */
export function shouldBeComped(userCreatedAt: Date): boolean {
	return userCreatedAt.getTime() < BILLING_LAUNCHED_AT.getTime();
}

/**
 * Translate a payment provider's subscription status into ours.
 *
 * Pure and provider-agnostic (takes a plain string) so the mapping — the subtlest
 * rule in billing — is unit-tested without pulling in the Stripe SDK.
 *
 * `past_due` / `unpaid` map to a status that still WRITES. Stripe retries a failed
 * card for weeks, and locking out a paying contractor over a temporary decline is
 * the reputational damage ADR-0005 exists to prevent. Stripe moves them to
 * `canceled` when it finally gives up, and that is what lapses them.
 */
export function mapProviderStatus(status: string): SubscriptionStatus {
	switch (status) {
		case 'active':
		case 'trialing':
			return 'active';
		case 'canceled':
		case 'incomplete_expired':
			return 'lapsed';
		// `incomplete` (checkout not finished paying) and `paused` are treated as
		// past_due: recoverable, so keep them writing rather than locking out.
		case 'past_due':
		case 'unpaid':
		case 'incomplete':
		case 'paused':
		default:
			return 'past_due';
	}
}

/** Message shown when a contractor write is refused for billing reasons. */
export function blockedMessage(reason: BlockedReason): string {
	return reason === 'trial-ended'
		? 'Your free trial has ended. Choose a plan to start making changes again — everything you’ve added is safe and still here.'
		: 'Your subscription has ended. Restart it to start making changes again — everything you’ve added is safe and still here.';
}

/** Message shown when a creation is refused for hitting a trial limit. */
export function limitReachedMessage(entry: LimitStatusEntry): string {
	const plural = limitedRecordLabel(entry.kind, true).toLowerCase();
	const freeing =
		entry.kind === 'order'
			? 'Delete an order you no longer need'
			: `Archive ${entry.kind === 'customer' ? 'a customer' : 'a subcontractor'} you’re no longer working with`;
	return `Your trial covers ${entry.limit} ${plural} and you have ${entry.used}. ${freeing}, or subscribe for unlimited.`;
}

// ------------------------------------------------------------ Email templates

/**
 * The placeholders a contractor may use inside an email template's subject or
 * body. Shown in the admin editor and used to resolve values in the composer.
 */
export const EMAIL_TEMPLATE_PLACEHOLDERS = [
	{ token: 'customer', label: 'Customer name' },
	{ token: 'contractor', label: 'Your business name' },
	{ token: 'project', label: 'Project name' }
] as const;

export type TemplatePlaceholder = (typeof EMAIL_TEMPLATE_PLACEHOLDERS)[number]['token'];

/** Values substituted into a template's placeholders at selection/send time. */
export type TemplateVars = Partial<Record<TemplatePlaceholder, string | null | undefined>>;

const KNOWN_PLACEHOLDERS = new Set<string>(EMAIL_TEMPLATE_PLACEHOLDERS.map((p) => p.token));

/**
 * Practical `mailto:` body length before some mail clients start truncating.
 * Surfaced as guidance in the admin editor; not enforced.
 */
export const EMAIL_BODY_LENGTH_GUIDANCE = 1800;

/**
 * Substitute `{{customer}}`, `{{contractor}}`, `{{project}}` in `text` from `vars`.
 * Known placeholders with no value resolve to an empty string; unknown tokens
 * (e.g. `{{foo}}`) are left untouched so a contractor's typo stays visible rather
 * than silently vanishing. Whitespace inside the braces is tolerated.
 */
export function renderTemplate(text: string, vars: TemplateVars): string {
	return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, token: string) => {
		if (!KNOWN_PLACEHOLDERS.has(token)) return match;
		return (vars[token as TemplatePlaceholder] ?? '').toString();
	});
}

/**
 * Resolve a template's subject + body against `vars` and append the contractor's
 * signature block to the body (two blank-line separated). Pure so the composer can
 * build the `mailto:` and the admin page can render a live preview from the same
 * code path. The signature is itself placeholder-resolved so it can carry
 * `{{contractor}}`.
 */
export function composeEmail(
	template: { subject: string; body: string },
	vars: TemplateVars,
	signature?: string | null
): { subject: string; body: string } {
	const subject = renderTemplate(template.subject, vars);
	const body = renderTemplate(template.body, vars);
	const sig = renderTemplate((signature ?? '').trim(), vars).trim();
	return { subject, body: sig ? (body ? `${body}\n\n${sig}` : sig) : body };
}

/**
 * A default signature seeded for new contractors (and the demo). Carries the
 * business name via `{{contractor}}` so a rebrand is a one-field edit. Contractors
 * can rewrite it entirely from the admin page.
 */
export const DEFAULT_SIGNATURE = 'Thanks so much,\n{{contractor}}';

/**
 * Starter templates every new contractor begins with so the feature is useful
 * without setup. Kept short to stay well within `mailto:` body limits. Seeded once
 * (idempotent) and also inserted for the demo contractor.
 */
export const STARTER_EMAIL_TEMPLATES = [
	{
		name: 'Follow-up',
		subject: 'Following up on your {{project}} project',
		body: 'Hi {{customer}},\n\nJust checking in on your {{project}} project — happy to answer any questions or get things moving whenever you’re ready.\n\nLet me know how you’d like to proceed.'
	},
	{
		name: 'Quote ready',
		subject: 'Your {{project}} quote is ready',
		body: 'Hi {{customer}},\n\nThanks for the opportunity to quote your {{project}} project. Your quote is ready — take a look and let me know if you have any questions or would like to make any changes.\n\nI’d be glad to walk you through it.'
	},
	{
		name: 'Thank you',
		subject: 'Thank you!',
		body: 'Hi {{customer}},\n\nThank you for choosing us for your {{project}} project — it was a pleasure working with you. If anything comes up down the road, don’t hesitate to reach out.'
	}
] as const;

/**
 * Where a customer stands with the portal — the same four states the server's
 * `portalStanding` draws, computed on the client from the contractor's invite list
 * so a surface that already has that list needn't make another round trip.
 */
export type PortalInfo = {
	state: 'linked' | 'none' | 'pending' | 'expired';
	sentAt?: Date | string;
	expiresAt?: Date | string;
	inviteId?: string;
};

type InviteLike = {
	id: string;
	customerId: string | null;
	status: string;
	createdAt: Date | string;
	expiresAt: Date | string;
};

/**
 * Resolve a customer's {@link PortalInfo} from the invite list. `linked` short-
 * circuits to 'linked'; otherwise the newest pending invite for the customer decides
 * 'pending' vs 'expired' (a pending invite that has lapsed reads as expired, since
 * "invite sent" is not useful to read about a link that no longer opens). `invites`
 * is expected newest-first, matching `listInvites`.
 */
export function portalInfoFor(args: {
	linked: boolean;
	customerId: string | null;
	invites: InviteLike[];
	now?: number;
}): PortalInfo {
	if (args.linked) return { state: 'linked' };
	if (!args.customerId) return { state: 'none' };
	const now = args.now ?? Date.now();
	const pending = args.invites.find(
		(i) => i.customerId === args.customerId && i.status === 'pending'
	);
	if (!pending) return { state: 'none' };
	const base = { sentAt: pending.createdAt, expiresAt: pending.expiresAt, inviteId: pending.id };
	return new Date(pending.expiresAt).getTime() > now
		? { state: 'pending', ...base }
		: { state: 'expired', ...base };
}

/**
 * How a recorded final payment was taken. The app RECORDS money at close-out but
 * never processes it (ADR-0010), so this is bookkeeping, not a payment rail.
 */
export const PAYMENT_METHODS = ['cash', 'check', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function paymentMethodLabel(m: string | null | undefined): string {
	switch (m) {
		case 'cash':
			return 'Cash';
		case 'check':
			return 'Check';
		case 'card':
			return 'Card';
		case 'other':
			return 'Other';
		default:
			return '';
	}
}

/** Whole cents → "$1,234.56". Empty string for null/undefined. */
export function formatCents(cents: number | null | undefined): string {
	if (cents == null) return '';
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/**
 * Parse a typed dollar amount ("1,234.56", "$1234", "  3000 ") to whole cents.
 * Returns null for blank/invalid/negative — the caller decides whether that's an
 * error or simply "no amount given".
 */
export function parseDollarsToCents(input: string | null | undefined): number | null {
	if (!input) return null;
	const cleaned = input.replace(/[$,\s]/g, '');
	if (!cleaned) return null;
	const n = Number(cleaned);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.round(n * 100);
}
