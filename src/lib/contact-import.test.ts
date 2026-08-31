import { describe, expect, it } from 'vitest';
import {
	contactIssue,
	dedupeContacts,
	fromPickedContact,
	parseVCards,
	type ImportedContact
} from './contact-import';

/** Build a card body without fighting with template-literal indentation. */
function card(...lines: string[]): string {
	return ['BEGIN:VCARD', 'VERSION:3.0', ...lines, 'END:VCARD'].join('\r\n');
}

const blank: ImportedContact = {
	name: '',
	email: '',
	phone: '',
	address: '',
	city: '',
	state: '',
	postalCode: ''
};

describe('parseVCards', () => {
	it('reads a plain card', () => {
		const [contact] = parseVCards(
			card(
				'FN:Jane Doe',
				'EMAIL;TYPE=HOME:Jane.Doe@Example.COM',
				'TEL;TYPE=CELL:(512) 555-0134',
				'ADR;TYPE=HOME:;;123 Main St;Austin;TX;78701;USA'
			)
		);
		expect(contact).toEqual({
			name: 'Jane Doe',
			email: 'jane.doe@example.com',
			phone: '(512) 555-0134',
			address: '123 Main St',
			city: 'Austin',
			state: 'TX',
			postalCode: '78701'
		});
	});

	it('reads several cards from one file', () => {
		const text = [
			card('FN:A One', 'EMAIL:a@example.com'),
			card('FN:B Two', 'EMAIL:b@example.com')
		].join('\r\n');
		expect(parseVCards(text).map((c) => c.name)).toEqual(['A One', 'B Two']);
	});

	it('unfolds continuation lines', () => {
		const [contact] = parseVCards(
			card(
				'FN:Jane Doe',
				'EMAIL:jane@exa',
				' mple.com',
				'ADR:;;123 Very Long',
				'\tStreet;Austin;TX;78701;'
			)
		);
		expect(contact.email).toBe('jane@example.com');
		expect(contact.address).toBe('123 Very LongStreet');
	});

	it('falls back to N when the card has no FN', () => {
		const [contact] = parseVCards(card('N:Doe;Jane;Q;Dr.;Jr.', 'EMAIL:jane@example.com'));
		expect(contact.name).toBe('Dr. Jane Q Doe Jr.');
	});

	it('unescapes commas, semicolons and backslashes', () => {
		const [contact] = parseVCards(card('FN:Doe\\, Jane\\; Esq.', 'EMAIL:jane@example.com'));
		expect(contact.name).toBe('Doe, Jane; Esq.');
	});

	it('decodes quoted-printable values', () => {
		const [contact] = parseVCards(
			[
				'BEGIN:VCARD',
				'VERSION:2.1',
				'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Garc=C3=ADa',
				'EMAIL:jose@example.com',
				'END:VCARD'
			].join('\r\n')
		);
		expect(contact.name).toBe('José García');
	});

	it('ignores the item group iOS prefixes properties with', () => {
		const [contact] = parseVCards(
			card('FN:Jane Doe', 'item1.EMAIL:jane@example.com', 'item1.X-ABLabel:_$!<Home>!$_')
		);
		expect(contact.email).toBe('jane@example.com');
	});

	it('takes the preferred entry when a card carries several', () => {
		const [contact] = parseVCards(
			card(
				'FN:Jane Doe',
				'EMAIL;TYPE=WORK:work@example.com',
				'EMAIL;TYPE=HOME,PREF:home@example.com',
				'TEL;TYPE=WORK:(512) 555-0100',
				'TEL;PREF=1:(512) 555-0134'
			)
		);
		expect(contact.email).toBe('home@example.com');
		expect(contact.phone).toBe('(512) 555-0134');
	});

	it('keeps the first entry when none is marked preferred', () => {
		const [contact] = parseVCards(
			card('FN:Jane Doe', 'EMAIL:first@example.com', 'EMAIL:second@example.com')
		);
		expect(contact.email).toBe('first@example.com');
	});

	it('folds the extended address into the street line', () => {
		const [contact] = parseVCards(
			card('FN:Jane Doe', 'EMAIL:jane@example.com', 'ADR:;Apt 4;123 Main St;Austin;TX;78701;USA')
		);
		expect(contact.address).toBe('123 Main St Apt 4');
	});

	it('drops a region that is not a US state code, keeping the rest', () => {
		const [contact] = parseVCards(
			card('FN:Jane Doe', 'EMAIL:jane@example.com', 'ADR:;;123 Main St;Austin;Texas;78701;USA')
		);
		expect(contact.state).toBe('');
		expect(contact.city).toBe('Austin');
	});

	it('drops a postal code that is not a US ZIP', () => {
		const [contact] = parseVCards(
			card('FN:Jane Doe', 'EMAIL:jane@example.com', 'ADR:;;1 High St;London;;SW1A 1AA;UK')
		);
		expect(contact.postalCode).toBe('');
	});

	it('strips a leading country code off a phone number', () => {
		const [contact] = parseVCards(
			card('FN:Jane Doe', 'EMAIL:jane@example.com', 'TEL:+1-512-555-0134')
		);
		expect(contact.phone).toBe('(512) 555-0134');
	});

	it('leaves a number it cannot read as a US phone off entirely', () => {
		const [contact] = parseVCards(
			card('FN:Jane Doe', 'EMAIL:jane@example.com', 'TEL:+44 20 7946 0958')
		);
		expect(contact.phone).toBe('');
	});

	it('keeps a contact that has no email — the review step asks for one', () => {
		const [contact] = parseVCards(card('FN:Jane Doe', 'TEL:(512) 555-0134'));
		expect(contact).toEqual({ ...blank, name: 'Jane Doe', phone: '(512) 555-0134' });
	});

	it('skips a card with neither a name nor an email', () => {
		expect(parseVCards(card('TEL:(512) 555-0134'))).toEqual([]);
	});

	it('skips a damaged card without losing the good ones around it', () => {
		const text = [
			card('FN:Good One', 'EMAIL:one@example.com'),
			'BEGIN:VCARD\r\nthis line has no colon\r\nEND:VCARD',
			card('FN:Good Two', 'EMAIL:two@example.com')
		].join('\r\n');
		expect(parseVCards(text).map((c) => c.name)).toEqual(['Good One', 'Good Two']);
	});

	it('accepts LF-only files and lower-case delimiters', () => {
		const text = 'begin:vcard\nFN:Jane Doe\nEMAIL:jane@example.com\nend:vcard\n';
		expect(parseVCards(text).map((c) => c.name)).toEqual(['Jane Doe']);
	});

	it('returns nothing for a file that is not a vCard at all', () => {
		expect(parseVCards('name,email\nJane,jane@example.com\n')).toEqual([]);
	});
});

