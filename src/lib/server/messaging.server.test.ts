import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	EmptyMessageError,
	counterpartOf,
	normalizeMessageBody,
	readColumnFor,
	threadsAwaitingReply
} from './messaging.server';

/**
 * The database is never touched here. This project has no DB test harness — every
 * server test either exercises logic lifted out of the query path, or reads the
 * source for an invariant a runtime test would silently pass through (see
 * billing.guard.test.ts, which this file's second half follows).
 *
 * So: the pure rules are executed, and the three properties that live inside
 * queries — the billing asymmetry, viewer-derived authorization, and messages
 * staying out of the timeline — are asserted against the source. Crude, and it
 * fails loudly at exactly the moment someone breaks one.
 *
 * NOT covered without a database: that an unauthorized viewer actually gets
 * nothing back. The predicate is asserted structurally below; its behavior is not.
 */

describe('normalizeMessageBody', () => {
	it('trims surrounding whitespace', () => {
		expect(normalizeMessageBody('  when do you start?  ')).toBe('when do you start?');
	});

	it('refuses an empty body', () => {
		expect(() => normalizeMessageBody('')).toThrow(EmptyMessageError);
	});

	it('refuses a whitespace-only body', () => {
		// Otherwise a stray newline posts a blank message into the thread and
		// notifies the other side about nothing.
		expect(() => normalizeMessageBody('   \n\t  ')).toThrow(EmptyMessageError);
	});

	it('keeps interior whitespace and newlines', () => {
		expect(normalizeMessageBody('line one\n\nline two')).toBe('line one\n\nline two');
	});
});

describe('read state is per side', () => {
	it('maps each role to its own read column', () => {
		// The asymmetry is the whole point: one side reading must not clear the other.
		expect(readColumnFor('contractor').name).toBe('read_by_contractor_at');
		expect(readColumnFor('customer').name).toBe('read_by_customer_at');
	});

	it('gives the two roles different columns', () => {
		expect(readColumnFor('contractor').name).not.toBe(readColumnFor('customer').name);
	});

	it('resolves the counterpart of each role', () => {
		expect(counterpartOf('contractor')).toBe('customer');
		expect(counterpartOf('customer')).toBe('contractor');
	});
});

const source = readFileSync('src/lib/server/messaging.server.ts', 'utf8');

/** Extract a top-level `export [async] function name(...) { ... }` body. */
function functionBody(name: string): string {
	const start = source.search(new RegExp(`^export (?:async )?function ${name}\\b`, 'm'));
	if (start === -1) throw new Error(`${name} not found — was it renamed or removed?`);
	const end = source.indexOf('\n}', start);
	return source.slice(start, end === -1 ? undefined : end);
}

