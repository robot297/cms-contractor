import { json, error } from '@sveltejs/kit';
import { isZip, lookupZip } from '$lib/server/geo.server';
// The response shape lives with the code that reads it, so the widget never has
// to import a type out of a route file.
import type { WeatherReport } from '$lib/weather';
import type { RequestHandler } from './$types';

/**
 * Weather where the work is.
 *
 * Outdoor trades lose days to it — a pour, a roof, a deck frame all stop for
 * rain — so "can we frame this afternoon" is a real scheduling question and not
 * a decoration. The dashboard asks for the ZIP most of the contractor's live
 * jobs are in; see `workAreaZip` in the dashboard loader for how that is chosen.
 *
 * TODAY ONLY — conditions now, and the day's high and low. A four-day outlook
 * was a weather app pretending to be a scheduling tool, and the hourly split
 * that briefly replaced it was the same mistake at finer grain. One day is what
 * a dashboard glance is for.
 *
 * Same shape as the ZIP endpoint next door, for the same reasons: keyless
 * upstream, proxied so the browser never talks to a third party, cached once per
 * process, and a failing upstream turns into a widget that quietly isn't there
 * rather than an error on the page.
 */

/** Free, keyless, no signup, no attribution requirement. */
const UPSTREAM = 'https://api.open-meteo.com/v1/forecast';

const TIMEOUT_MS = 4000;

/**
 * How long an answer is reused.
 *
 * Fifteen minutes: the upstream model itself updates hourly, so anything shorter
 * spends requests to re-fetch a number that cannot have moved, and anything much
 * longer starts showing yesterday afternoon's sky during this morning's coffee.
 */
const TTL_MS = 15 * 60 * 1000;

type Cached = { at: number; report: WeatherReport };
const cache = new Map<string, Cached>();

/** What Open-Meteo answers with; only these fields are read. */
type UpstreamBody = {
	current?: {
		temperature_2m?: number;
		apparent_temperature?: number;
		weather_code?: number;
		wind_speed_10m?: number;
	};
	daily?: {
		temperature_2m_max?: number[];
		temperature_2m_min?: number[];
		precipitation_probability_max?: number[];
	};
};

/** Whole degrees / mph — a forecast to one decimal place is false precision. */
function round(n: number | undefined): number {
	return Math.round(n ?? 0);
}

export const GET: RequestHandler = async ({ url, locals }) => {
	// Signed-in users only, exactly as with the ZIP lookup: harmless data, but
	// every miss spends two outbound requests and that isn't on offer to the
	// open internet.
	if (!locals.user) error(401, 'Sign in first');

	const zip = (url.searchParams.get('zip') ?? '').trim();
	if (!isZip(zip)) error(400, 'Expected a five-digit ZIP code');

	const hit = cache.get(zip);
	if (hit && Date.now() - hit.at < TTL_MS) return json(hit.report);

	let place;
	try {
		place = await lookupZip(zip);
	} catch (err) {
		console.warn(`Weather: ZIP lookup failed for ${zip}:`, err);
		error(503, 'Weather is unavailable');
	}
	// No such ZIP, or one the upstream knows by name but not by position. Either
	// way there is nothing to forecast for, and that is a 404 rather than an
	// error the widget should retry.
	if (!place?.latitude || !place.longitude) error(404, 'No weather for that ZIP code');

	const query = new URLSearchParams({
		latitude: String(place.latitude),
		longitude: String(place.longitude),
		current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
		daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
		// The app is US-only (the address form enforces it), so US units.
		temperature_unit: 'fahrenheit',
		wind_speed_unit: 'mph',
		precipitation_unit: 'inch',
		// "Today" must mean today where the JOB is, not where the server is —
		// otherwise a late-evening glance in Austin can be handed tomorrow's high.
		timezone: 'auto',
		forecast_days: '1'
	});

	let body: UpstreamBody;
	try {
		const res = await fetch(`${UPSTREAM}?${query}`, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { accept: 'application/json' }
		});
		if (!res.ok) throw new Error(`upstream ${res.status}`);
		body = (await res.json()) as UpstreamBody;
	} catch (err) {
		// Not cached: the next visit tries again rather than inheriting an outage.
		console.warn(`Weather lookup failed for ${zip}:`, err);
		error(503, 'Weather is unavailable');
	}

	const report: WeatherReport = {
		place: `${place.city}, ${place.state}`,
		tempF: round(body.current?.temperature_2m),
		feelsLikeF: round(body.current?.apparent_temperature),
		code: body.current?.weather_code ?? 0,
		windMph: round(body.current?.wind_speed_10m),
		highF: round(body.daily?.temperature_2m_max?.[0]),
		lowF: round(body.daily?.temperature_2m_min?.[0]),
		rainChance: round(body.daily?.precipitation_probability_max?.[0])
	};

	cache.set(zip, { at: Date.now(), report });
	return json(report);
};
