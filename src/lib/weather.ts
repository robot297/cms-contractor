/**
 * Reading a forecast the way a contractor reads one.
 *
 * The upstream answers in WMO weather codes — integers from a 1950s synoptic
 * standard — so something has to turn 63 into "rain". These functions do that,
 * and then go one step further and say what it MEANS for a crew: a widget that
 * only prints "63°F, light rain" leaves the actual question ("can we frame the
 * deck Thursday?") to the reader. Pure and separate from the component so both
 * halves can be tested without rendering anything.
 */

/**
 * What `/api/weather` answers with.
 *
 * Declared here rather than in the endpoint so the widget can import it without
 * reaching into a route file for a type — the endpoint imports it from this side
 * instead, which is the direction the dependency should run.
 */
export type WeatherReport = {
	place: string;
	tempF: number;
	feelsLikeF: number;
	/** WMO weather code for conditions right now. */
	code: number;
	windMph: number;
	/** Today's high and low, and today's chance of rain (0-100). */
	highF: number;
	lowF: number;
	rainChance: number;
};

/** How a WMO code reads on the widget. */
export type Sky = { label: string; glyph: string };

/**
 * WMO code → words and a glyph.
 *
 * Grouped rather than exhaustive: the difference between "moderate drizzle" and
 * "dense drizzle" changes nothing about whether the crew goes out, and a widget
 * that draws that distinction is precise about the wrong thing.
 */
export function skyFor(code: number): Sky {
	if (code === 0) return { label: 'Clear', glyph: '☀️' };
	if (code <= 2) return { label: 'Partly cloudy', glyph: '🌤️' };
	if (code === 3) return { label: 'Overcast', glyph: '☁️' };
	if (code <= 48) return { label: 'Fog', glyph: '🌫️' };
	if (code <= 57) return { label: 'Drizzle', glyph: '🌦️' };
	if (code <= 67) return { label: 'Rain', glyph: '🌧️' };
	if (code <= 77) return { label: 'Snow', glyph: '🌨️' };
	if (code <= 82) return { label: 'Showers', glyph: '🌧️' };
	if (code <= 86) return { label: 'Snow showers', glyph: '🌨️' };
	return { label: 'Thunderstorms', glyph: '⛈️' };
}

/** True for codes that stop outdoor work rather than merely dampening it. */
export function isWet(code: number): boolean {
	return code >= 51;
}

/** What the day means for a crew. `none` renders nothing at all. */
export type WorkAdvisory = { kind: 'wet' | 'wind' | 'cold' | 'heat'; text: string } | null;

/** Above this, a ladder or a sheet of ply stops being a one-person job. */
const HIGH_WIND_MPH = 25;
/** Below this, concrete, adhesives and sealants stop curing predictably. */
const COLD_F = 35;
/** Above this, an afternoon on a roof needs a different schedule. */
const HOT_F = 95;

/**
 * One line of advice, or nothing.
 *
 * Deliberately at most ONE: a widget that stacks four warnings on a mediocre day
 * gets ignored on the day that actually matters. Ordered by what most reliably
 * cancels work — you can dress for cold, you cannot frame in a thunderstorm.
 */
export function workAdvisory(input: {
	code: number;
	windMph: number;
	tempF: number;
	rainChanceToday?: number;
}): WorkAdvisory {
	const { code, windMph, tempF, rainChanceToday } = input;
	if (isWet(code)) return { kind: 'wet', text: 'Wet now — indoor work or a rain plan.' };
	if ((rainChanceToday ?? 0) >= 60)
		return { kind: 'wet', text: `${rainChanceToday}% chance of rain today.` };
	if (windMph >= HIGH_WIND_MPH) return { kind: 'wind', text: `Wind ${windMph} mph — watch lifts.` };
	if (tempF <= COLD_F)
		return { kind: 'cold', text: 'Near freezing — pours and sealants will lag.' };
	if (tempF >= HOT_F) return { kind: 'heat', text: 'Heat — start early, keep water on site.' };
	return null;
}