describe('the billing guard is asymmetric by construction', () => {
	const send = functionBody('sendMessage');

	it('guards the contractor side', () => {
		expect(send).toMatch(/assertCanWrite\(/);
	});

	it('guards it only when the viewer is a contractor', () => {
		// ADR-0005: a customer's send never depends on their contractor's
		// subscription. An unconditional `await assertCanWrite(...)` here would
		// make a lapsed contractor's customers unable to reach them.
		expect(send).toMatch(/if \(viewer\.role === 'contractor'\) await assertCanWrite\(/);
	});

	it('never guards a customer read or write', () => {
		for (const fn of ['getThread', 'markThreadRead', 'awaitingReplyForCustomer']) {
			expect(functionBody(fn)).not.toMatch(/assertCan(Write|Create)\(/);
		}
	});
});

describe('every entry point authorizes from the viewer', () => {
	it.each(['getThread', 'sendMessage', 'markThreadRead'])(
		'%s calls authorizeViewer before touching the thread',
		(fn) => {
			expect(functionBody(fn)).toMatch(/await authorizeViewer\(orderId, viewer\)/);
		}
	);

	it('scopes authorization by the viewer role, not by the calling surface', () => {
		const auth = source.slice(source.indexOf('async function authorizeViewer'));
		expect(auth).toMatch(/eq\(order\.contractorId, viewer\.userId\)/);
		expect(auth).toMatch(/eq\(customer\.userId, viewer\.userId\)/);
	});

	it('excludes deleted orders from both sides', () => {
		const auth = source.slice(source.indexOf('async function authorizeViewer'));
		expect(auth).toMatch(/isNull\(order\.deletedAt\)/);
	});

	it('scopes the awaiting-reply queries to their own viewer', () => {
		// A list is a read too — an unscoped one leaks the existence of another
		// contractor's orders, or another customer's jobs.
		expect(functionBody('awaitingReplyForContractor')).toMatch(
			/eq\(order\.contractorId, contractorId\)/
		);
		expect(functionBody('awaitingReplyForCustomer')).toMatch(/eq\(customer\.userId, userId\)/);
	});
});

describe('messages stay out of the timeline', () => {
	it('never writes a timeline entry', () => {
		// A message is what was said about the job; the timeline is what happened
		// to it. Writing one as the other collapses the distinction the
		// order_message table exists to draw.
		expect(source).not.toMatch(/timelineEntry/);
	});

	it('marks a message read for its own author on insert', () => {
		const send = functionBody('sendMessage');
		expect(send).toMatch(/readByContractorAt: viewer\.role === 'contractor' \? now : null/);
		expect(send).toMatch(/readByCustomerAt: viewer\.role === 'customer' \? now : null/);
	});

	it('marks only the counterpart’s messages read', () => {
		expect(functionBody('markThreadRead')).toMatch(/ne\(orderMessage\.authorRole, viewer\.role\)/);
	});

	it('tolerates an unlinked customer on a contractor reply', () => {
		// The send must succeed with nobody to notify, rather than throwing on a
		// null recipient — a contractor can start a thread before the invite lands.
		expect(functionBody('sendMessage')).toMatch(/if \(recipientId\)/);
	});
});

describe('threadsAwaitingReply', () => {
	/**
	 * The rule this suite exists for. The first version of "who is waiting on me"
	 * keyed off unread state, and unread is cleared by OPENING an order — so a
	 * contractor who glanced at a job to check something silently lost the only
	 * record that a customer was owed an answer, and the dashboard went back to
	 * saying "all caught up".
	 *
	 * Nothing here consults read state at all. Whoever spoke last owes nothing;
	 * the other one owes a reply.
	 */
	const at = (mins: number) => new Date(Date.UTC(2026, 7, 13, 12, mins));
	const msg = (orderId: string, authorRole: string, mins: number, body = 'hello') => ({
		orderId,
		projectName: 'Kitchen',
		otherName: 'Sam',
		authorRole,
		body,
		createdAt: at(mins)
	});

	it('claims a thread whose newest message came from the other side', () => {
		const out = threadsAwaitingReply([msg('o1', 'customer', 10)], 'contractor', 'your customer');
		expect(out).toHaveLength(1);
		expect(out[0].orderId).toBe('o1');
		expect(out[0].pending).toBe(1);
	});

	it('ignores a thread the viewer answered last', () => {
		// Newest first, as the query returns them.
		const rows = [msg('o1', 'contractor', 20), msg('o1', 'customer', 10)];
		expect(threadsAwaitingReply(rows, 'contractor', 'your customer')).toEqual([]);
	});

	it('is unaffected by whether anything was read', () => {
		// There is no read column in the input at all — the point being that this
		// cannot regress into consulting one without the type changing.
		const rows = [msg('o1', 'customer', 10)];
		expect(threadsAwaitingReply(rows, 'contractor', 'your customer')).toHaveLength(1);
	});

	it('counts the run since the viewer last spoke, not the whole thread', () => {
		const rows = [
			msg('o1', 'customer', 40),
			msg('o1', 'customer', 30),
			msg('o1', 'contractor', 20),
			msg('o1', 'customer', 10)
		];
		const [entry] = threadsAwaitingReply(rows, 'contractor', 'your customer');
		expect(entry.pending).toBe(2);
	});

	it('previews the newest message, not the oldest', () => {
		const rows = [
			msg('o1', 'customer', 40, 'and another thing'),
			msg('o1', 'customer', 30, 'first question')
		];
		expect(threadsAwaitingReply(rows, 'contractor', 'your customer')[0].preview).toBe(
			'and another thing'
		);
	});

	it('works from the customer side with the roles swapped', () => {
		const rows = [msg('o1', 'contractor', 10)];
		expect(threadsAwaitingReply(rows, 'customer', 'your contractor')).toHaveLength(1);
		expect(threadsAwaitingReply(rows, 'contractor', 'your customer')).toEqual([]);
	});

	it('keeps orders separate and puts the most recent first', () => {
		const rows = [
			msg('o2', 'customer', 50),
			msg('o1', 'contractor', 40),
			msg('o1', 'customer', 30)
		];
		const out = threadsAwaitingReply(rows, 'contractor', 'your customer');
		expect(out.map((o) => o.orderId)).toEqual(['o2']);
	});

	it('falls back to a name when the order has no customer record', () => {
		const rows = [{ ...msg('o1', 'customer', 10), otherName: null }];
		expect(threadsAwaitingReply(rows, 'contractor', 'your customer')[0].otherName).toBe(
			'your customer'
		);
	});
});
