// Address parsing, in plain JS so BOTH the app and a raw `node` script can use
// it — the backfill in scripts/backfill-customer-address.mjs runs outside Vite
// and cannot import TypeScript. Same reasoning as scripts/demo-fixtures.js.
//
// Re-exported from $lib/crm, which is where the app should import it from.

/**
 * US states, for the picker on the customer form. Code plus name so the select
 * reads in full while storing the two letters everything else compares against.
 */
export const US_STATES = [
	{ code: 'AL', name: 'Alabama' },
	{ code: 'AK', name: 'Alaska' },
	{ code: 'AZ', name: 'Arizona' },
	{ code: 'AR', name: 'Arkansas' },
	{ code: 'CA', name: 'California' },
	{ code: 'CO', name: 'Colorado' },
	{ code: 'CT', name: 'Connecticut' },
	{ code: 'DE', name: 'Delaware' },
	{ code: 'DC', name: 'District of Columbia' },
	{ code: 'FL', name: 'Florida' },
	{ code: 'GA', name: 'Georgia' },
	{ code: 'HI', name: 'Hawaii' },
	{ code: 'ID', name: 'Idaho' },
	{ code: 'IL', name: 'Illinois' },
	{ code: 'IN', name: 'Indiana' },
	{ code: 'IA', name: 'Iowa' },
	{ code: 'KS', name: 'Kansas' },
	{ code: 'KY', name: 'Kentucky' },
	{ code: 'LA', name: 'Louisiana' },
	{ code: 'ME', name: 'Maine' },
	{ code: 'MD', name: 'Maryland' },
	{ code: 'MA', name: 'Massachusetts' },
	{ code: 'MI', name: 'Michigan' },
	{ code: 'MN', name: 'Minnesota' },
	{ code: 'MS', name: 'Mississippi' },
	{ code: 'MO', name: 'Missouri' },
	{ code: 'MT', name: 'Montana' },
	{ code: 'NE', name: 'Nebraska' },
	{ code: 'NV', name: 'Nevada' },
	{ code: 'NH', name: 'New Hampshire' },
	{ code: 'NJ', name: 'New Jersey' },
	{ code: 'NM', name: 'New Mexico' },
	{ code: 'NY', name: 'New York' },
	{ code: 'NC', name: 'North Carolina' },
	{ code: 'ND', name: 'North Dakota' },
	{ code: 'OH', name: 'Ohio' },
	{ code: 'OK', name: 'Oklahoma' },
	{ code: 'OR', name: 'Oregon' },
	{ code: 'PA', name: 'Pennsylvania' },
	{ code: 'RI', name: 'Rhode Island' },
	{ code: 'SC', name: 'South Carolina' },
	{ code: 'SD', name: 'South Dakota' },
	{ code: 'TN', name: 'Tennessee' },
	{ code: 'TX', name: 'Texas' },
	{ code: 'UT', name: 'Utah' },
	{ code: 'VT', name: 'Vermont' },
	{ code: 'VA', name: 'Virginia' },
	{ code: 'WA', name: 'Washington' },
	{ code: 'WV', name: 'West Virginia' },
	{ code: 'WI', name: 'Wisconsin' },
	{ code: 'WY', name: 'Wyoming' }
];

const US_STATE_CODES = new Set(US_STATES.map((s) => s.code));

/** Accepts a 2-letter code, case-insensitively. Anything else is not a state. */
/**
 * @param {string} value
 * @returns {boolean}
 */
export function isStateCode(value) {
	return US_STATE_CODES.has(value.trim().toUpperCase());
}

// Words that end a street, so the city scan below knows where to stop — and a
// string ending in one is a street, not a place. ("LA" is both Louisiana and an
// abbreviation for Lane; Louisiana wins, being far the commoner intent.)
const STREET_WORDS = new Set([
	'st',
	'street',
	'rd',
	'road',
	'ave',
	'avenue',
	'ln',
	'lane',
	'blvd',
	'boulevard',
	'ct',
	'court',
	'dr',
	'drive',
	'way',
	'pl',
	'place',
	'cir',
	'circle',
	'ter',
	'terrace',
	'hwy',
	'highway',
	'pkwy',
	'parkway',
	'trl',
	'trail',
	'sq',
	'square',
	'apt',
	'unit',
	'ste',
	'suite'
]);