describe('fromPickedContact', () => {
	it('normalises what the OS picker hands back', () => {
		expect(
			fromPickedContact({
				name: ['Jane Doe'],
				email: ['Jane@Example.com'],
				tel: ['+1 (512) 555-0134'],
				address: [
					{
						addressLine: ['123 Main St', 'Apt 4'],
						city: 'Austin',
						region: 'tx',
						postalCode: '78701'
					}
				]
			})
		).toEqual({
			name: 'Jane Doe',
			email: 'jane@example.com',
			phone: '(512) 555-0134',
			address: '123 Main St Apt 4',
			city: 'Austin',
			state: 'TX',
			postalCode: '78701'
		});
	});

	it('copes with a picker result that carries almost nothing', () => {
		expect(fromPickedContact({ name: ['Jane Doe'] })).toEqual({ ...blank, name: 'Jane Doe' });
	});

	it('skips an entry with neither a name nor an email', () => {
		expect(fromPickedContact({ tel: ['(512) 555-0134'] })).toBeNull();
	});
});

describe('contactIssue', () => {
	it('lets a crew import through without an email', () => {
		// The customer rule inverted. A crew member is not identified by their
		// address — a labourer may only ever be a name and a mobile number — so
		// refusing them until one is invented would be the app being wrong about
		// the world. A malformed address still fails: it was typed, so it was meant.
		const existing = new Set<string>();
		const opts = { emailRequired: false };
		expect(contactIssue({ ...blank, name: 'Dave' }, existing, opts)).toBeNull();
		expect(contactIssue({ ...blank, name: 'Dave', email: 'nope' }, existing, opts)).toBe(
			'bad-email'
		);
	});

	const existing = new Set(['taken@example.com']);

	it('passes a contact that can be imported', () => {
		expect(contactIssue({ ...blank, name: 'A', email: 'new@example.com' }, existing)).toBeNull();
	});

	it('flags a missing email', () => {
		expect(contactIssue({ ...blank, name: 'A' }, existing)).toBe('no-email');
	});

	it('flags an email that is not one', () => {
		expect(contactIssue({ ...blank, name: 'A', email: 'not-an-email' }, existing)).toBe(
			'bad-email'
		);
	});

	it('flags a customer already in the directory', () => {
		expect(contactIssue({ ...blank, name: 'A', email: 'TAKEN@example.com' }, existing)).toBe(
			'duplicate'
		);
	});
});

describe('dedupeContacts', () => {
	it('collapses repeats of the same email and fills blanks from the later copy', () => {
		const result = dedupeContacts([
			{ ...blank, name: 'Jane Doe', email: 'jane@example.com' },
			{
				...blank,
				name: 'Jane D',
				email: 'Jane@Example.com',
				phone: '(512) 555-0134',
				city: 'Austin'
			}
		]);
		expect(result).toEqual([
			{
				...blank,
				name: 'Jane Doe',
				email: 'jane@example.com',
				phone: '(512) 555-0134',
				city: 'Austin'
			}
		]);
	});

	it('keeps every contact that has no email to match on', () => {
		const result = dedupeContacts([
			{ ...blank, name: 'A One' },
			{ ...blank, name: 'B Two' }
		]);
		expect(result).toHaveLength(2);
	});
});
