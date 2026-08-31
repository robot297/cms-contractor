import { z } from 'zod';
import { formatPhone, normalizeEmail } from './crm.js';

/**
 * Crew — the people who turn up and do the work alongside the contractor.
 *
 * Kept apart from subcontractors on purpose. A subcontractor is a business you
 * engage: it carries an access tier, a licence and insurance on file, and an
 * invite that grants a portal login. A worker is a person on your crew, and the
 * point of this module is that none of that machinery follows them around. See
 * the note on the `worker` table in src/lib/server/db/schema.ts.
 *
 * Everything here is pure — validation, date arithmetic and formatting — so it
 * can be tested without a database, and so the same rules run on the server
 * (where they are enforced) and in the browser (where they are previewed).
 */

/** A calendar day, `YYYY-MM-DD`. Deliberately a string, never a Date. */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a real calendar day?
 *
 * The shape check alone accepts `2026-02-31`, which `new Date()` silently rolls
 * forward to 3 March — so a typo would be stored as a different day than the one
 * that was typed. Round-tripping catches it.
 */
export function isIsoDate(value: string): value is IsoDate {
	if (!ISO_DATE.test(value)) return false;
	const [y, m, d] = value.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Today where the reader is, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): IsoDate {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A stint on a job. Both ends optional: a crew member can be on a job with no
 * dates pinned yet, which is the normal state while it is still being planned.
 */
export type Stint = { startsOn: IsoDate | null; endsOn: IsoDate | null };

export type StintValidation =
	{ ok: true; value: Stint } | { ok: false; field: 'startsOn' | 'endsOn'; message: string };

/**
 * Check a stint typed into the form.
 *
 * An end before a start is the one error worth catching — it is easy to do with
 * two date pickers and produces a range that matches no days at all, so a crew
 * member would simply never appear on the schedule and nothing would say why.
 *
 * An end with no start is allowed and means "until this date". A start with no
 * end means "from this date, open-ended", which is how most crew are actually
 * booked.
 */
export function validateStint(input: {
	startsOn?: string | null;
	endsOn?: string | null;
}): StintValidation {
	const start = (input.startsOn ?? '').trim();
	const end = (input.endsOn ?? '').trim();

	if (start && !isIsoDate(start))
		return { ok: false, field: 'startsOn', message: 'Enter a valid start date' };
	if (end && !isIsoDate(end))
		return { ok: false, field: 'endsOn', message: 'Enter a valid end date' };
	// String comparison is correct for ISO dates: they sort lexically in date
	// order, which is the whole reason the format is written biggest-unit-first.
	if (start && end && end < start)
		return { ok: false, field: 'endsOn', message: 'The end date is before the start date' };

	return { ok: true, value: { startsOn: start || null, endsOn: end || null } };
}

/** Whether a stint covers a given day. An open end runs forever. */
export function coversDay(stint: Stint, day: IsoDate): boolean {
	if (stint.startsOn && day < stint.startsOn) return false;
	if (stint.endsOn && day > stint.endsOn) return false;
	// Both ends open: assigned to the job, no dates pinned. That is NOT "on site
	// every day forever" — it is "we haven't said" — so it does not count as
	// covering a specific day.
	if (!stint.startsOn && !stint.endsOn) return false;
	return true;
}

/** Whether two stints overlap, for warning about a double-booked crew member. */
export function stintsOverlap(a: Stint, b: Stint): boolean {
	// An undated assignment makes no claim on the calendar, so it can't clash.
	if (!a.startsOn && !a.endsOn) return false;
	if (!b.startsOn && !b.endsOn) return false;
	// Open ends are treated as infinite in that direction.
	if (a.endsOn && b.startsOn && a.endsOn < b.startsOn) return false;
	if (b.endsOn && a.startsOn && b.endsOn < a.startsOn) return false;
	return true;
}

/** How a stint reads on a card: "Mon 2 Mar – Fri 6 Mar", "From 2 Mar", "—". */
export function stintLabel(stint: Stint, now: Date = new Date()): string {
	const day = (iso: IsoDate) => {
		const [y, m, d] = iso.split('-').map(Number);
		const date = new Date(y, m - 1, d);
		// The year is only worth the space when it isn't the current one.
		const sameYear = date.getFullYear() === now.getFullYear();
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			...(sameYear ? {} : { year: 'numeric' })
		});
	};

	if (!stint.startsOn && !stint.endsOn) return 'No dates set';
	if (stint.startsOn && !stint.endsOn) return `From ${day(stint.startsOn)}`;
	if (!stint.startsOn && stint.endsOn) return `Until ${day(stint.endsOn)}`;
	if (stint.startsOn === stint.endsOn) return day(stint.startsOn!);
	return `${day(stint.startsOn!)} – ${day(stint.endsOn!)}`;
}

/** Whole days a stint spans, or null when either end is open. */
export function stintDays(stint: Stint): number | null {
	if (!stint.startsOn || !stint.endsOn) return null;
	const ms = Date.parse(`${stint.endsOn}T00:00:00`) - Date.parse(`${stint.startsOn}T00:00:00`);
	// Inclusive of both ends: a one-day stint is one day, not zero.
	return Math.round(ms / 86_400_000) + 1;
}

// ------------------------------------------------------------------ the person

/**
 * What a worker needs to exist.
 *
 * Name only. Email is optional here where it is required for a subcontractor,
 * because a subcontractor's address is how the portal invite reaches them and a
 * crew hand has no invite — demanding one would mean inventing addresses for
 * people who never gave one.
 */
export const workerSchema = z.object({
	name: z.string().trim().min(1, 'A name is required').max(120, 'That name is too long'),
	email: z
		.string()
		.trim()
		.max(200)
		.refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email')
		.transform((v) => (v === '' ? null : normalizeEmail(v)))
		.nullable()
		.optional(),
	phone: z
		.string()
		.trim()
		.max(40)
		.transform((v) => (v === '' ? null : formatPhone(v)))
		.nullable()
		.optional(),
	role: z
		.string()
		.trim()
		.max(60)
		.transform((v) => (v === '' ? null : v))
		.nullable()
		.optional(),
	/**
	 * Who they trade under, if anyone.
	 *
	 * Both kinds of person can have one, which is why they are one directory: a
	 * crew hand can be an Acme employee while Acme is separately engaged as a
	 * subcontractor. Company is a fact about a person, not a species of person.
	 */
	company: z
		.string()
		.trim()
		.max(120)
		.transform((v) => (v === '' ? null : v))
		.nullable()
		.optional(),
	notes: z
		.string()
		.trim()
		.max(2000)
		.transform((v) => (v === '' ? null : v))
		.nullable()
		.optional()
});

export type WorkerInput = z.infer<typeof workerSchema>;

/** First error message, or null. Mirrors the pattern the customer form uses. */
export function firstWorkerError(input: {
	name?: string;
	email?: string;
	phone?: string;
	role?: string;
	notes?: string;
}): string | null {
	const result = workerSchema.safeParse(input);
	return result.success ? null : (result.error.issues[0]?.message ?? 'Check the details');
}

/** "JB" from "Jo Bloggs". Two letters at most, matching the account avatar. */
export function workerInitials(name: string): string {
	return (
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
}
