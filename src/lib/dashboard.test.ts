import { describe, expect, it } from 'vitest';
import {
	compactMoney,
	dashboardMetrics,
	MIX_SLOTS,
	percentChange,
	pipelineByState,
	projectMix,
	revenueByMonth,
	type MetricOrder
} from './dashboard';

/**
 * A fixed "now" every test reasons against.
 *
 * 15 March 2026, local. The date matters: these functions bucket by calendar
 * month, so a test that used the real clock would pass all month and then fail
 * on the 1st, which is the least useful day to find out.
 */
const NOW = new Date(2026, 2, 15, 12, 0, 0);

function order(partial: Partial<MetricOrder> = {}): MetricOrder {
	return {
		state: 'In Progress',
		projectType: 'Deck',
		finalAmountCents: null,
		paidAt: null,
		createdAt: new Date(2026, 0, 1),
		...partial
	};
}

describe('revenueByMonth', () => {
	it('returns one point per month, oldest first, current month last', () => {
		const points = revenueByMonth([], NOW);
		expect(points.map((p) => p.label)).toEqual(['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']);
		expect(points.at(-1)?.partial).toBe(true);
		expect(points.slice(0, -1).every((p) => !p.partial)).toBe(true);
	});

	it('keeps a month with no payments as a zero rather than dropping it', () => {
		const points = revenueByMonth(
			[order({ paidAt: new Date(2026, 2, 3), finalAmountCents: 500 })],
			NOW
		);
		// A gap that silently closes up turns a quiet February into a February
		// that never happened, and misstates the shape of the year.
		expect(points).toHaveLength(6);
		expect(points.find((p) => p.label === 'Feb')?.cents).toBe(0);
	});

	it('sums payments that land in the same month', () => {
		const points = revenueByMonth(
			[
				order({ paidAt: new Date(2026, 1, 2), finalAmountCents: 1000 }),
				order({ paidAt: new Date(2026, 1, 27), finalAmountCents: 2500 })
			],
			NOW
		);
		expect(points.find((p) => p.label === 'Feb')?.cents).toBe(3500);
	});

	it('ignores a close-out that is only half filled in', () => {
		const points = revenueByMonth(
			[
				// Paid, but nobody typed an amount.
				order({ paidAt: new Date(2026, 2, 4), finalAmountCents: null }),
				// An amount, but never marked received.
				order({ paidAt: null, finalAmountCents: 90_000 })
			],
			NOW
		);
		expect(points.every((p) => p.cents === 0)).toBe(true);
	});

	it('ignores payments older than the window', () => {
		const points = revenueByMonth(
			[order({ paidAt: new Date(2025, 5, 1), finalAmountCents: 100_000 })],
			NOW
		);
		expect(points.every((p) => p.cents === 0)).toBe(true);
	});
});

describe('pipelineByState', () => {
	it('counts only live jobs, biggest first', () => {
		const rows = pipelineByState([
			order({ state: 'Inquiry' }),
			order({ state: 'Inquiry' }),
			order({ state: 'In Progress' }),
			order({ state: 'Work Complete' }),
			order({ state: 'Work Cancelled' }),
			order({ state: 'On Hold / Archived' })
		]);
		expect(rows).toEqual([
			{ state: 'Inquiry', count: 2 },
			{ state: 'In Progress', count: 1 }
		]);
	});

	it('breaks ties on the canonical state order, so equal counts do not reshuffle', () => {
		const rows = pipelineByState([order({ state: 'In Progress' }), order({ state: 'Quote Sent' })]);
		expect(rows.map((r) => r.state)).toEqual(['Quote Sent', 'In Progress']);
	});

	it('is empty when nothing is live', () => {
		expect(pipelineByState([order({ state: 'Work Complete' })])).toEqual([]);
	});
});

