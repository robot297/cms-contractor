import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * ZIP → city/state, for the customer form.
 *
 * Contractors type a five-digit ZIP correctly far more often than they type a
 * city name, so the form asks for the ZIP first and fills the other two in from
 * this. Both stay editable — this is a head start, not a lock.
 *
 * Proxied through the server rather than called from the browser for three
 * reasons: the upstream answer is cached here once for every contractor rather
 * than once per tab, the origin is never asked to allow a third-party host, and
 * a failing upstream turns into a quiet non-answer instead of a console error on
 * the customer form.
 */

/** Upstream. Free, keyless, US-only — which is all the address form accepts. */
const UPSTREAM = 'https://api.zippopotam.us/us';

/** How long to wait before deciding the lookup isn't going to help. */
const TIMEOUT_MS = 3000;

type Place = { city: string; state: string };

/**
 * Process-lifetime cache, negatives included. ZIP boundaries change on the
 * order of years, and ~41k US ZIPs is a trivial ceiling even if every one of
 * them were asked for. Nothing here is user data, so it is shared across
 * accounts.
 */
const cache = new Map<string, Place | null>();

/** The shape zippopotam answers with; only these two fields are wanted. */
type UpstreamBody = {
	places?: { 'place name'?: string; 'state abbreviation'?: string }[];
};

async function lookup(code: string): Promise<Place | null> {
	const cached = cache.get(code);
	if (cached !== undefined) return cached;

	let place: Place | null = null;
	try {
		const res = await fetch(`${UPSTREAM}/${code}`, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { accept: 'application/json' }
		});
		// 404 is a real answer — that ZIP doesn't exist — and worth caching. Any
		// other non-OK status is an upstream problem, so it is thrown rather than
		// remembered as "no such ZIP".
		if (res.status === 404) {
			cache.set(code, null);
			return null;
		}
		if (!res.ok) throw new Error(`upstream ${res.status}`);
		const body = (await res.json()) as UpstreamBody;
		const first = body.places?.[0];
		const city = first?.['place name']?.trim();
		const state = first?.['state abbreviation']?.trim().toUpperCase();
		// A ZIP spanning several towns answers with several places; the first is
		// the primary one, and the contractor can correct it either way.
		if (city && /^[A-Z]{2}$/.test(state ?? '')) place = { city, state: state! };
	} catch (err) {
		// Timeouts and upstream outages are not this app's problem to report: the
		// form simply doesn't autofill, and the contractor types the city as they
		// did before. Deliberately not cached, so the next attempt tries again.
		console.warn(`ZIP lookup failed for ${code}:`, err);
		error(503, 'ZIP lookup is unavailable');
	}

	cache.set(code, place);
	return place;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	// Signed-in users only. The endpoint is harmless, but it spends an outbound
	// request per miss and there is no reason to offer that to the open internet.
	if (!locals.user) error(401, 'Sign in first');

	const code = params.code.trim();
	if (!/^\d{5}$/.test(code)) error(400, 'Expected a five-digit ZIP code');

	const place = await lookup(code);
	if (!place) error(404, 'No such ZIP code');

	return json(place, {
		// Safe to sit in the browser cache for a day: this is public reference
		// data, identical for every account.
		headers: { 'cache-control': 'private, max-age=86400' }
	});
};
