import { describe, expect, it } from 'vitest';
import {
	coversDay,
	firstWorkerError,
	isIsoDate,
	stintDays,
	stintLabel,
	stintsOverlap,
	todayIso,
	validateStint,
	workerInitials,
	workerSchema
} from './worker';

/** A fixed "now" so the year-eliding in `stintLabel` is testable at all. */
const NOW = new Date(2026, 2, 15);

describe('isIsoDate', () => {
	it('accepts a real calendar day', () => {
		expect(isIsoDate('2026-03-02')).toBe(true);
	});

	it('rejects a day that does not exist', () => {
		// The shape is fine and `new Date()` would roll this forward to 3 March,
		// which would store a different day than the one that was typed.
		expect(isIsoDate('2026-02-31')).toBe(false);
		expect(isIsoDate('2026-13-01')).toBe(false);
	});

	it('rejects anything that is not the format', () => {
		expect(isIsoDate('3/2/2026')).toBe(false);
		expect(isIsoDate('2026-3-2')).toBe(false);
		expect(isIsoDate('')).toBe(false);
	});

	it('knows which years have a 29 February', () => {
		expect(isIsoDate('2028-02-29')).toBe(true);
		expect(isIsoDate('2026-02-29')).toBe(false);
	});
});

describe('todayIso', () => {
	it('formats the local day, zero-padded', () => {
		expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
	});

	it('uses the local calendar day, not UTC', () => {
		// Late evening on the US west coast is already tomorrow in UTC. Taking the
		// UTC day here would put a crew member on site the wrong day.
		const lateEvening = new Date(2026, 2, 15, 23, 30);
		expect(todayIso(lateEvening)).toBe('2026-03-15');
	});
});

describe('validateStint', () => {
	it('accepts a normal range', () => {
		const result = validateStint({ startsOn: '2026-03-02', endsOn: '2026-03-06' });
		expect(result).toEqual({ ok: true, value: { startsOn: '2026-03-02', endsOn: '2026-03-06' } });
	});

	it('accepts a single day', () => {
		const result = validateStint({ startsOn: '2026-03-02', endsOn: '2026-03-02' });
		expect(result.ok).toBe(true);
	});

	it('accepts no dates at all — assigned, not yet scheduled', () => {
		expect(validateStint({})).toEqual({ ok: true, value: { startsOn: null, endsOn: null } });
		expect(validateStint({ startsOn: '  ', endsOn: '' }).ok).toBe(true);
	});

	it('accepts an open end in either direction', () => {
		expect(validateStint({ startsOn: '2026-03-02' }).ok).toBe(true);
		expect(validateStint({ endsOn: '2026-03-06' }).ok).toBe(true);
	});

	it('refuses an end before its start', () => {
		const result = validateStint({ startsOn: '2026-03-06', endsOn: '2026-03-02' });
		expect(result).toMatchObject({ ok: false, field: 'endsOn' });
	});

	it('refuses a date that is not a date', () => {
		expect(validateStint({ startsOn: 'tomorrow' })).toMatchObject({ ok: false, field: 'startsOn' });
		expect(validateStint({ endsOn: '2026-02-30' })).toMatchObject({ ok: false, field: 'endsOn' });
	});
});

describe('coversDay', () => {
	const stint = { startsOn: '2026-03-02', endsOn: '2026-03-06' };

	it('includes both ends', () => {
		expect(coversDay(stint, '2026-03-02')).toBe(true);
		expect(coversDay(stint, '2026-03-06')).toBe(true);
	});

	it('excludes the days either side', () => {
		expect(coversDay(stint, '2026-03-01')).toBe(false);
		expect(coversDay(stint, '2026-03-07')).toBe(false);
	});

	it('runs forever past an open end', () => {
		expect(coversDay({ startsOn: '2026-03-02', endsOn: null }, '2030-01-01')).toBe(true);
		expect(coversDay({ startsOn: null, endsOn: '2026-03-06' }, '2020-01-01')).toBe(true);
	});

	it('treats an undated assignment as covering no particular day', () => {
		// "On the job, dates not pinned" is not a claim about today — reading it as
		// one would put every unscheduled crew member on today's on-site list.
		expect(coversDay({ startsOn: null, endsOn: null }, '2026-03-02')).toBe(false);
	});
});

