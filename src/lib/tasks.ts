import { z } from 'zod';
import { isIsoDate, type IsoDate } from './worker.js';

/**
 * Tasks — the things a Contractor needs FROM a Customer.
 *
 * Everything the portal could previously say about "waiting on you" was derived
 * from the Order's State, and only two of the ten States meant it: Deposit
 * Pending and Final Payment Pending. Payment was therefore the only ask the
 * product could express. A colour to pick, a permit to sign, a gate code, being
 * home on Thursday — all of those had to go in a Message, where they read as
 * conversation and scrolled away, and the job sat still while the portal
 * cheerfully reported "In progress".
 *
 * This module is the pure half: what a Task is allowed to say, when it is late,
 * and — in `customerActionSummary` — the ONE answer to "is the ball in the
 * customer's court, and why", which both the contractor's workspace and the
 * customer's portal read rather than each deciding for themselves. Two surfaces
 * computing that separately is how they end up disagreeing about whose turn it
 * is, which is the only thing this feature exists to make unambiguous.
 */

export const TASK_TITLE_MAX = 120;
export const TASK_DETAIL_MAX = 2000;

export const taskSchema = z.object({
	// The ask itself, addressed to the customer: "Pick your tile", "Sign the
	// permit", "Pay the deposit". Required, because a task with no title is a
	// reminder the customer cannot act on.
	title: z
		.string()
		.trim()
		.min(1, 'Say what you need from them')
		.max(TASK_TITLE_MAX, `Keep it under ${TASK_TITLE_MAX} characters`),
	// Where to send it, which of the three quotes, why it is holding things up.
	detail: z.string().trim().max(TASK_DETAIL_MAX, 'That detail is too long').default(''),
	// Null is a real answer and the common one — "when you get a chance".
	dueOn: z
		.string()
		.trim()
		.refine((v) => v === '' || isIsoDate(v), 'Enter a valid date')
		.transform((v) => (v === '' ? null : (v as IsoDate)))
		.nullable()
		.default(null),
	// A claim the contractor is making to the customer, not a rule the app
	// enforces: nothing is locked, the portal just says the job is held up.
	blocking: z.boolean().default(false)
});

export type TaskInput = z.infer<typeof taskSchema>;

/** The shape both surfaces render. Dates arrive as they leave the database. */
export type CustomerTaskView = {
	id: string;
	title: string;
	detail: string;
	dueOn: string | null;
	blocking: boolean;
	completedAt: Date | string | null;
	completedBy: string | null;
};

/** Who ticked a task off. Both are legitimate; they are not the same event. */
export type TaskCompleter = 'contractor' | 'customer';

export function isTaskCompleter(value: string): value is TaskCompleter {
	return value === 'contractor' || value === 'customer';
}

export function isTaskOpen(task: Pick<CustomerTaskView, 'completedAt'>): boolean {
	return task.completedAt == null;
}

export function openTasks<T extends Pick<CustomerTaskView, 'completedAt'>>(tasks: T[]): T[] {
	return tasks.filter(isTaskOpen);
}

export type TaskUrgency = 'overdue' | 'today' | 'upcoming' | 'none';

/**
 * How late a task is, by CALENDAR DAY.
 *
 * Compared as ISO strings rather than by parsing to `Date`, which is the same
 * decision `coversDay` makes in `worker.ts` and for the same reason: a `date`
 * column has no time and no timezone, and `new Date('2026-08-27')` invents both
 * — it lands on UTC midnight, which is the day BEFORE anywhere west of
 * Greenwich. A task due today would then read as a day overdue for every
 * contractor in North America. ISO dates sort lexically in date order, which is
 * the whole reason the format is written biggest-unit-first.
 */
export function taskUrgency(dueOn: string | null, today: IsoDate): TaskUrgency {
	if (!dueOn) return 'none';
	if (dueOn < today) return 'overdue';
	if (dueOn === today) return 'today';
	return 'upcoming';
}

/** The date on a task, in the words the customer is shown. */
export function taskDueLabel(dueOn: string | null, today: IsoDate): string {
	switch (taskUrgency(dueOn, today)) {
		case 'overdue':
			return 'Overdue';
		case 'today':
			return 'Due today';
		case 'upcoming':
			return `Due ${formatDueDate(dueOn as IsoDate)}`;
		case 'none':
			return 'No date';
	}
}

/** "Sep 4" — a due date is read at a glance, and the year is almost never news. */
function formatDueDate(dueOn: IsoDate): string {
	const [y, m, d] = dueOn.split('-').map(Number);
	// Constructed from the parts rather than parsed from the string, so this stays
	// on the local calendar day the column meant. See `taskUrgency`.
	return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type CustomerActionSummary = {
	/** Whether anything at all is waiting on the customer. */
	waiting: boolean;
	/** The outstanding tasks, soonest first. Empty when none. */
	open: CustomerTaskView[];
	/** How many of those are past their date. */
	overdue: number;
	/** Whether any of them is one the contractor says the job is held up by. */
	blocking: boolean;
	/** Whether the order's own State is one of the two that mean "pay me". */
	paymentDue: boolean;
	/**
	 * One sentence, addressed to the customer, covering both halves.
	 *
	 * Empty when nothing is waiting. It lives here rather than in either template
	 * because BOTH surfaces say it — the portal to the customer, and the
	 * contractor's workspace as a preview of what the customer is being told. A
	 * preview that can drift from the thing it previews is worse than no preview.
	 */
	headline: string;
};

/**
 * Is the ball in the customer's court, and why — the one answer, for both sides.
 *
 * Payment and tasks COMPOSE rather than compete. A job can be waiting on a
 * deposit and on a signed permit at the same time, and a customer told only
 * about the money will pay it and then wonder why nothing happened.
 */
export function customerActionSummary(input: {
	/** `isCustomerActionState(order.state)` — the two "pay me" states. */
	paymentDue: boolean;
	contractorName: string;
	tasks: CustomerTaskView[];
	today: IsoDate;
}): CustomerActionSummary {
	const { paymentDue, contractorName, today } = input;
	const open = [...openTasks(input.tasks)].sort(byDueThenAge);
	const overdue = open.filter((t) => taskUrgency(t.dueOn, today) === 'overdue').length;
	const blocking = open.some((t) => t.blocking);
	const who = contractorName.trim() || 'Your contractor';

	let headline = '';
	if (paymentDue && open.length > 0) {
		headline = `This one’s with you — ${who} is waiting on payment, and needs ${countPhrase(open.length)} from you.`;
	} else if (paymentDue) {
		headline = `This one’s with you — ${who} is waiting on payment.`;
	} else if (open.length > 0) {
		headline = `This one’s with you — ${who} needs ${countPhrase(open.length)} from you.`;
	}

	return { waiting: paymentDue || open.length > 0, open, overdue, blocking, paymentDue, headline };
}

/** "one thing" / "3 things" — counted in words at one, digits above it. */
function countPhrase(count: number): string {
	return count === 1 ? 'one thing' : `${count} things`;
}

/**
 * Dated tasks first and soonest at the top; undated ones after, oldest first.
 *
 * An undated task is not urgent-unknown, it is "whenever" — sorting it in with
 * the dated ones by creation time would put "pick your tile someday" above a
 * permit due tomorrow.
 */
function byDueThenAge(a: CustomerTaskView, b: CustomerTaskView): number {
	if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn);
	if (a.dueOn) return -1;
	if (b.dueOn) return 1;
	return 0;
}
