import { z } from 'zod';

/**
 * ID Scan — reading a subcontractor's ID off the card instead of typing it.
 *
 * Everything in this file is pure. That is the point: the hard part of the
 * feature is turning a barcode payload into fields, and a pure string→object
 * function can be tested exhaustively against fixtures without a camera, a
 * network, or a real driver's licence. See
 * openspec/changes/subcontractor-id-scan/design.md, Decision 1.
 *
 * Two paths produce a `ScannedId`: the PDF417 barcode on the back of every US
 * and Canadian licence (parsed here, on-device), and a vision read of a card
 * that has no barcode (parsed on the server, validated by the schema here).
 */

/** Which path read the card. */
export type ScanSource = 'barcode' | 'vision';

/**
 * What kind of document was read. This decides which fields may be kept: only a
 * trade/contractor licence carries a licence number that belongs on a
 * Subcontractor — a driver's licence number is a different thing wearing the
 * same word (design.md, Decision 3).
 */
export type ScannedDocumentType = 'government-id' | 'trade-license' | 'unknown';

/** One document's worth of fields, held only until the contractor saves. */
export type ScannedId = {
	source: ScanSource;
	documentType: ScannedDocumentType;
	firstName: string | null;
	middleName: string | null;
	lastName: string | null;
	suffix: string | null;
	street: string | null;
	city: string | null;
	state: string | null;
	postalCode: string | null;
	/** The single line that goes in the Subcontractor's address field. */
	address: string | null;
	/** Document number: a DL number, or a trade licence number. */
	idNumber: string | null;
	/** ISO `yyyy-mm-dd`, or null when the card didn't carry one. */
	dateOfBirth: string | null;
	expiresAt: string | null;
	/** Issuing body, when a trade licence names one. Vision path only. */
	issuer: string | null;
};

// ---------------------------------------------------------------- AAMVA codes

/**
 * The AAMVA data elements worth reading. Deliberately a tight set: the parser
 * identifies elements by scanning each line for the first known code, so every
 * addition here is another chance to match mid-value. Truncation flags
 * (DDE/DDF/DDG) and the document discriminator (DCF) are left out — nothing
 * downstream asks for them.
 */
const ELEMENT_CODES = [
	'DAA', // full name (pre-2010 payloads)
	'DAB', // family name (legacy spelling of DCS)
	'DAC', // first name
	'DAD', // middle name
	'DAE', // name suffix (legacy spelling of DCU)
	'DAG', // street line 1
	'DAH', // street line 2
	'DAI', // city
	'DAJ', // state / province
	'DAK', // postal code
	'DAQ', // customer ID number
	'DBA', // expiry date
	'DBB', // date of birth
	'DCG', // country
	'DCS', // family name
	'DCT', // given names (one field, space-separated)
	'DCU' // name suffix
] as const;

const KNOWN_CODES = new Set<string>(ELEMENT_CODES);

/**
 * Values a jurisdiction writes to mean "we don't hold this". Treating them as
 * text would prefill the form with the word NONE.
 */
const ABSENT_VALUES = new Set(['', 'NONE', 'UNAVL', 'UNKNOWN', 'NOT APPLICABLE', 'N/A']);

// ------------------------------------------------------------------- helpers

/**
 * Title-case a shouted AAMVA value. Payloads are all caps; a CRM that shows
 * "MICHAEL O'BRIEN-SMITH" as the subcontractor's name looks broken, so each
 * run of letters is cased separately and hyphens and apostrophes keep the
 * segment after them capitalised.
 */
