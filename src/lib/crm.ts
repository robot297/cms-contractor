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
		.transform((v): PreferredContact => normalizePreferredContact(v))
});

/**
 * Extract a short "City" or "City, ST" location line from a free-form address.
 * Handles the common US shapes: "Street, City", "Street, City, ST" and
 * "Street, City, ST 12345". Returns null when no city can be isolated (e.g. a
 * lone street with no comma, or an empty address).
 */
export function formatLocation(address: string | null): string | null {
	if (!address) return null;
	const parts = address
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return null;
	// A trailing 2-letter state, optionally followed by a ZIP.
	const last = parts[parts.length - 1];
	const stateMatch = last.match(/^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
	if (stateMatch && parts.length >= 2) {
		return `${parts[parts.length - 2]}, ${stateMatch[1].toUpperCase()}`;
	}
	// No state present — the last non-street segment is the city.
	if (parts.length >= 2) return parts[parts.length - 1];
	return null;
}

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
	insuranceCarrier: string | null;
	insuranceExpiresAt: Date | null;
	notes: string | null;
	tags: string[];
};

/** Parse a YYYY-MM-DD date input into a Date, or null when blank/invalid. */
function parseDateInput(value?: string): Date | null {
	const t = (value ?? '').trim();
	if (t === '') return null;
	const d = new Date(t);
	return Number.isNaN(d.getTime()) ? null : d;
}

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
		.transform((v) => blankToNull(v)),
	tags: z
		.string()
		.optional()
		.transform((v) => parseTags(v ?? ''))
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
	insuranceCarrier?: string;
	insuranceExpiresAt?: string;
	notes?: string;
	tags?: string;
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

// ------------------------------------------------------------ Support feedback

/** The kind of feedback a contractor can file from the support page. */
export const FEEDBACK_TYPES = ['bug', 'feature'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export function isFeedbackType(value: string): value is FeedbackType {
	return (FEEDBACK_TYPES as readonly string[]).includes(value);
}

/** Human label for a feedback type. */
export function feedbackTypeLabel(type: FeedbackType): string {
	return type === 'bug' ? 'Bug report' : 'Feature request';
}

export type Feedback = {
	type: FeedbackType;
	title: string;
	detail: string;
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

export function validateFeedback(input: {
	type?: string;
	title?: string;
	detail?: string;
}): FeedbackValidation {
	const result = feedbackSchema.safeParse(input);
	if (result.success) return { ok: true, value: result.data };
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
	submittedBy?: { name?: string | null; email?: string | null }
): { title: string; body: string } {
	const prefix = feedback.type === 'bug' ? '[Bug]' : '[Feature]';
	const who = submittedBy?.name || submittedBy?.email || 'a contractor';
	const contact = submittedBy?.email ? ` (${submittedBy.email})` : '';
	const body = [
		feedback.detail,
		'',
		'---',
		`*Filed from the in-app support form by ${who}${contact}.*`,
		`*Type: ${feedbackTypeLabel(feedback.type)}*`
	].join('\n');
	return { title: `${prefix} ${feedback.title}`, body };
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
