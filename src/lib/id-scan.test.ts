import { describe, expect, it } from 'vitest';
import {
	composeAddress,
	normalizePostalCode,
	parseAamva,
	parseAamvaDate,
	scanReviewFacts,
	scanToSubcontractorFields,
	titleCase,
	visionIdSchema,
	visionPayloadToScan,
	type VisionIdPayload
} from './id-scan';

/**
 * The whole point of decoding the barcode rather than the picture: what a card
 * turns into is a pure function of its payload, so it can be pinned down here
 * exactly — no camera, no network, no real driver's licence, and no flake.
 *
 * The fixtures are real AAMVA payload shapes, control characters and all. The
 * compliance indicator (`@`), record separator (0x1e) and segment terminator
 * (0x0d) are written literally so the parser is fed what a scanner actually
 * hands it.
 */

/** A well-formed Virginia licence, AAMVA version 02. */
const US_LICENCE = [
	'@\n\r',
	'ANSI 636000100002DL00410279ZV03190008DLDAQT64235789\n',
	'DCSSAMPLE\n',
	'DDEN\n',
	'DACMICHAEL\n',
	'DDFN\n',
	'DADJOHN\n',
	'DDGN\n',
	'DCUJR\n',
	'DCAD\n',
	'DCBK\n',
	'DCDPH\n',
	'DBD06062019\n',
	'DBB06061986\n',
	'DBA12102025\n',
	'DBC1\n',
	'DAU068 in\n',
	'DAYBRO\n',
	'DAG2300 WEST BROAD STREET\n',
	'DAIRICHMOND\n',
	'DAJVA\n',
	'DAK232690000\n',
	'DCF2424244747474786102204\n',
	'DCGUSA\n',
	'DDAF\n',
	'\r',
	'ZVZVA01\n'
].join('');

/** An Ontario licence: CCYYMMDD dates and a Canadian postal code. */
const CA_LICENCE = [
	'@\n\r',
	'ANSI 636012080102DL00410278ZO03190008DLDAQD12345678901234\n',
	'DCSTREMBLAY\n',
	'DACMARIE\n',
	'DADCLAIRE\n',
	'DBB19850214\n',
	'DBA20280214\n',
	'DAG55 QUEEN STREET WEST\n',
	'DAITORONTO\n',
	'DAJON\n',
	'DAKM5V3L9\n',
	'DCGCAN\n',
	'\r'
].join('');

describe('parseAamva — a well-formed US licence', () => {
	const scan = parseAamva(US_LICENCE);

	it('reads the name off the card', () => {
		expect(scan).not.toBeNull();
		expect(scan!.firstName).toBe('Michael');
		expect(scan!.middleName).toBe('John');
		expect(scan!.lastName).toBe('Sample');
		expect(scan!.suffix).toBe('Jr');
	});

	it('title-cases the shouted payload rather than passing the caps through', () => {
		// A directory that lists "MICHAEL SAMPLE" reads as broken, not as accurate.
		expect(scan!.street).toBe('2300 West Broad Street');
		expect(scan!.city).toBe('Richmond');
	});

	it('leaves the state code alone', () => {
		expect(scan!.state).toBe('VA');
	});

	it('reads the document number from the header line', () => {
		// The first element shares a line with the header — there is no newline
		// between them, only a declared offset — so this is the case a
		// line-oriented parser silently drops.
		expect(scan!.idNumber).toBe('T64235789');
	});

	it('reads US dates as MMDDCCYY', () => {
		expect(scan!.dateOfBirth).toBe('1986-06-06');
		expect(scan!.expiresAt).toBe('2025-12-10');
	});

	it('drops the four padding zeros off a five-digit ZIP', () => {
		expect(scan!.postalCode).toBe('23269');
	});

	it('composes the one address line the subcontractor record stores', () => {
		expect(scan!.address).toBe('2300 West Broad Street, Richmond, VA 23269');
	});

	it('reports where it came from and what it read', () => {
		expect(scan!.source).toBe('barcode');
		expect(scan!.documentType).toBe('government-id');
	});
});

describe('parseAamva — a Canadian licence', () => {
	const scan = parseAamva(CA_LICENCE);

	it('reads Canadian dates as CCYYMMDD', () => {
		// 19850214 read in the US order would be month 19 — the country field is
		// what keeps this from becoming a wrong date rather than no date.
		expect(scan!.dateOfBirth).toBe('1985-02-14');
		expect(scan!.expiresAt).toBe('2028-02-14');
	});

	it('spaces a Canadian postal code', () => {
		expect(scan!.postalCode).toBe('M5V 3L9');
	});

	it('still produces one address line', () => {
		expect(scan!.address).toBe('55 Queen Street West, Toronto, ON M5V 3L9');
	});
});

