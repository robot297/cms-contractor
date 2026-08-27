import { digitsOnly, formatPhone, isStateCode, normalizeEmail } from '$lib/crm';

/**
 * Contact import — turning a phone's address book into customers.
 *
 * Everything here is pure, for the same reason as $lib/id-scan: the hard part is
 * the parsing, and a string→object function can be tested against real exports
 * without a device, a permission prompt, or anyone's actual contacts.
 *
 * Two sources feed it, and both land on the same `ImportedContact`:
 *
 *   - The Contacts Picker API (`navigator.contacts`), where the operating system
 *     shows its own picker and hands back only the entries the contractor chose.
 *     Nothing is readable without that. Chromium on Android only, at time of
 *     writing — which is why there is a second path.
 *   - A vCard (`.vcf`) file, which is what every other platform exports to:
 *     iOS shares contacts as vCards, as do macOS Contacts, Google Contacts and
 *     Outlook. Parsed here, in the browser.
 *
 * Either way the contractor reviews a list and ticks what they want before
 * anything is saved. Nothing is imported implicitly.
 */

/** One contact as offered for review, before it is anybody's customer. */
export type ImportedContact = {
	name: string;
	email: string;
	/** Formatted for display, or '' — a contact with no number still imports. */
	phone: string;
	address: string;
	city: string;
	state: string;
	postalCode: string;
};

const EMPTY: ImportedContact = {
	name: '',
	email: '',
	phone: '',
	address: '',
	city: '',
	state: '',
	postalCode: ''
};

// ------------------------------------------------------------------- vCard

/**
 * A single parsed property line.
 *
 * `params` keys and values are upper-cased. vCard 2.1 allows bare parameter
 * values (`;HOME;PREF`), which are recorded as `TYPE`, since that is what every
 * later version spells them as.
 */
type Property = { name: string; params: Record<string, string[]>; value: string };

/**
 * Undo line folding. A line beginning with a space or tab is a continuation of
 * the one before it — exporters wrap at 75 octets, so a long address arrives
 * split across three lines and means nothing until they are rejoined.
 */
function unfold(text: string): string[] {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const out: string[] = [];
	for (const line of lines) {
		if (/^[ \t]/.test(line) && out.length > 0) out[out.length - 1] += line.slice(1);
		else out.push(line);
	}
	return out;
}

/**
 * `=E2=80=99` → `’`. vCard 2.1 exporters (Outlook, some Android builds) encode
 * any non-ASCII this way, and without decoding it a name comes through as
 * mojibake rather than as a name.
 */
function decodeQuotedPrintable(value: string): string {
	// Soft line breaks first: a trailing `=` means "this continues", not a byte.
	const joined = value.replace(/=\n/g, '');
	const bytes: number[] = [];
	for (let i = 0; i < joined.length; i++) {
		const hex = joined.slice(i + 1, i + 3);
		if (joined[i] === '=' && /^[0-9a-fA-F]{2}$/.test(hex)) {
			bytes.push(parseInt(hex, 16));
			i += 2;
		} else {
			bytes.push(joined.charCodeAt(i));
		}
	}
	try {
		return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
	} catch {
		return joined;
	}
}

/** Split on a delimiter, ignoring ones that are backslash-escaped. */
function splitUnescaped(value: string, delimiter: string): string[] {
	const parts: string[] = [];
	let current = '';
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === '\\' && i + 1 < value.length) {
			current += ch + value[i + 1];
			i++;
		} else if (ch === delimiter) {
			parts.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	parts.push(current);
	return parts;
}

