/**
 * What the dashboard's charts and stat tiles are made of.
 *
 * Every figure here is derived from the orders the dashboard ALREADY loads, so
 * the whole analytics band costs no extra queries — a contractor's book of work
 * is a few hundred rows at the outside, and aggregating it in memory is cheaper
 * than the round trips a set of GROUP BYs would spend.
 *
 * Pure on purpose: these take plain rows and a "now", and return plain data. The
 * page can render them, a test can assert on them, and neither needs a database.
 * `now` is a parameter rather than a `new Date()` inside because month boundaries
 * are the entire subject — a function that reads the clock itself can only be
 * tested on the day it happens to run.
 */

import { CONTRACTOR_ORDER_STATES, isActiveState, type ContractorOrderState } from './crm.js';

/**
 * The slice of an order these figures need.
 *
 * Deliberately narrower than `ContractorOrderView`: it is the contract between
 * the loader and this module, and a wide one would let an unrelated column
 * change break the metrics.
 */
export type MetricOrder = {
	state: string;
	projectType: string | null;
	finalAmountCents: number | null;
	paidAt: Date | string | null;
	createdAt: Date | string;
};

/** How many months of recorded payments the revenue chart carries. */
export const REVENUE_MONTHS = 6;

/**
 * How many project types get their own colour before the tail is folded up.
 *
 * Five, because that is where the validated categorical palette stops being
 * reliably distinguishable to a colour-blind reader — see the `--viz-*` tokens
 * in app.css. A sixth type does not get a generated sixth hue; it joins "Other".
 */
export const MIX_SLOTS = 5;

export type MonthPoint = {
	/** `YYYY-MM`, so the caller can key on it without re-parsing a label. */
	key: string;
	/** "Mar" — the axis label. */
	label: string;
	cents: number;
	/**
	 * The month still being earned. Drawn in a lighter step of the same hue: the
	 * bar is real, but it is not comparable to the completed months beside it,
	 * and a chart that hides that reads as a collapse in revenue every 1st.
	 */
	partial: boolean;
};

export type PipelineStage = {
	state: ContractorOrderState;
	count: number;
};

export type MixSlice = {
	label: string;
	count: number;
	/** Palette slot 1-5, or 0 for the folded "Other" tail. */
	slot: number;
};

export type DashboardMetrics = {
	/** Jobs neither finished, cancelled, nor archived — the live book of work. */
	activeCount: number;
	/** Of those, how many have a customer waiting on a reply. */
	awaitingReplyCount: number;
	/** Everything on the "response needed" feed: due follow-ups plus unanswered. */
	needsResponseCount: number;
	/** Recorded payments in the current calendar month, in cents. */
	revenueMtdCents: number;
	/** The same figure for the month before, so the tile can state a direction. */
	revenuePrevMonthCents: number;
	/** Orders marked complete in the current calendar month. */
	completedThisMonth: number;
	/** Recorded payments per month, oldest first, current month last. */
	revenueByMonth: MonthPoint[];
	/** Live jobs by state, biggest first; states with none are omitted. */
	pipeline: PipelineStage[];
	/** Live jobs by project type, biggest first, tail folded into "Other". */
	mix: MixSlice[];
	/** Live jobs with no recorded type — the mix chart's honesty footnote. */
	mixUntyped: number;
};