describe('stintsOverlap', () => {
	it('spots a genuine clash', () => {
		expect(
			stintsOverlap(
				{ startsOn: '2026-03-02', endsOn: '2026-03-06' },
				{ startsOn: '2026-03-05', endsOn: '2026-03-09' }
			)
		).toBe(true);
	});

	it('allows back-to-back stints', () => {
		expect(
			stintsOverlap(
				{ startsOn: '2026-03-02', endsOn: '2026-03-04' },
				{ startsOn: '2026-03-05', endsOn: '2026-03-09' }
			)
		).toBe(false);
	});

	it('counts a shared single day as a clash', () => {
		expect(
			stintsOverlap(
				{ startsOn: '2026-03-04', endsOn: '2026-03-04' },
				{ startsOn: '2026-03-04', endsOn: '2026-03-04' }
			)
		).toBe(true);
	});

	it('lets an undated assignment clash with nothing', () => {
		expect(
			stintsOverlap(
				{ startsOn: null, endsOn: null },
				{ startsOn: '2026-03-02', endsOn: '2026-03-06' }
			)
		).toBe(false);
	});

	it('treats two open-ended stints as clashing', () => {
		expect(
			stintsOverlap(
				{ startsOn: '2026-03-02', endsOn: null },
				{ startsOn: '2026-06-01', endsOn: null }
			)
		).toBe(true);
	});
});

describe('stintLabel', () => {
	it('names a range', () => {
		expect(stintLabel({ startsOn: '2026-03-02', endsOn: '2026-03-06' }, NOW)).toBe('Mar 2 – Mar 6');
	});

	it('collapses a single day', () => {
		expect(stintLabel({ startsOn: '2026-03-02', endsOn: '2026-03-02' }, NOW)).toBe('Mar 2');
	});

	it('says which end is open', () => {
		expect(stintLabel({ startsOn: '2026-03-02', endsOn: null }, NOW)).toBe('From Mar 2');
		expect(stintLabel({ startsOn: null, endsOn: '2026-03-06' }, NOW)).toBe('Until Mar 6');
	});

	it('says so when there are no dates', () => {
		expect(stintLabel({ startsOn: null, endsOn: null }, NOW)).toBe('No dates set');
	});

	it('shows the year only when it is not the current one', () => {
		expect(stintLabel({ startsOn: '2027-01-04', endsOn: null }, NOW)).toBe('From Jan 4, 2027');
	});

	it('reads a bare date as local, not UTC', () => {
		// `new Date('2026-03-02')` is UTC midnight, which is still 1 March anywhere
		// west of Greenwich — so this would name the day before.
		expect(stintLabel({ startsOn: '2026-03-02', endsOn: '2026-03-02' }, NOW)).toBe('Mar 2');
	});
});

describe('stintDays', () => {
	it('counts both ends', () => {
		expect(stintDays({ startsOn: '2026-03-02', endsOn: '2026-03-06' })).toBe(5);
		expect(stintDays({ startsOn: '2026-03-02', endsOn: '2026-03-02' })).toBe(1);
	});

	it('spans a daylight-saving boundary without losing an hour', () => {
		// US DST begins 8 March 2026. A naive millisecond division rounds to 8.96
		// days here and truncates to 8; rounding gives the 9 a calendar shows.
		expect(stintDays({ startsOn: '2026-03-05', endsOn: '2026-03-13' })).toBe(9);
	});

	it('cannot count an open-ended stint', () => {
		expect(stintDays({ startsOn: '2026-03-02', endsOn: null })).toBeNull();
		expect(stintDays({ startsOn: null, endsOn: null })).toBeNull();
	});
});

describe('workerSchema', () => {
	it('needs only a name', () => {
		const result = workerSchema.safeParse({ name: 'Dave Mackie' });
		expect(result.success).toBe(true);
	});

	it('accepts a crew member with a phone and no email', () => {
		// The difference from a subcontractor, who needs an address for the portal
		// invite. A crew hand may only ever be a name and a mobile number.
		const result = workerSchema.safeParse({ name: 'Dave', phone: '5125550134', email: '' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.email).toBeNull();
			expect(result.data.phone).toBe('(512) 555-0134');
		}
	});

	it('normalizes an email that is given', () => {
		const result = workerSchema.safeParse({ name: 'Dave', email: '  Dave@Example.COM ' });
		expect(result.success && result.data.email).toBe('dave@example.com');
	});

	it('refuses an email that is not one', () => {
		expect(workerSchema.safeParse({ name: 'Dave', email: 'not-an-email' }).success).toBe(false);
	});

	it('refuses a blank name', () => {
		expect(workerSchema.safeParse({ name: '   ' }).success).toBe(false);
	});
});

describe('firstWorkerError', () => {
	it('is null when the details are fine', () => {
		expect(firstWorkerError({ name: 'Dave' })).toBeNull();
	});

	it('reports the first problem in words a person can act on', () => {
		expect(firstWorkerError({ name: '' })).toBe('A name is required');
		expect(firstWorkerError({ name: 'Dave', email: 'nope' })).toBe('Enter a valid email');
	});
});

describe('workerInitials', () => {
	it('takes at most two', () => {
		expect(workerInitials('Jo Bloggs')).toBe('JB');
		expect(workerInitials('Mary Jane Watson')).toBe('MJ');
		expect(workerInitials('Cher')).toBe('C');
	});

	it('answers for a nameless row rather than returning nothing', () => {
		expect(workerInitials('')).toBe('?');
		expect(workerInitials('   ')).toBe('?');
	});
});
