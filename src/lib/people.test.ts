import { describe, expect, it } from 'vitest';
import {
	isPersonKind,
	mergeDirectory,
	personSubtitle,
	searchPeople,
	type CrewRecord,
	type CustomerRecord,
	type Person,
	type SubRecord
} from './people';

function person(partial: Partial<Person> = {}): Person {
	return {
		id: crypto.randomUUID(),
		kind: 'crew',
		name: 'Dave Mackie',
		email: null,
		phone: null,
		company: null,
		role: null,
		avatar: null,
		archived: false,
		tier: null,
		linked: false,
		jobCount: 0,
		...partial
	};
}

describe('isPersonKind', () => {
	it('accepts the two kinds and nothing else', () => {
		// `kind` is routing now, not a label: it says which table an id belongs to
		// so an assignment reaches the right one. It arrives from a hidden form
		// field, so it is validated rather than trusted.
		expect(isPersonKind('crew')).toBe(true);
		expect(isPersonKind('sub')).toBe(true);
		expect(isPersonKind('subcontractor')).toBe(false);
		expect(isPersonKind('')).toBe(false);
		expect(isPersonKind(null)).toBe(false);
	});
});

describe('searchPeople', () => {
	const dave = person({ name: 'Dave Mackie', role: 'Framer', company: 'Acme Framing' });
	const acme = person({ kind: 'sub', name: 'Acme Framing', role: 'Framing' });
	const rosa = person({ name: 'Rosa Vega', role: 'Operator', phone: '(512) 555-0188' });
	const all = [dave, acme, rosa];

	it('finds by name, case-insensitively', () => {
		expect(searchPeople(all, 'rosa')).toEqual([rosa]);
	});

	it('finds by role', () => {
		expect(searchPeople(all, 'operator')).toEqual([rosa]);
	});

	it('finds both kinds through one company', () => {
		// The reason these are one list: "who do I have from Acme" spans a crew
		// hand employed there and the business itself engaged as a sub.
		const hits = searchPeople(all, 'acme');
		expect(hits).toHaveLength(2);
		expect(hits.map((p) => p.kind).sort()).toEqual(['crew', 'sub']);
	});

	it('finds by phone', () => {
		expect(searchPeople(all, '0188')).toEqual([rosa]);
	});

	it('returns everyone for a blank query', () => {
		expect(searchPeople(all, '   ')).toBe(all);
	});

	it('does not fall over on the null fields crew usually have', () => {
		expect(searchPeople([person({ name: 'Cher' })], 'zzz')).toEqual([]);
	});
});

describe('personSubtitle', () => {
	it('leads with the role and follows with the company', () => {
		expect(personSubtitle(person({ role: 'Framer', company: 'Acme' }))).toBe('Framer · Acme');
	});

	it('drops whichever half is missing', () => {
		expect(personSubtitle(person({ role: 'Framer' }))).toBe('Framer');
		expect(personSubtitle(person({ company: 'Acme' }))).toBe('Acme');
	});

	it('names the kind when there is nothing else to say', () => {
		// The one place the kind still surfaces as a word: a row with no role and
		// no company would otherwise read as an empty line, which looks like a
		// rendering fault rather than a record nobody has filled in.
		expect(personSubtitle(person({ kind: 'crew' }))).toBe('Crew');
		expect(personSubtitle(person({ kind: 'sub' }))).toBe('Subcontractor');
	});
});

describe('mergeDirectory', () => {
	const stamp = (iso: string) => new Date(iso);

	function customer(partial: Partial<CustomerRecord> = {}): CustomerRecord {
		return {
			id: 'cust-1',
			name: 'Dave Mackie',
			email: 'dave@example.com',
			phone: null,
			company: null,
			role: null,
			avatar: null,
			updatedAt: stamp('2026-01-01'),
			address: null,
			city: null,
			state: null,
			postalCode: null,
			notes: null,
			preferredContact: 'email',
			userId: null,
			createdAt: stamp('2026-01-01'),
			...partial
		};
	}
	function crew(partial: Partial<CrewRecord> = {}): CrewRecord {
		return {
			id: 'crew-1',
			name: 'Dave Mackie',
			email: 'dave@example.com',
			phone: null,
			company: null,
			role: null,
			avatar: null,
			updatedAt: stamp('2026-01-01'),
			notes: null,
			...partial
		};
	}
	function sub(partial: Partial<SubRecord> = {}): SubRecord {
		return {
			id: 'sub-1',
			name: 'Dave Mackie',
			email: 'dave@example.com',
			phone: null,
			company: null,
			role: null,
			avatar: null,
			updatedAt: stamp('2026-01-01'),
			tier: 'guest',
			licenseNumber: null,
			licenseExpiresAt: null,
			insuranceCarrier: null,
			insuranceExpiresAt: null,
			notes: null,
			userId: null,
			...partial
		};
	}

	it('is one person when the same address holds several records', () => {
		const people = mergeDirectory({ customers: [customer()], crew: [crew()], subs: [sub()] });
		expect(people).toHaveLength(1);
		expect(people[0].roles).toEqual(['customer', 'crew', 'sub']);
		expect(people[0].customer?.id).toBe('cust-1');
		expect(people[0].crew?.id).toBe('crew-1');
		expect(people[0].sub?.id).toBe('sub-1');
	});

	it('matches on the address regardless of case or padding', () => {
		const people = mergeDirectory({
			customers: [customer({ email: '  Dave@Example.COM ' })],
			crew: [crew()],
			subs: []
		});
		expect(people).toHaveLength(1);
	});

	it('keeps people with no address apart, however alike their names', () => {
		// Two Daves on the crew is a real thing and merging them would put one man's
		// jobs on another man's row. With nothing to match on, nothing is matched.
		const people = mergeDirectory({
			customers: [],
			crew: [crew({ id: 'a', email: null }), crew({ id: 'b', email: null })],
			subs: []
		});
		expect(people).toHaveLength(2);
	});

	it('lets the most recently edited record win a shared field', () => {
		const people = mergeDirectory({
			customers: [customer({ phone: '(555) 111-1111', updatedAt: stamp('2026-01-01') })],
			crew: [crew({ phone: '(555) 222-2222', updatedAt: stamp('2026-06-01') })],
			subs: []
		});
		expect(people[0].phone).toBe('(555) 222-2222');
	});

	it('fills a blank on the newest record from an older one', () => {
		// The customer record has no company column at all, so "newest wins" must not
		// mean "newest blanks".
		const people = mergeDirectory({
			customers: [customer({ company: null, updatedAt: stamp('2026-06-01') })],
			crew: [crew({ company: 'Acme Framing', updatedAt: stamp('2026-01-01') })],
			subs: []
		});
		expect(people[0].company).toBe('Acme Framing');
	});

	it('carries both kinds of work on one row', () => {
		const people = mergeDirectory({
			customers: [customer()],
			crew: [crew()],
			subs: [],
			jobCounts: { crew: new Map([['crew-1', 2]]), subs: new Map() },
			customerJobs: { 'cust-1': { active: 1, total: 4, latest: 'Back deck' } }
		});
		expect(people[0].jobCount).toBe(2);
		expect(people[0].jobs).toEqual({ active: 1, total: 4, latest: 'Back deck' });
	});

	it('orders by name', () => {
		const people = mergeDirectory({
			customers: [customer({ id: 'z', name: 'Zoe', email: 'z@example.com' })],
			crew: [crew({ id: 'a', name: 'Abe', email: 'a@example.com' })],
			subs: []
		});
		expect(people.map((p) => p.name)).toEqual(['Abe', 'Zoe']);
	});
});
