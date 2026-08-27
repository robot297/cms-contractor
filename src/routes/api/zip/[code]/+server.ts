import { json, error } from '@sveltejs/kit';
import { isZip, lookupZip } from '$lib/server/geo.server';
import type { RequestHandler } from './$types';

/**
 * ZIP → city/state, for the customer form.
 *
 * Contractors type a five-digit ZIP correctly far more often than they type a
 * city name, so the form asks for the ZIP first and fills the other two in from
 * this. Both stay editable — this is a head start, not a lock.
 *
 * The lookup itself (and its cache) lives in `$lib/server/geo.server`, shared
 * with the dashboard's weather widget, which needs coordinates out of the same
 * upstream answer. This endpoint is only the city/state view of it.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	// Signed-in users only. The endpoint is harmless, but it spends an outbound
	// request per miss and there is no reason to offer that to the open internet.
	if (!locals.user) error(401, 'Sign in first');

	const code = params.code.trim();
	if (!isZip(code)) error(400, 'Expected a five-digit ZIP code');

	let place;
	try {
		place = await lookupZip(code);
	} catch (err) {
		// Timeouts and upstream outages are not this app's problem to report: the
		// form simply doesn't autofill, and the contractor types the city as they
		// did before.
		console.warn(`ZIP lookup failed for ${code}:`, err);
		error(503, 'ZIP lookup is unavailable');
	}
	if (!place) error(404, 'No such ZIP code');

	return json(
		{ city: place.city, state: place.state },
		{
			// Safe to sit in the browser cache for a day: this is public reference
			// data, identical for every account.
			headers: { 'cache-control': 'private, max-age=86400' }
		}
	);
};
