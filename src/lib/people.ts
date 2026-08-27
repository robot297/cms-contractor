/**
 * People — everyone a contractor works a job with, of either kind.
 *
 * There is ONE list in the product, and it does not sort people into kinds. It
 * used to — an All / Crew / Subs filter, a group-by-company toggle, a chip on
 * every row — and all of that was answering a question nobody asks of a
 * directory. You come here to find a person; what you know about them is their
 * name or who they work for, and both are in the search.
 *
 * `PersonKind` survives as ROUTING, not as a label: two tables still hold these
 * records, and an assignment has to reach the right one. What it no longer does
 * is decide how anybody is presented. Whose company somebody is on is the fact
 * that separates a hand from a hired firm, and it is already on the row.
 */

import type { IsoDate } from './worker.js';

/** Which table a person came from. Never inferred — always carried. */
export type PersonKind = 'crew' | 'sub';

/**
 * Is this one of the two kinds?
 *
 * `kind` still exists, but only as routing: it says which table an id belongs
 * to, so an assignment reaches the right one. It is no longer a thing the
 * interface sorts people by — see the note at the top. Validated rather than
 * trusted, because it arrives from a hidden form field.
 */
export function isPersonKind(value: string | null | undefined): value is PersonKind {
	return value === 'crew' || value === 'sub';
}

/**
 * One person in the directory, of either kind.
 *
 * The sub-only fields are present-but-null for crew rather than absent, so the
 * list can be written once. A `tier` of null MEANS "this person has no tier and
 * cannot be given one" — it is not a subcontractor whose tier is unset.
 */
export type Person = {
	id: string;
	kind: PersonKind;
	name: string;
	email: string | null;
	phone: string | null;
	/**
	 * Who they trade under. Both kinds can have one, which is the whole reason
	 * these are one list: a crew hand can be an Acme employee while Acme is
	 * separately engaged as a subcontractor.
	 */
	company: string | null;
	/** Crew: their role on site. Sub: their trade. Same question, same column. */
	role: string | null;
	avatar: string | null;
	archived: boolean;
	/** Sub only. Null for crew, and null MEANS "cannot have one". */
	tier: string | null;
	/** Sub only: whether an invite has been accepted and a login bound. */
	linked: boolean;
	/** How many live jobs they are on. */
	jobCount: number;
};

/** A person on one job, with the stint they are on it for. */
export type Assignment = {
	id: string;
	kind: PersonKind;
	name: string;
	company: string | null;
	role: string | null;
	avatar: string | null;
	archived: boolean;
	startsOn: IsoDate | null;
	endsOn: IsoDate | null;
	/** What they are doing on THIS job, when it differs from their usual role. */
	jobRole: string | null;
	jobNotes: string | null;
};

/**
 * Free-text search across the fields somebody would actually type.
 *
 * Company is in here deliberately: "who do I have from Acme" is a real question
 * and the answer spans both kinds, which is the point of the merged list.
 */
export function searchPeople<
	T extends {
		name: string;
		company: string | null;
		role: string | null;
		email: string | null;
		phone: string | null;
	}
>(people: T[], query: string): T[] {
	const term = query.trim().toLowerCase();
	if (!term) return people;
	return people.filter((p) =>
		[p.name, p.company, p.role, p.email, p.phone]
			.filter((field): field is string => Boolean(field))
			.some((field) => field.toLowerCase().includes(term))
	);
}

/** The one-line summary under a person's name in the directory. */
export function personSubtitle(person: Person): string {
	const bits = [person.role, person.company].filter(Boolean);
	if (bits.length === 0) return person.kind === 'sub' ? 'Subcontractor' : 'Crew';
	return bits.join(' · ');
}

// ---------------------------------------------------------------- Directory
//
// One person, however many role records they hold.
//
// A contractor's address book is people, not record types. The same Dave can be
// the customer whose deck you rebuilt, the hand you call when you are short on
// Tuesdays, and — if he sets up on his own — the firm you engage. Three tables
// hold those three facts because they carry genuinely different capability: an
// Order points at a customer, an Assignment points at a crew/sub record, and
// only a subcontractor has a tier, insurance and a portal login. What was wrong
// was never the tables; it was that the SURFACE made you decide which kind of
// person somebody was before you could look them up.
//
// So the identity is woven here, in a read model, rather than in the schema:
// records are matched by email within one contractor, which is exactly the key
// the three tables already enforce uniqueness on. Somebody with no email — a
// crew hand who is a name and a mobile number — is their own person, because
// there is nothing to match them on and guessing by name would merge two
// different Daves.

/** Which record a person holds. A person may hold several. */
export type PersonRole = 'customer' | 'crew' | 'sub';

/** Display order, so a row's chips never reshuffle between renders. */
export const PERSON_ROLES: readonly PersonRole[] = ['customer', 'crew', 'sub'];

export function isPersonRole(value: string | null | undefined): value is PersonRole {
	return value === 'customer' || value === 'crew' || value === 'sub';
}

/** What a role is called on screen. */
export function roleLabel(role: PersonRole): string {
	if (role === 'customer') return 'Customer';
	if (role === 'crew') return 'Crew';
	return 'Subcontractor';
}

/** The fields every role record carries, as the merge sees them. */
type RoleRecord = {
	id: string;
	name: string;
	email: string | null;
	phone: string | null;
	company: string | null;
	/** Crew: role on site. Sub: trade. Customer: nothing — always null. */
	role: string | null;
	avatar: string | null;
	/** Which record won a field is decided by this, newest first. */
	updatedAt: Date;
};

