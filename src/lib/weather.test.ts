import { describe, expect, it } from 'vitest';
import { isWet, skyFor, workAdvisory } from './weather';

describe('skyFor', () => {
	it('names the codes a crew actually reacts to', () => {
		expect(skyFor(0).label).toBe('Clear');
		expect(skyFor(2).label).toBe('Partly cloudy');
		expect(skyFor(3).label).toBe('Overcast');
		expect(skyFor(45).label).toBe('Fog');
		expect(skyFor(63).label).toBe('Rain');
		expect(skyFor(75).label).toBe('Snow');
		expect(skyFor(95).label).toBe('Thunderstorms');
	});

	it('answers for a code it has never seen rather than returning nothing', () => {
		// The upstream can add codes; a widget that renders "undefined" over a job
		// site is worse than one that says "thunderstorms" about hail.
		expect(skyFor(199).label).toBeTruthy();
		expect(skyFor(199).glyph).toBeTruthy();
	});
});

describe('isWet', () => {
	it('separates the codes that stop work from the ones that only dull the light', () => {
		expect(isWet(0)).toBe(false);
		expect(isWet(3)).toBe(false);
		expect(isWet(48)).toBe(false);
		expect(isWet(51)).toBe(true);
		expect(isWet(95)).toBe(true);
	});
});

describe('workAdvisory', () => {
	it('says nothing on a workable day', () => {
		expect(workAdvisory({ code: 1, windMph: 8, tempF: 68, rainChanceToday: 10 })).toBeNull();
	});

	it('leads with rain falling now', () => {
		const a = workAdvisory({ code: 63, windMph: 30, tempF: 20 });
		// Wind and cold are both over their thresholds here; only one line is ever
		// shown, and being rained on outranks both.
		expect(a?.kind).toBe('wet');
	});

	it('warns on a high chance of rain even under a clear sky right now', () => {
		const a = workAdvisory({ code: 0, windMph: 5, tempF: 70, rainChanceToday: 80 });
		expect(a?.kind).toBe('wet');
		expect(a?.text).toContain('80%');
	});

	it('warns on wind, then cold, then heat', () => {
		expect(workAdvisory({ code: 0, windMph: 30, tempF: 70 })?.kind).toBe('wind');
		expect(workAdvisory({ code: 0, windMph: 5, tempF: 30 })?.kind).toBe('cold');
		expect(workAdvisory({ code: 0, windMph: 5, tempF: 99 })?.kind).toBe('heat');
	});

	it('treats a missing rain chance as no reason to warn', () => {
		expect(workAdvisory({ code: 0, windMph: 5, tempF: 70 })).toBeNull();
	});
});
