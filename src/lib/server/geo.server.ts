/**
 * ZIP → place, shared by everything that needs to turn a five-digit code into
 * somewhere real.
 *
 * This used to live inside `/api/zip/[code]`, which was fine while the customer
 * address form was the only caller. The dashboard's weather widget needs the
 * same lookup for a different answer out of the same response — coordinates
 * rather than a city name — and duplicating the fetch would have meant two
 * caches, two timeouts and two chances to disagree about what ZIP 78701 is.
 *
 * Proxied through the server rather than called from the browser: the upstream
 * answer is cached once per process instead of once per tab, the origin never
 * has to allow a third-party host, and a failing upstream becomes a quiet
 * non-answer instead of a console error on a form.
 */

/** Upstream. Free, keyless, US-only — which is all the address form accepts. */
const UPSTREAM = 'https://api.zippopotam.us/us';

/** How long to wait before deciding the lookup isn't going to help. */
const TIMEOUT_MS = 3000;

export type Place = {
	city: string;
	state: string;
	/** Null when the upstream answered without usable coordinates. */
	latitude: number | null;
	longitude: number | null;
};

/**
 * Process-lifetime cache, negatives included. ZIP boundaries change on the order
 * of years, and ~41k US ZIPs is a trivial ceiling even if every one of them were
 * asked for. Nothing here is user data, so it is shared across accounts.
 */
const cache = new Map<string, Place | null>();

/** The shape zippopotam answers with; only these four fields are wanted. */
type UpstreamBody = {
	places?: {
		'place name'?: string;
		'state abbreviation'?: string;
		latitude?: string;
		longitude?: string;
	}[];
};

/** A finite number, or null — upstream sends coordinates as strings. */
function num(value: string | undefined): number | null {
	if (value == null) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

/** True for a well-formed US ZIP. Callers validate before spending a request. */
export function isZip(code: string): boolean {
	return /^\d{5}$/.test(code);
}

/**
 * Look up a ZIP. Returns null for "no such ZIP" (a real answer, and cached);
 * throws for an upstream that is down or slow, which is not the same thing and
 * must not be remembered as one.
 */
export async function lookupZip(code: string): Promise<Place | null> {
	const cached = cache.get(code);
	if (cached !== undefined) return cached;

	let place: Place | null = null;
	const res = await fetch(`${UPSTREAM}/${code}`, {
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: { accept: 'application/json' }
	});
	// 404 is a real answer — that ZIP doesn't exist — and worth caching. Any other
	// non-OK status is an upstream problem, so it is thrown rather than remembered
	// as "no such ZIP".
	if (res.status === 404) {
		cache.set(code, null);
		return null;
	}
	if (!res.ok) throw new Error(`upstream ${res.status}`);

	const body = (await res.json()) as UpstreamBody;
	const first = body.places?.[0];
	const city = first?.['place name']?.trim();
	const state = first?.['state abbreviation']?.trim().toUpperCase();
	// A ZIP spanning several towns answers with several places; the first is the
	// primary one, and the contractor can correct it either way.
	if (city && /^[A-Z]{2}$/.test(state ?? '')) {
		place = {
			city,
			state: state!,
			latitude: num(first?.latitude),
			longitude: num(first?.longitude)
		};
	}

	cache.set(code, place);
	return place;
}