describe('parseAamva — payloads that disagree with their own header', () => {
	it('reads a card whose declared subfile offsets are wrong', () => {
		// Jurisdictions miscount, and any reader that normalizes \r\n shifts every
		// offset after the first. Following the offsets would fail here; scanning
		// for element codes does not.
		const mangled = US_LICENCE.replace('DL00410279ZV03190008', 'DL99990001ZV00000000');
		const scan = parseAamva(mangled);
		expect(scan!.lastName).toBe('Sample');
		expect(scan!.idNumber).toBe('T64235789');
	});

	it('reads a card whose lines are CRLF-terminated', () => {
		const crlf = US_LICENCE.replace(/\n/g, '\r\n');
		const scan = parseAamva(crlf);
		expect(scan!.firstName).toBe('Michael');
		expect(scan!.address).toBe('2300 West Broad Street, Richmond, VA 23269');
	});
});

describe('parseAamva — things that are not an ID', () => {
	it('refuses a QR code', () => {
		expect(parseAamva('https://example.com/menu')).toBeNull();
	});

	it('refuses empty input', () => {
		expect(parseAamva('')).toBeNull();
	});

	it('refuses a payload with the header but nothing identifying', () => {
		// A decode that half-worked should say "that is not an ID", not open a
		// confirm sheet with every row blank.
		expect(parseAamva('ANSI 636000100002DL00410279\nDBC1\nDAYBRO\n')).toBeNull();
	});

	it('refuses a payload carrying only a date', () => {
		expect(parseAamva('ANSI 636000100002DL00410279\nDBB06061986\n')).toBeNull();
	});

	it('does not treat placeholder values as data', () => {
		const withNone = US_LICENCE.replace('DAG2300 WEST BROAD STREET', 'DAGNONE').replace(
			'DAIRICHMOND',
			'DAIunavl'
		);
		const scan = parseAamva(withNone);
		expect(scan!.street).toBeNull();
		expect(scan!.city).toBeNull();
	});
});

describe('parseAamva — older payload shapes', () => {
	it('reads a single combined name field', () => {
		const legacy = 'ANSI 6360000100DL00390187DLDAQ1234567\nDAAPEREZ,ANA,LUZ\nDAJTX\n';
		const scan = parseAamva(legacy);
		expect(scan!.lastName).toBe('Perez');
		expect(scan!.firstName).toBe('Ana');
		expect(scan!.middleName).toBe('Luz');
	});

	it('splits DCT into a first and middle name', () => {
		const scan = parseAamva('ANSI 636000100002DL00410279\nDCSNGUYEN\nDCTAN THI\nDAQX1\n');
		expect(scan!.firstName).toBe('An');
		expect(scan!.middleName).toBe('Thi');
	});
});

describe('scanToSubcontractorFields', () => {
	it('prefills the name and the address', () => {
		const fields = scanToSubcontractorFields(parseAamva(US_LICENCE)!);
		expect(fields.name).toBe('Michael Sample Jr');
		expect(fields.address).toBe('2300 West Broad Street, Richmond, VA 23269');
	});

	it('never puts a driver licence number or its expiry in the trade licence fields', () => {
		// `licenseNumber` on a Subcontractor means their trade licence. Filling it
		// from a DL would file the wrong number under a word the contractor later
		// reads as a credential — and a driving expiry says nothing about whether
		// they may do the work.
		const fields = scanToSubcontractorFields(parseAamva(US_LICENCE)!);
		expect(fields.licenseNumber).toBeNull();
		expect(fields.licenseExpiresAt).toBeNull();
	});

	it('fills the trade licence number and its expiry from a trade licence', () => {
		const scan = visionPayloadToScan({
			...BLANK_VISION,
			documentType: 'trade-license',
			firstName: 'Jordan',
			lastName: 'Rivera',
			idNumber: 'EC-100420',
			expiresAt: '2027-04-30'
		})!;
		const fields = scanToSubcontractorFields(scan);
		expect(fields.licenseNumber).toBe('EC-100420');
		expect(fields.licenseExpiresAt).toBe('2027-04-30');
	});
});

describe('scanReviewFacts', () => {
	it('shows the fields it is about to throw away', () => {
		// So the contractor can tell the scan read this card and not the one behind
		// it in the wallet.
		const facts = scanReviewFacts(parseAamva(US_LICENCE)!);
		expect(facts).toContainEqual({ label: 'Document #', value: 'T64235789' });
		expect(facts).toContainEqual({ label: 'Date of birth', value: '1986-06-06' });
		expect(facts).toContainEqual({ label: 'Expires', value: '2025-12-10' });
	});

	it('does not repeat the trade licence fields it is keeping', () => {
		// The number and the expiry are saved for a trade licence, so they belong
		// in the form above, not in the list of things about to be discarded.
		const scan = visionPayloadToScan({
			...BLANK_VISION,
			documentType: 'trade-license',
			lastName: 'Rivera',
			idNumber: 'EC-100420',
			expiresAt: '2027-04-30'
		})!;
		const labels = scanReviewFacts(scan).map((f) => f.label);
		expect(labels).not.toContain('Document #');
		expect(labels).not.toContain('Expires');
	});
});