export type CustomerRecord = RoleRecord & {
	address: string | null;
	city: string | null;
	state: string | null;
	postalCode: string | null;
	notes: string | null;
	preferredContact: string;
	/** Set once an invite is accepted and a login is bound. */
	userId: string | null;
	createdAt: Date;
};

export type CrewRecord = RoleRecord & { notes: string | null };

export type SubRecord = RoleRecord & {
	tier: string;
	licenseNumber: string | null;
	licenseExpiresAt: Date | null;
	insuranceCarrier: string | null;
	insuranceExpiresAt: Date | null;
	notes: string | null;
	userId: string | null;
};

/**
 * One row of the directory: a person, the roles they hold, and the id of each
 * record behind them so an action can reach the right table.
 */
export type DirectoryPerson = {
	/**
	 * Identity for this render — the normalized email, or `role:id` for somebody
	 * who has none. Used as the list key and as the form field that says who an
	 * action is about; every action ALSO takes the specific record id it needs,
	 * because the key is a display concern and record ids are what the tables use.
	 */
	key: string;
	name: string;
	email: string | null;
	phone: string | null;
	company: string | null;
	/** Their role on site / trade, from whichever record carries one. */
	role: string | null;
	avatar: string | null;
	/** Every role they hold, in `PERSON_ROLES` order. Never empty. */
	roles: PersonRole[];
	customer: CustomerRecord | null;
	crew: CrewRecord | null;
	sub: SubRecord | null;
	/** Live jobs they are ON, as crew or subcontractor. */
	jobCount: number;
	/** Jobs they are the CUSTOMER for. Null when they hold no customer record. */
	jobs: { active: number; total: number; latest: string | null } | null;
};

/** The email two records have to share to be the same person. */
function mergeKey(email: string | null): string | null {
	const normalized = (email ?? '').trim().toLowerCase();
	return normalized === '' ? null : normalized;
}

/**
 * Weave the three tables into one directory.
 *
 * Pure, so the rule about who counts as the same person can be tested without a
 * database — which matters, because that rule is the whole feature.
 *
 * Where two records disagree about a shared field (a phone typed into the crew
 * record after the customer record was made), the MOST RECENTLY UPDATED record
 * wins. Not a fixed table precedence: the last thing the contractor typed is the
 * thing they meant, and a precedence order would quietly discard it depending on
 * which record they happened to edit.
 */
export function mergeDirectory(input: {
	customers: CustomerRecord[];
	crew: CrewRecord[];
	subs: SubRecord[];
	/** Live job counts by record id, for crew and subs. */
	jobCounts?: { crew: Map<string, number>; subs: Map<string, number> };
	/** What each customer record has running, by customer id. */
	customerJobs?: Record<string, { active: number; total: number; latest: string | null }>;
}): DirectoryPerson[] {
	const byKey = new Map<string, DirectoryPerson>();

	function slot(record: RoleRecord, role: PersonRole): DirectoryPerson {
		const key = mergeKey(record.email) ?? `${role}:${record.id}`;
		const existing = byKey.get(key);
		if (existing) return existing;
		const fresh: DirectoryPerson = {
			key,
			name: record.name,
			email: record.email,
			phone: record.phone,
			company: record.company,
			role: record.role,
			avatar: record.avatar,
			roles: [],
			customer: null,
			crew: null,
			sub: null,
			jobCount: 0,
			jobs: null
		};
		byKey.set(key, fresh);
		return fresh;
	}

	/** Fill the shared display fields from whichever record is newest. */
	function claim(person: DirectoryPerson, record: RoleRecord, winner: boolean) {
		if (winner) {
			person.name = record.name;
			person.email = record.email ?? person.email;
			person.phone = record.phone ?? person.phone;
			person.company = record.company ?? person.company;
			person.role = record.role ?? person.role;
			person.avatar = record.avatar ?? person.avatar;
			return;
		}
		// An older record still fills anything the newer one left blank.
		person.email ??= record.email;
		person.phone ??= record.phone;
		person.company ??= record.company;
		person.role ??= record.role;
		person.avatar ??= record.avatar;
	}

	const newest = new Map<string, number>();
	function add(record: RoleRecord, role: PersonRole, attach: (p: DirectoryPerson) => void) {
		const person = slot(record, role);
		const stamp = record.updatedAt.getTime();
		const winner = stamp >= (newest.get(person.key) ?? -Infinity);
		if (winner) newest.set(person.key, stamp);
		claim(person, record, winner);
		if (!person.roles.includes(role)) person.roles.push(role);
		attach(person);
	}

	for (const c of input.customers) {
		add(c, 'customer', (p) => {
			p.customer = c;
			p.jobs = input.customerJobs?.[c.id] ?? { active: 0, total: 0, latest: null };
		});
	}
	for (const w of input.crew) {
		add(w, 'crew', (p) => {
			p.crew = w;
			p.jobCount += input.jobCounts?.crew.get(w.id) ?? 0;
		});
	}
	for (const s of input.subs) {
		add(s, 'sub', (p) => {
			p.sub = s;
			p.jobCount += input.jobCounts?.subs.get(s.id) ?? 0;
		});
	}

	for (const person of byKey.values()) {
		person.roles = PERSON_ROLES.filter((r) => person.roles.includes(r));
	}
	return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
