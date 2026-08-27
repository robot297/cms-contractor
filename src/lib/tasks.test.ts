import { describe, expect, it } from 'vitest';
import {
	customerActionSummary,
	openTasks,
	taskDueLabel,
	taskSchema,
	taskUrgency,
	type CustomerTaskView
} from './tasks';

/** A task with everything defaulted, so each test states only what it is about. */
function task(over: Partial<CustomerTaskView> = {}): CustomerTaskView {
	return {
		id: 't1',
		title: 'Pick your tile',
		detail: '',
		dueOn: null,
		blocking: false,
		completedAt: null,
		completedBy: null,
		...over
	};
}

describe('taskSchema', () => {
	it('requires something to be asked for', () => {
		const result = taskSchema.safeParse({ title: '   ', detail: '', dueOn: '', blocking: false });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('Say what you need from them');
	});

	it('trims the ask and keeps the detail optional', () => {
		const result = taskSchema.parse({
			title: '  Sign the permit  ',
			detail: '',
			dueOn: '',
			blocking: false
		});
		expect(result.title).toBe('Sign the permit');
		expect(result.detail).toBe('');
	});

	it('treats an empty date as no date rather than as an invalid one', () => {
		expect(taskSchema.parse({ title: 'x', detail: '', dueOn: '', blocking: false }).dueOn).toBe(
			null
		);
	});

	it('refuses a date it cannot read', () => {
		const result = taskSchema.safeParse({
			title: 'x',
			detail: '',
			dueOn: 'next tuesday',
			blocking: false
		});
		expect(result.success).toBe(false);
	});

	it('keeps a real date as the ISO string it arrived as', () => {
		expect(
			taskSchema.parse({ title: 'x', detail: '', dueOn: '2026-09-04', blocking: true }).dueOn
		).toBe('2026-09-04');
	});
});

describe('taskUrgency', () => {
	const today = '2026-08-27';

	it('reads yesterday as overdue and today as today', () => {
		expect(taskUrgency('2026-08-26', today)).toBe('overdue');
		expect(taskUrgency(today, today)).toBe('today');
		expect(taskUrgency('2026-08-28', today)).toBe('upcoming');
	});

	it('is "none" without a date, which is a real answer and the common one', () => {
		expect(taskUrgency(null, today)).toBe('none');
	});

	/**
	 * The bug this rules out: `new Date('2026-08-27')` is UTC midnight, which is
	 * the day BEFORE anywhere west of Greenwich. Parsing to a Date would make a
	 * task due today read as a day overdue for every contractor in North America.
	 * Comparing the strings has no timezone to get wrong.
	 */
	it('compares calendar days, with no timezone to be wrong about', () => {
		expect(taskUrgency('2026-01-01', '2025-12-31')).toBe('upcoming');
		expect(taskUrgency('2025-12-31', '2026-01-01')).toBe('overdue');
		// Lexical order is date order for ISO strings — the whole reason the format
		// is written biggest-unit-first.
		expect(taskUrgency('2026-09-09', '2026-09-10')).toBe('overdue');
	});
});

describe('taskDueLabel', () => {
	it('names the two that matter and dates the rest', () => {
		expect(taskDueLabel('2026-08-26', '2026-08-27')).toBe('Overdue');
		expect(taskDueLabel('2026-08-27', '2026-08-27')).toBe('Due today');
		expect(taskDueLabel('2026-09-04', '2026-08-27')).toBe('Due Sep 4');
		expect(taskDueLabel(null, '2026-08-27')).toBe('No date');
	});
});

describe('openTasks', () => {
	it('is the ones nobody has ticked off', () => {
		const list = [task({ id: 'a' }), task({ id: 'b', completedAt: new Date() })];
		expect(openTasks(list).map((t) => t.id)).toEqual(['a']);
	});
});

describe('customerActionSummary', () => {
	const today = '2026-08-27';
	const base = { contractorName: 'Dana', today };

	it('says nothing when nothing is waiting', () => {
		const s = customerActionSummary({ ...base, paymentDue: false, tasks: [] });
		expect(s.waiting).toBe(false);
		expect(s.headline).toBe('');
	});

	it('still covers payment on its own — the case that used to be the only one', () => {
		const s = customerActionSummary({ ...base, paymentDue: true, tasks: [] });
		expect(s.waiting).toBe(true);
		expect(s.headline).toBe('This one’s with you — Dana is waiting on payment.');
	});

	it('counts one ask in words and several in digits', () => {
		const one = customerActionSummary({ ...base, paymentDue: false, tasks: [task()] });
		expect(one.headline).toBe('This one’s with you — Dana needs one thing from you.');

		const many = customerActionSummary({
			...base,
			paymentDue: false,
			tasks: [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })]
		});
		expect(many.headline).toBe('This one’s with you — Dana needs 3 things from you.');
	});

	/**
	 * The composition is the point. A job can be waiting on a deposit AND on a
	 * signed permit, and a customer told only about the money will pay it and then
	 * wonder why nothing happened.
	 */
	it('says both halves when both are outstanding', () => {
		const s = customerActionSummary({ ...base, paymentDue: true, tasks: [task()] });
		expect(s.headline).toBe(
			'This one’s with you — Dana is waiting on payment, and needs one thing from you.'
		);
	});

	it('ignores tasks that are already done', () => {
		const s = customerActionSummary({
			...base,
			paymentDue: false,
			tasks: [task({ completedAt: new Date(), completedBy: 'customer' })]
		});
		expect(s.waiting).toBe(false);
		expect(s.open).toEqual([]);
	});

	it('reports how many are late and whether any is holding the job up', () => {
		const s = customerActionSummary({
			...base,
			paymentDue: false,
			tasks: [
				task({ id: 'a', dueOn: '2026-08-20' }),
				task({ id: 'b', dueOn: '2026-08-26', blocking: true }),
				task({ id: 'c', dueOn: '2026-09-30' })
			]
		});
		expect(s.overdue).toBe(2);
		expect(s.blocking).toBe(true);
	});

	it('puts dated asks first, soonest at the top, and undated ones after', () => {
		const s = customerActionSummary({
			...base,
			paymentDue: false,
			tasks: [
				task({ id: 'whenever' }),
				task({ id: 'later', dueOn: '2026-09-30' }),
				task({ id: 'soon', dueOn: '2026-08-28' })
			]
		});
		// An undated ask is "whenever", not urgent-unknown — sorting it in by age
		// would put "pick your tile someday" above a permit due tomorrow.
		expect(s.open.map((t) => t.id)).toEqual(['soon', 'later', 'whenever']);
	});

	it('falls back to a name when the contractor has none on file', () => {
		const s = customerActionSummary({
			paymentDue: true,
			contractorName: '   ',
			tasks: [],
			today
		});
		expect(s.headline).toBe('This one’s with you — Your contractor is waiting on payment.');
	});
});