/** `\,` `\;` `\\` `\n` back to the characters they stand for. */
function unescapeText(value: string): string {
	return value.replace(/\\([,;\\nN])/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

function parseProperty(line: string): Property | null {
	// The name/params half ends at the first colon that isn't inside quotes.
	let colon = -1;
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		if (line[i] === '"') quoted = !quoted;
		else if (line[i] === ':' && !quoted) {
			colon = i;
			break;
		}
	}
	if (colon === -1) return null;

	const segments = splitUnescaped(line.slice(0, colon), ';');
	// A property may be prefixed with a group (`item1.ADR`), which iOS uses
	// heavily to attach labels. The group carries no meaning we need.
	const name = (segments.shift() ?? '').split('.').pop()!.trim().toUpperCase();
	if (name === '') return null;

	const params: Record<string, string[]> = {};
	for (const segment of segments) {
		const eq = segment.indexOf('=');
		// `;HOME` (vCard 2.1) means the same as `;TYPE=HOME`.
		const key = eq === -1 ? 'TYPE' : segment.slice(0, eq).trim().toUpperCase();
		const raw = eq === -1 ? segment : segment.slice(eq + 1);
		for (const v of splitUnescaped(raw, ',')) {
			const cleaned = v.trim().replace(/^"|"$/g, '').toUpperCase();
			if (cleaned !== '') (params[key] ??= []).push(cleaned);
		}
	}

	let value = line.slice(colon + 1);
	if (params.ENCODING?.some((e) => e === 'QUOTED-PRINTABLE')) {
		value = decodeQuotedPrintable(value);
	}
	return { name, params, value };
}

/** Is this the entry the card marks as preferred? */
function isPreferred(prop: Property): boolean {
	return prop.params.PREF?.includes('1') === true || prop.params.TYPE?.includes('PREF') === true;
}

/**
 * The one property to use out of however many the card carries. A card commonly
 * lists three numbers; the preferred one wins, otherwise the first, which is the
 * order the exporting app chose to write them in.
 */
function pick(props: Property[]): Property | null {
	return props.find(isPreferred) ?? props[0] ?? null;
}

/** `N:Doe;Jane;;Dr.;` → `Jane Doe`. Used only when the card has no `FN`. */
function nameFromN(value: string): string {
	const [family = '', given = '', middle = '', prefix = '', suffix = ''] = splitUnescaped(
		value,
		';'
	).map((part) => unescapeText(part).trim());
	return [prefix, given, middle, family, suffix].filter(Boolean).join(' ');
}

/**
 * `ADR:;;123 Main St;Austin;TX;78701;USA` — seven components, of which four are
 * wanted. The extended-address component (index 1) is folded into the street
 * line, because "Apt 4" belongs with the street rather than nowhere.
 */
function addressFromAdr(
	value: string
): Pick<ImportedContact, 'address' | 'city' | 'state' | 'postalCode'> {
	const parts = splitUnescaped(value, ';').map((part) =>
		unescapeText(part).replace(/\n+/g, ' ').trim()
	);
	const [, extended = '', street = '', locality = '', region = '', postal = ''] = parts;
	const stateCode = region.toUpperCase();
	return {
		address: [street, extended].filter(Boolean).join(' ').trim(),
		city: locality,
		// A region that isn't a US state code is dropped rather than stored: the
		// schema rejects it, and a whole contact failing over "Texas" is worse
		// than importing that contact without a state.
		state: isStateCode(stateCode) ? stateCode : '',
		postalCode: /^\d{5}(-\d{4})?$/.test(postal) ? postal : ''
	};
}

function cardToContact(properties: Property[]): ImportedContact | null {
	const of = (name: string) => properties.filter((p) => p.name === name);

	const fn = pick(of('FN'));
	const n = pick(of('N'));
	const name = unescapeText(fn?.value ?? '').trim() || (n ? nameFromN(n.value) : '');

	const email = normalizeEmail(unescapeText(pick(of('EMAIL'))?.value ?? '').trim());
	const telDigits = digitsOnly(unescapeText(pick(of('TEL'))?.value ?? ''));
	// US 10-digit numbers only, with a leading country code tolerated. Anything
	// else is left off rather than mangled — the schema would reject it, and the
	// rest of the contact is still worth importing.
	const local =
		telDigits.length === 11 && telDigits.startsWith('1') ? telDigits.slice(1) : telDigits;
	const phone = local.length === 10 ? formatPhone(local) : '';

	const adr = pick(of('ADR'));

	// A card with neither a name nor an email is not a contact anyone can act on.
	if (name === '' && email === '') return null;
	return {
		...EMPTY,
		name,
		email,
		phone,
		...(adr ? addressFromAdr(adr.value) : {})
	};
}

/**
 * Parse the contents of one or more `.vcf` files. Unreadable cards are skipped
 * rather than thrown over: an export of two hundred contacts with one damaged
 * entry should import a hundred and ninety-nine.
 */
export function parseVCards(text: string): ImportedContact[] {
	const contacts: ImportedContact[] = [];
	let current: Property[] | null = null;
	for (const line of unfold(text)) {
		const trimmed = line.trim();
		if (/^BEGIN:VCARD$/i.test(trimmed)) {
			current = [];
			continue;
		}
		if (/^END:VCARD$/i.test(trimmed)) {
			if (current) {
				const contact = cardToContact(current);
				if (contact) contacts.push(contact);
			}
			current = null;
			continue;
		}
		if (!current || trimmed === '') continue;
		const prop = parseProperty(line);
		if (prop) current.push(prop);
	}
	return contacts;
}

// ----------------------------------------------------- Contacts Picker API

/**
 * What `navigator.contacts.select` resolves with. Declared here because the API
 * is not in TypeScript's DOM library — it ships in Chromium on Android only.
 * Every field is optional: the picker returns only what the contact has, and
 * only the properties that were asked for.
 */
export type PickedContactAddress = {
	addressLine?: string[];
	city?: string;
	region?: string;
	postalCode?: string;
};

export type PickedContact = {
	name?: string[];
	email?: string[];
	tel?: string[];
	address?: PickedContactAddress[];
};

export type ContactsManager = {
	select(properties: string[], options?: { multiple?: boolean }): Promise<PickedContact[]>;
	getProperties(): Promise<string[]>;
};

/** The picker, when this browser has one. */
export function contactsPicker(): ContactsManager | null {
	if (typeof navigator === 'undefined') return null;
	const contacts = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
	return contacts && typeof contacts.select === 'function' ? contacts : null;
}

/** Normalise one picked contact the same way a vCard entry is normalised. */
export function fromPickedContact(picked: PickedContact): ImportedContact | null {
	const name = (picked.name ?? []).map((n) => n.trim()).find(Boolean) ?? '';
	const email = normalizeEmail((picked.email ?? []).map((e) => e.trim()).find(Boolean) ?? '');
	const telDigits = digitsOnly((picked.tel ?? []).find(Boolean) ?? '');
	const local =
		telDigits.length === 11 && telDigits.startsWith('1') ? telDigits.slice(1) : telDigits;
	const addr = (picked.address ?? [])[0];
	const region = (addr?.region ?? '').trim().toUpperCase();
	const postal = (addr?.postalCode ?? '').trim();

	if (name === '' && email === '') return null;
	return {
		name,
		email,
		phone: local.length === 10 ? formatPhone(local) : '',
		address: (addr?.addressLine ?? [])
			.map((l) => l.trim())
			.filter(Boolean)
			.join(' '),
		city: (addr?.city ?? '').trim(),
		state: isStateCode(region) ? region : '',
		postalCode: /^\d{5}(-\d{4})?$/.test(postal) ? postal : ''
	};
}

// ------------------------------------------------------------- Review rules

/** Why a parsed contact can't be ticked as-is. */
export type ContactIssue = 'duplicate' | 'no-email' | 'bad-email' | null;

/**
 * What an import run did, as the server reports it back. Mirrors the summary
 * built in crm.server.ts — declared here so the dialog and the page can talk
 * about the result without importing a server module.
 */
export type ImportSummary = {
	imported: number;
	duplicates: number;
	rejected: { name: string; message: string }[];
	/** Set when a trial limit stopped the run partway; everything before it saved. */
	stoppedAt: string | null;
};

/** The detail line on the toast after an import. Empty when there is nothing to add. */
export function importSummaryLine(summary: ImportSummary): string {
	const parts: string[] = [];
	if (summary.duplicates > 0) parts.push(`${summary.duplicates} already added`);
	if (summary.rejected.length > 0) parts.push(`${summary.rejected.length} skipped`);
	if (summary.stoppedAt) parts.push(summary.stoppedAt);
	return parts.join(' · ');
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What the review list should say about one contact.
 *
 * An email is not optional here even though a phone book treats it as such: it
 * is the customer's identity in this app — how they are invited, how the portal
 * recognises them, and what a duplicate is judged on. So a contact without one
 * is offered with somewhere to type it rather than quietly dropped.
 */
export function contactIssue(
	contact: ImportedContact,
	existingEmails: Set<string>,
	/**
	 * Whether a missing address blocks the import.
	 *
	 * True for customers, who are IDENTIFIED by their email — it is the invite
	 * channel and the uniqueness key, so a customer without one cannot be created.
	 * False for crew, who are not: a labourer may only ever be a name and a mobile
	 * number, and refusing to record them until somebody invents an address for
	 * them would be the app being wrong about the world.
	 */
	options: { emailRequired?: boolean } = {}
): ContactIssue {
	const { emailRequired = true } = options;
	const email = normalizeEmail(contact.email);
	if (email === '') return emailRequired ? 'no-email' : null;
	// A malformed address is a problem either way — it was typed, so it was meant.
	if (!EMAIL_SHAPE.test(email)) return 'bad-email';
	if (existingEmails.has(email)) return 'duplicate';
	return null;
}

/** The flag shown beside a contact that can't be imported yet. */
export function issueLabel(issue: ContactIssue): string {
	if (issue === 'duplicate') return 'Already added';
	if (issue === 'no-email') return 'Needs email';
	if (issue === 'bad-email') return 'Check email';
	return '';
}

/**
 * Collapse contacts that are the same person. Phone exports routinely carry the
 * same address three times — once from the SIM, once from the account sync, once
 * from a merge that didn't take. Matched on email, since that is what the import
 * is keyed on anyway; entries without one are all kept, because there is nothing
 * to match them on. The first copy wins, but fills any blank field from a later
 * one, so a duplicate carrying only the address still contributes it.
 */
export function dedupeContacts(contacts: ImportedContact[]): ImportedContact[] {
	const byEmail = new Map<string, ImportedContact>();
	const out: ImportedContact[] = [];
	for (const contact of contacts) {
		const email = normalizeEmail(contact.email);
		if (email === '') {
			out.push(contact);
			continue;
		}
		const seen = byEmail.get(email);
		if (!seen) {
			const copy = { ...contact };
			byEmail.set(email, copy);
			out.push(copy);
			continue;
		}
		for (const key of Object.keys(EMPTY) as (keyof ImportedContact)[]) {
			if (seen[key] === '' && contact[key] !== '') seen[key] = contact[key];
		}
	}
	return out;
}