export function titleCase(value: string): string {
	return value
		.toLowerCase()
		.replace(/(^|[\s\-'’./])([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** Trim, drop placeholders, and return null rather than an empty string. */
function clean(value: string | null | undefined): string | null {
	const trimmed = (value ?? '').trim().replace(/\s+/g, ' ');
	if (ABSENT_VALUES.has(trimmed.toUpperCase())) return null;
	return trimmed || null;
}

/**
 * Normalize an AAMVA postal code. US ZIPs arrive right-padded to nine digits,
 * so `627040000` is a five-digit ZIP wearing four zeros, and `627041234` is a
 * genuine ZIP+4. Canadian codes arrive without their space.
 */
export function normalizePostalCode(raw: string | null): string | null {
	const value = clean(raw)?.replace(/\s+/g, '');
	if (!value) return null;
	if (/^\d{9}$/.test(value)) {
		const plus4 = value.slice(5);
		return plus4 === '0000' ? value.slice(0, 5) : `${value.slice(0, 5)}-${plus4}`;
	}
	if (/^[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d$/.test(value)) {
		return `${value.slice(0, 3).toUpperCase()} ${value.slice(3).toUpperCase()}`;
	}
	return value.toUpperCase();
}

/**
 * Read an 8-digit AAMVA date into ISO `yyyy-mm-dd`.
 *
 * The field order is jurisdictional: the US writes MMDDCCYY, Canada CCYYMMDD.
 * The declared country decides, and a US reading that produces an impossible
 * month falls back to the Canadian order rather than returning a wrong date —
 * cards do get issued with the wrong country code.
 */
export function parseAamvaDate(raw: string | null, country: string | null): string | null {
	const value = clean(raw)?.replace(/\D/g, '');
	if (!value || value.length !== 8) return null;

	const mmddccyy = (): string | null => iso(value.slice(4), value.slice(0, 2), value.slice(2, 4));
	const ccyymmdd = (): string | null => iso(value.slice(0, 4), value.slice(4, 6), value.slice(6));

	return country?.toUpperCase() === 'CAN' ? (ccyymmdd() ?? mmddccyy()) : (mmddccyy() ?? ccyymmdd());
}

function iso(year: string, month: string, day: string): string | null {
	const y = Number(year);
	const m = Number(month);
	const d = Number(day);
	if (y < 1900 || y > 2200) return null;
	if (m < 1 || m > 12) return null;
	if (d < 1 || d > 31) return null;
	return `${year}-${month}-${day}`;
}

// -------------------------------------------------------------- the parser

/**
 * Parse a decoded PDF417 payload into a `ScannedId`, or null if it isn't one.
 *
 * Elements are found by scanning each line for the first known 3-character code
 * rather than by following the header's declared subfile offsets. Real payloads
 * routinely disagree with their own header — jurisdictions miscount, and a
 * reader that normalizes `\r\n` shifts every offset after the first — so a
 * parser that trusts the offsets fails on cards a human reads fine
 * (design.md, Decision 7). The `ANSI ` magic is still required, so an arbitrary
 * QR code pointed at the scanner is refused rather than half-read.
 */
export function parseAamva(raw: string): ScannedId | null {
	const header = raw.indexOf('ANSI ');
	if (header === -1) return null;

	const fields = new Map<string, string>();
	for (const line of raw.slice(header).split(/[\r\n]+/)) {
		for (let i = 0; i + 3 <= line.length; i++) {
			const code = line.slice(i, i + 3);
			if (!KNOWN_CODES.has(code)) continue;
			// First writer wins: a value that happens to contain a code later in the
			// payload must not overwrite the element that legitimately claimed it.
			if (!fields.has(code)) fields.set(code, line.slice(i + 3));
			break;
		}
	}
	if (fields.size === 0) return null;

	const at = (code: string) => clean(fields.get(code));
	const country = at('DCG');

	let firstName = at('DAC') ?? null;
	let middleName = at('DAD') ?? null;
	let lastName = at('DCS') ?? at('DAB') ?? null;

	// DCT holds every given name in one field on some jurisdictions.
	const given = at('DCT');
	if (!firstName && given) {
		const [head, ...rest] = given.split(' ');
		firstName = head;
		middleName ??= rest.join(' ') || null;
	}

	// Pre-2010 payloads carry one DAA instead, separated by comma, @ or $.
	const combined = at('DAA');
	if (!firstName && !lastName && combined) {
		const parts = combined.split(/[,@$]/).map((p) => p.trim());
		const [a, b, c] = parts.length > 1 ? parts : combined.split(/\s+/);
		lastName = a || null;
		firstName = b || null;
		middleName ??= c || null;
	}

	const scan: ScannedId = {
		source: 'barcode',
		// A PDF417 on the back of a card is by definition a government ID; a trade
		// licence has no barcode to read, which is what the vision path is for.
		documentType: 'government-id',
		firstName: titleCaseOrNull(firstName),
		middleName: titleCaseOrNull(middleName),
		lastName: titleCaseOrNull(lastName),
		suffix: titleCaseOrNull(at('DAE') ?? at('DCU')),
		street: joinStreet(at('DAG'), at('DAH')),
		city: titleCaseOrNull(at('DAI')),
		state: at('DAJ')?.toUpperCase() ?? null,
		postalCode: normalizePostalCode(at('DAK')),
		address: null,
		idNumber: at('DAQ')?.toUpperCase() ?? null,
		dateOfBirth: parseAamvaDate(at('DBB'), country),
		expiresAt: parseAamvaDate(at('DBA'), country),
		issuer: null
	};
	scan.address = composeAddress(scan);

	// A payload with the header but not one usable field is a decode that went
	// wrong, not an ID — better to say "that isn't an ID" than to open a confirm
	// sheet with every row blank.
	if (!scan.firstName && !scan.lastName && !scan.idNumber) return null;
	return scan;
}

function titleCaseOrNull(value: string | null): string | null {
	return value ? titleCase(value) : null;
}

function joinStreet(line1: string | null, line2: string | null): string | null {
	const parts = [line1, line2].filter(Boolean).map((p) => titleCase(p!));
	return parts.length ? parts.join(' ') : null;
}

/**
 * Fold the address parts into the one line a Subcontractor stores, in the
 * `street, city, ST zip` shape that `splitAddress` in $lib/address can take
 * back apart — so a scanned address behaves like a typed one everywhere else.
 */
export function composeAddress(parts: {
	street: string | null;
	city: string | null;
	state: string | null;
	postalCode: string | null;
}): string | null {
	const tail = [parts.state, parts.postalCode].filter(Boolean).join(' ');
	const line = [parts.street, parts.city, tail].filter(Boolean).join(', ');
	return line || null;
}

// ------------------------------------------------- mapping onto the form

/** The subcontractor fields a scan is allowed to prefill. */
export type SubcontractorScanFields = {
	name: string | null;
	address: string | null;
	licenseNumber: string | null;
	/** ISO `yyyy-mm-dd`, ready for the form's date input. */
	licenseExpiresAt: string | null;
};

/**
 * What a scan may put in the form.
 *
 * Name and address always; the licence number and its expiry only from a trade
 * licence. `licenseNumber` on a Subcontractor means their *trade* licence —
 * putting a driver's licence number there would file the wrong number under a
 * word the contractor will later read as a credential, and a driving expiry
 * says nothing about whether they may do the work (design.md, Decision 3).
 */
export function scanToSubcontractorFields(scan: ScannedId): SubcontractorScanFields {
	const name =
		[scan.firstName, scan.lastName, scan.suffix].filter(Boolean).join(' ').trim() || null;
	const trade = scan.documentType === 'trade-license';
	return {
		name,
		address: scan.address,
		licenseNumber: trade ? scan.idNumber : null,
		licenseExpiresAt: trade ? scan.expiresAt : null
	};
}

/** A row on the confirm sheet: read off the card, shown, and then dropped. */
export type ScanReviewFact = { label: string; value: string };

/**
 * The fields shown for checking and never saved. They exist so the contractor
 * can confirm the scan read *this* card — a passenger's licence and the right
 * one look identical once they're a list of fields.
 */
export function scanReviewFacts(scan: ScannedId): ScanReviewFact[] {
	// A trade licence's number and expiry are kept, so they belong in the form
	// above rather than in the list of things about to be thrown away.
	const trade = scan.documentType === 'trade-license';
	const facts: ScanReviewFact[] = [];
	if (!trade && scan.idNumber) facts.push({ label: 'Document #', value: scan.idNumber });
	if (scan.dateOfBirth) facts.push({ label: 'Date of birth', value: scan.dateOfBirth });
	if (!trade && scan.expiresAt) facts.push({ label: 'Expires', value: scan.expiresAt });
	if (scan.issuer) facts.push({ label: 'Issued by', value: scan.issuer });
	return facts;
}

// ------------------------------------------------------- the vision contract

/**
 * What the vision path is allowed to return. The model's answer is validated
 * against this before it reaches the contractor, so a malformed or imaginative
 * response fails as "couldn't read that" rather than arriving in the form.
 */
export const visionIdSchema = z.object({
	documentType: z.enum(['government-id', 'trade-license', 'unknown']),
	firstName: z.string().nullable(),
	middleName: z.string().nullable(),
	lastName: z.string().nullable(),
	suffix: z.string().nullable(),
	street: z.string().nullable(),
	city: z.string().nullable(),
	state: z.string().nullable(),
	postalCode: z.string().nullable(),
	idNumber: z.string().nullable(),
	dateOfBirth: z.string().nullable(),
	expiresAt: z.string().nullable(),
	issuer: z.string().nullable()
});

export type VisionIdPayload = z.infer<typeof visionIdSchema>;

/**
 * The same shape as `visionIdSchema`, as JSON Schema, for the model's
 * structured-output constraint. Written out rather than derived so the contract
 * the provider is given is readable in one place — and `additionalProperties`
 * and `required` are both mandatory there.
 */
export const VISION_ID_JSON_SCHEMA = {
	type: 'object',
	properties: {
		documentType: {
			type: 'string',
			enum: ['government-id', 'trade-license', 'unknown'],
			description:
				'government-id for a driver licence, state ID or passport; trade-license for a contractor/trade licence card; unknown if the image is not an identity or licence document.'
		},
		firstName: { type: ['string', 'null'] },
		middleName: { type: ['string', 'null'] },
		lastName: { type: ['string', 'null'] },
		suffix: { type: ['string', 'null'], description: 'Jr, Sr, III — null if absent.' },
		street: { type: ['string', 'null'] },
		city: { type: ['string', 'null'] },
		state: { type: ['string', 'null'], description: 'Two-letter code where there is one.' },
		postalCode: { type: ['string', 'null'] },
		idNumber: {
			type: ['string', 'null'],
			description: 'The document or licence number exactly as printed.'
		},
		dateOfBirth: { type: ['string', 'null'], description: 'ISO yyyy-mm-dd.' },
		expiresAt: { type: ['string', 'null'], description: 'ISO yyyy-mm-dd.' },
		issuer: {
			type: ['string', 'null'],
			description: 'The issuing body named on a trade licence, if any.'
		}
	},
	required: [
		'documentType',
		'firstName',
		'middleName',
		'lastName',
		'suffix',
		'street',
		'city',
		'state',
		'postalCode',
		'idNumber',
		'dateOfBirth',
		'expiresAt',
		'issuer'
	],
	additionalProperties: false
} as const;

/**
 * Turn a validated vision payload into a `ScannedId`, applying the same
 * cleaning the barcode path applies so both sources land in the form looking
 * the same. Returns null when the model reported it wasn't an ID, or when it
 * found nothing worth showing.
 */
export function visionPayloadToScan(payload: VisionIdPayload): ScannedId | null {
	if (payload.documentType === 'unknown') return null;

	const scan: ScannedId = {
		source: 'vision',
		documentType: payload.documentType,
		firstName: clean(payload.firstName),
		middleName: clean(payload.middleName),
		lastName: clean(payload.lastName),
		suffix: clean(payload.suffix),
		street: clean(payload.street),
		city: clean(payload.city),
		state: clean(payload.state)?.toUpperCase() ?? null,
		postalCode: normalizePostalCode(payload.postalCode),
		address: null,
		idNumber: clean(payload.idNumber)?.toUpperCase() ?? null,
		dateOfBirth: isoOrNull(payload.dateOfBirth),
		expiresAt: isoOrNull(payload.expiresAt),
		issuer: clean(payload.issuer)
	};
	scan.address = composeAddress(scan);

	if (!scan.firstName && !scan.lastName && !scan.idNumber) return null;
	return scan;
}

/** Keep only a well-formed ISO date; anything else is noise the form can't use. */
function isoOrNull(value: string | null): string | null {
	const v = clean(value);
	return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