const BLANK_VISION: VisionIdPayload = {
	documentType: 'unknown',
	firstName: null,
	middleName: null,
	lastName: null,
	suffix: null,
	street: null,
	city: null,
	state: null,
	postalCode: null,
	idNumber: null,
	dateOfBirth: null,
	expiresAt: null,
	issuer: null
};

describe('visionPayloadToScan', () => {
	it('rejects a document the model could not identify', () => {
		expect(visionPayloadToScan({ ...BLANK_VISION, firstName: 'Jordan' })).toBeNull();
	});

	it('rejects an identified document with nothing on it', () => {
		expect(visionPayloadToScan({ ...BLANK_VISION, documentType: 'trade-license' })).toBeNull();
	});

	it('lands in the same shape the barcode path produces', () => {
		const scan = visionPayloadToScan({
			...BLANK_VISION,
			documentType: 'trade-license',
			firstName: 'Jordan',
			lastName: 'Rivera',
			street: '14 Foundry Row',
			city: 'Austin',
			state: 'tx',
			postalCode: '787010000',
			idNumber: 'ec-100420',
			expiresAt: '2027-04-30',
			issuer: 'Texas Department of Licensing'
		})!;
		expect(scan.source).toBe('vision');
		expect(scan.state).toBe('TX');
		expect(scan.postalCode).toBe('78701');
		expect(scan.idNumber).toBe('EC-100420');
		expect(scan.address).toBe('14 Foundry Row, Austin, TX 78701');
	});

	it('drops a date the model did not return as ISO', () => {
		const scan = visionPayloadToScan({
			...BLANK_VISION,
			documentType: 'government-id',
			lastName: 'Rivera',
			dateOfBirth: 'circa 1986'
		})!;
		expect(scan.dateOfBirth).toBeNull();
	});
});

describe('visionIdSchema', () => {
	it('accepts the documented shape', () => {
		expect(visionIdSchema.safeParse(BLANK_VISION).success).toBe(true);
	});

	it('rejects a response missing a field', () => {
		const partial: Record<string, unknown> = { ...BLANK_VISION };
		delete partial.issuer;
		expect(visionIdSchema.safeParse(partial).success).toBe(false);
	});

	it('rejects an invented document type', () => {
		expect(visionIdSchema.safeParse({ ...BLANK_VISION, documentType: 'passport' }).success).toBe(
			false
		);
	});
});

describe('parseAamvaDate', () => {
	it('falls back to the other field order when the declared one is impossible', () => {
		// Cards do get issued with the wrong country code; a date that cannot be
		// read one way is better read the other than returned wrong.
		expect(parseAamvaDate('19850214', 'USA')).toBe('1985-02-14');
	});

	it('refuses anything that is not eight digits', () => {
		expect(parseAamvaDate('0606198', 'USA')).toBeNull();
		expect(parseAamvaDate('', 'USA')).toBeNull();
		expect(parseAamvaDate(null, 'USA')).toBeNull();
	});

	it('refuses a date with no plausible reading', () => {
		expect(parseAamvaDate('99999999', 'USA')).toBeNull();
	});
});

describe('normalizePostalCode', () => {
	it('keeps a genuine ZIP+4', () => {
		expect(normalizePostalCode('232691234')).toBe('23269-1234');
	});

	it('drops padding zeros', () => {
		expect(normalizePostalCode('232690000')).toBe('23269');
	});

	it('returns null for nothing', () => {
		expect(normalizePostalCode(null)).toBeNull();
		expect(normalizePostalCode('   ')).toBeNull();
	});
});

describe('composeAddress', () => {
	it('omits the parts that are missing rather than leaving gaps', () => {
		expect(composeAddress({ street: '1 Main St', city: null, state: 'IL', postalCode: null })).toBe(
			'1 Main St, IL'
		);
	});

	it('is null when there is no address at all', () => {
		expect(composeAddress({ street: null, city: null, state: null, postalCode: null })).toBeNull();
	});
});

describe('titleCase', () => {
	it('capitalises after hyphens and apostrophes', () => {
		expect(titleCase("O'BRIEN-SMITH")).toBe("O'Brien-Smith");
	});

	it('capitalises each word', () => {
		expect(titleCase('2300 WEST BROAD STREET')).toBe('2300 West Broad Street');
	});
});