describe('projectMix', () => {
	it('assigns palette slots in rank order', () => {
		const { mix } = projectMix([
			order({ projectType: 'Deck' }),
			order({ projectType: 'Deck' }),
			order({ projectType: 'Shed' })
		]);
		expect(mix).toEqual([
			{ label: 'Deck', count: 2, slot: 1 },
			{ label: 'Shed', count: 1, slot: 2 }
		]);
	});

	it('folds everything past the palette into one grey Other', () => {
		const types = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
		// Descending counts so the ranking is unambiguous.
		const orders = types.flatMap((t, i) =>
			Array.from({ length: types.length - i }, () => order({ projectType: t }))
		);
		const { mix } = projectMix(orders);
		expect(mix).toHaveLength(MIX_SLOTS + 1);
		const other = mix.at(-1)!;
		expect(other.slot).toBe(0);
		// F (2) + G (1). Named with its size rather than left as a bare "Other".
		expect(other.label).toBe('2 other types');
		expect(other.count).toBe(3);
	});

	it('counts untyped jobs separately rather than folding them into Other', () => {
		const { mix, untyped } = projectMix([
			order({ projectType: null }),
			order({ projectType: '   ' }),
			order({ projectType: 'Deck' })
		]);
		expect(untyped).toBe(2);
		// "Other" means "a type without its own colour"; "no type recorded" is a
		// different fact, and an actionable one.
		expect(mix).toEqual([{ label: 'Deck', count: 1, slot: 1 }]);
	});

	it('ignores finished and cancelled work', () => {
		const { mix, untyped } = projectMix([
			order({ state: 'Work Complete', projectType: 'Deck' }),
			order({ state: 'Work Cancelled', projectType: null })
		]);
		expect(mix).toEqual([]);
		expect(untyped).toBe(0);
	});
});

describe('dashboardMetrics', () => {
	it('splits recorded payments across this month and last', () => {
		const m = dashboardMetrics(
			[
				order({ paidAt: new Date(2026, 2, 2), finalAmountCents: 1000 }),
				order({ paidAt: new Date(2026, 1, 2), finalAmountCents: 4000 }),
				order({ paidAt: new Date(2025, 11, 2), finalAmountCents: 9999 })
			],
			{ now: NOW, awaitingReplyCount: 0, needsResponseCount: 0 }
		);
		expect(m.revenueMtdCents).toBe(1000);
		expect(m.revenuePrevMonthCents).toBe(4000);
	});

	it('counts completions in the month they were paid', () => {
		const m = dashboardMetrics(
			[
				order({ state: 'Work Complete', paidAt: new Date(2026, 2, 5), finalAmountCents: 100 }),
				order({ state: 'Work Complete', paidAt: new Date(2026, 0, 5), finalAmountCents: 100 })
			],
			{ now: NOW, awaitingReplyCount: 0, needsResponseCount: 0 }
		);
		expect(m.completedThisMonth).toBe(1);
	});

	it("passes the caller's own counts straight through", () => {
		const m = dashboardMetrics([], { now: NOW, awaitingReplyCount: 3, needsResponseCount: 7 });
		expect(m.awaitingReplyCount).toBe(3);
		expect(m.needsResponseCount).toBe(7);
	});

	it('accepts dates as strings, the way they arrive from a load boundary', () => {
		const m = dashboardMetrics([order({ paidAt: '2026-03-02T10:00:00', finalAmountCents: 2500 })], {
			now: NOW,
			awaitingReplyCount: 0,
			needsResponseCount: 0
		});
		expect(m.revenueMtdCents).toBe(2500);
	});
});

describe('compactMoney', () => {
	it('drops the cents and shortens the big numbers', () => {
		expect(compactMoney(0)).toBe('$0');
		expect(compactMoney(45_67)).toBe('$46');
		expect(compactMoney(1_234_56)).toBe('$1.2k');
		expect(compactMoney(12_000_00)).toBe('$12k');
		expect(compactMoney(4_250_000_00)).toBe('$4.3M');
	});
});

describe('percentChange', () => {
	it('rounds to a whole percent', () => {
		expect(percentChange(150, 100)).toBe(50);
		expect(percentChange(50, 100)).toBe(-50);
	});

	it('refuses to divide by a month that had nothing in it', () => {
		// "+∞% vs last month" is a bug report, not a metric.
		expect(percentChange(100, 0)).toBeNull();
	});
});