/** @param {string} word */
const isStreetWord = (word) => STREET_WORDS.has(word.toLowerCase().replace(/\.$/, ''));

/**
 * The four fields a customer address is captured in.
 *
 * @typedef {{
 *   address: string | null,
 *   city: string | null,
 *   state: string | null,
 *   postalCode: string | null
 * }} AddressParts
 */

/** @type {AddressParts} */
const NO_ADDRESS = { address: null, city: null, state: null, postalCode: null };

/**
 * Pull a free-form address apart into street / city / state / ZIP.
 *
 * Only used on addresses that predate those being their own fields: the backfill
 * script runs this once over the existing rows, and `customerLocation` falls back
 * to it for anything the backfill couldn't split. New customers never come
 * through here — the form asks for the four pieces directly, which is the point.
 *
 * Peels from the right (ZIP, then state), then reads the city off what's left:
 * the last comma segment, or a right-to-left word scan that stops at a street
 * word or a house number, so "San Jose" survives and "Main St" doesn't.
 */
/**
 * @param {string | null} free
 * @returns {AddressParts}
 */
export function splitAddress(free) {
	if (!free || !free.trim()) return NO_ADDRESS;
	let rest = free.trim();

	/** @type {string | null} */
	let postalCode = null;
	const zip = rest.match(/[\s,]+(\d{5}(?:-\d{4})?)$/);
	if (zip) {
		postalCode = zip[1];
		rest = rest.slice(0, zip.index).trim().replace(/,$/, '');
	}

	/** @type {string | null} */
	let state = null;
	const st = rest.match(/[\s,]+([A-Za-z]{2})$/);
	if (st && isStateCode(st[1])) {
		state = st[1].toUpperCase();
		rest = rest.slice(0, st.index).trim().replace(/,$/, '');
	}

	const parts = rest
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return { address: null, city: null, state, postalCode };
	if (parts.length >= 2) {
		return {
			address: parts.slice(0, -1).join(', ') || null,
			city: parts[parts.length - 1],
			state,
			postalCode
		};
	}

	// One segment, no commas to lean on.
	const words = parts[0].split(/\s+/).filter(Boolean);
	const last = words[words.length - 1];
	if (state || postalCode) {
		// Something identified the tail as a location, so the trailing words are a
		// city rather than the end of a street. Two words is enough for "San Jose";
		// more and we start eating the street.
		/** @type {string[]} */
		const city = [];
		let i = words.length - 1;
		for (; i >= 0 && city.length < 2; i--) {
			if (/\d/.test(words[i]) || isStreetWord(words[i])) break;
			city.unshift(words[i]);
		}
		if (city.length > 0) {
			return {
				address: words.slice(0, i + 1).join(' ') || null,
				city: city.join(' '),
				state,
				postalCode
			};
		}
		return { address: parts[0], city: null, state, postalCode };
	}
	// Nothing but a short, number-free string that doesn't end in a street word:
	// somebody typed only the town.
	if (words.length <= 3 && !words.some((w) => /\d/.test(w)) && !isStreetWord(last)) {
		return { address: null, city: parts[0], state, postalCode };
	}
	return { address: parts[0], city: null, state, postalCode };
}

/**
 * The short "City, ST" line shown on order cards and the dashboard. Reads the
 * captured fields, and only parses the street line for customers who predate
 * them. Returns null when there is genuinely nothing to show.
 */
/**
 * @param {{ city?: string | null, state?: string | null, address?: string | null }} customer
 * @returns {string | null}
 */
export function customerLocation(customer) {
	const city = customer.city?.trim();
	const state = customer.state?.trim().toUpperCase();
	if (city && state) return `${city}, ${state}`;
	if (city) return city;
	if (state) return state;
	return formatLocation(customer.address ?? null);
}

/**
 * Extract a short "City" or "City, ST" line from a free-form address. The legacy
 * path — prefer `customerLocation`, which uses the captured fields first.
 */
/**
 * @param {string | null} address
 * @returns {string | null}
 */
export function formatLocation(address) {
	const { city, state } = splitAddress(address);
	if (city && state) return `${city}, ${state}`;
	return city;
}