/** `YYYY-MM` for the calendar month a date falls in, in local time. */
function monthKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function asDate(value: Date | string | null): Date | null {
	if (value == null) return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The last `REVENUE_MONTHS` months of recorded payments, current month last.
 *
 * Months with nothing in them are present with a zero rather than skipped: a
 * gap in a time axis that silently closes up turns a quiet March into a March
 * that never happened, and makes the shape of the year a lie.
 */
export function revenueByMonth(
	orders: MetricOrder[],
	now: Date,
	months = REVENUE_MONTHS
): MonthPoint[] {
	const buckets = new Map<string, number>();
	const points: MonthPoint[] = [];
	const fmt = new Intl.DateTimeFormat('en-US', { month: 'short' });

	for (let i = months - 1; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const key = monthKey(d);
		buckets.set(key, 0);
		points.push({ key, label: fmt.format(d), cents: 0, partial: i === 0 });
	}

	for (const o of orders) {
		const paid = asDate(o.paidAt);
		// Both halves are required: `paidAt` says the money arrived, `finalAmountCents`
		// says how much. An order with one and not the other is a close-out that was
		// only half filled in, and guessing at the missing half would put a number on
		// the dashboard that the contractor never typed.
		if (!paid || o.finalAmountCents == null) continue;
		const key = monthKey(paid);
		if (!buckets.has(key)) continue;
		buckets.set(key, buckets.get(key)! + o.finalAmountCents);
	}

	for (const p of points) p.cents = buckets.get(p.key) ?? 0;
	return points;
}

/**
 * Live jobs by state, biggest first.
 *
 * Empty states are dropped rather than drawn as zero-length bars — unlike the
 * revenue months these are categories, not a continuous axis, so a state nobody
 * is in is simply not part of the picture. Ties break on the canonical state
 * order so the chart doesn't reshuffle itself between two equal counts.
 */
export function pipelineByState(orders: MetricOrder[]): PipelineStage[] {
	const counts = new Map<string, number>();
	for (const o of orders) {
		if (!isActiveState(o.state as ContractorOrderState)) continue;
		counts.set(o.state, (counts.get(o.state) ?? 0) + 1);
	}
	const rank = new Map(CONTRACTOR_ORDER_STATES.map((s, i) => [s as string, i]));
	return [...counts.entries()]
		.map(([state, count]) => ({ state: state as ContractorOrderState, count }))
		.sort((a, b) => b.count - a.count || (rank.get(a.state) ?? 0) - (rank.get(b.state) ?? 0));
}

/**
 * Live jobs by project type, biggest first, with everything past the palette's
 * fifth slot folded into a single grey "Other".
 *
 * Untyped orders are NOT folded in — they are counted separately and reported
 * beside the chart. "Other" means "a type we didn't give its own colour"; using
 * it for "no type recorded" as well would quietly merge two different facts, and
 * the second one is actionable (go and fill them in) where the first isn't.
 */
export function projectMix(orders: MetricOrder[]): { mix: MixSlice[]; untyped: number } {
	const counts = new Map<string, number>();
	let untyped = 0;
	for (const o of orders) {
		if (!isActiveState(o.state as ContractorOrderState)) continue;
		const type = o.projectType?.trim();
		if (!type) {
			untyped++;
			continue;
		}
		counts.set(type, (counts.get(type) ?? 0) + 1);
	}

	const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	const mix: MixSlice[] = ranked
		.slice(0, MIX_SLOTS)
		.map(([label, count], i) => ({ label, count, slot: i + 1 }));

	const tail = ranked.slice(MIX_SLOTS);
	if (tail.length > 0) {
		mix.push({
			// Named with its size, so "Other" is a summary rather than a shrug.
			label: `${tail.length} other types`,
			count: tail.reduce((sum, [, n]) => sum + n, 0),
			slot: 0
		});
	}
	return { mix, untyped };
}

/**
 * Everything the dashboard's analytics band shows, from one pass over the
 * contractor's orders.
 */
export function dashboardMetrics(
	orders: MetricOrder[],
	opts: { now: Date; awaitingReplyCount: number; needsResponseCount: number }
): DashboardMetrics {
	const { now } = opts;
	const thisMonth = monthKey(now);
	const prevMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

	let activeCount = 0;
	let revenueMtdCents = 0;
	let revenuePrevMonthCents = 0;
	let completedThisMonth = 0;

	for (const o of orders) {
		if (isActiveState(o.state as ContractorOrderState)) activeCount++;
		const paid = asDate(o.paidAt);
		if (paid && o.finalAmountCents != null) {
			const key = monthKey(paid);
			if (key === thisMonth) revenueMtdCents += o.finalAmountCents;
			else if (key === prevMonth) revenuePrevMonthCents += o.finalAmountCents;
		}
		// Completion is dated by the payment where there is one and by the last
		// update otherwise — an order can be finished before it is paid for.
		if (o.state === 'Work Complete') {
			const when = paid ?? asDate(o.createdAt);
			if (when && monthKey(when) === thisMonth) completedThisMonth++;
		}
	}

	const { mix, untyped } = projectMix(orders);
	return {
		activeCount,
		awaitingReplyCount: opts.awaitingReplyCount,
		needsResponseCount: opts.needsResponseCount,
		revenueMtdCents,
		revenuePrevMonthCents,
		completedThisMonth,
		revenueByMonth: revenueByMonth(orders, now),
		pipeline: pipelineByState(orders),
		mix,
		mixUntyped: untyped
	};
}

/**
 * A money figure short enough to sit in a stat tile or on an axis tick.
 *
 * `$12.4k` rather than `$12,400.00`: a dashboard number is read at a glance and
 * the cents are noise at that size. The exact figure is always one click away on
 * the order that recorded it.
 */
export function compactMoney(cents: number): string {
	const dollars = cents / 100;
	if (dollars === 0) return '$0';
	const abs = Math.abs(dollars);
	if (abs >= 1_000_000) return `$${trimZero(dollars / 1_000_000)}M`;
	if (abs >= 1_000) return `$${trimZero(dollars / 1_000)}k`;
	return `$${Math.round(dollars).toLocaleString('en-US')}`;
}

/** 12.0 → "12", 12.4 → "12.4". One decimal is the most a glance can use. */
function trimZero(n: number): string {
	return n.toFixed(1).replace(/\.0$/, '');
}

/**
 * Month-over-month movement, as a whole percentage.
 *
 * Null when there is nothing to compare against — last month at zero makes every
 * change infinite, and "+∞%" on a dashboard is a bug report waiting to happen.
 */
export function percentChange(current: number, previous: number): number | null {
	if (previous <= 0) return null;
	return Math.round(((current - previous) / previous) * 100);
}
