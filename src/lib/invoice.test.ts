import { describe, expect, it } from 'vitest';
import {
	composeInvoiceEmail,
	halfOf,
	invoiceSummary,
	invoiceText,
	paidFraction,
	paymentLineLabel,
	renderInvoiceBlockHtml,
	type PaymentRecord
} from './invoice';

/** A payment, with only the fields a given test cares about spelled out. */
function pay(overrides: Partial<PaymentRecord> & { amountCents: number }): PaymentRecord {
	return {
		id: overrides.id ?? `p-${overrides.amountCents}`,
		kind: overrides.kind ?? 'progress',
		method: overrides.method ?? null,
		note: overrides.note ?? null,
		receivedAt: overrides.receivedAt ?? new Date('2026-03-01T12:00:00Z'),
		amountCents: overrides.amountCents
	};
}

describe('invoiceSummary', () => {
	it('reports nothing owed when no total has been agreed', () => {
		const s = invoiceSummary({ finalAmountCents: null }, []);
		expect(s.status).toBe('unset');
		expect(s.balanceCents).toBeNull();
		expect(s.paidCents).toBe(0);
	});

	it('still counts a deposit taken before the total was set', () => {
		// The real sequence on a job quoted after a holding deposit: money exists,
		// a balance does not, and reporting the deposit as $0 would lose it.
		const s = invoiceSummary({ finalAmountCents: null }, [pay({ amountCents: 50_000 })]);
		expect(s.status).toBe('unset');
		expect(s.paidCents).toBe(50_000);
		expect(s.balanceCents).toBeNull();
	});

	it('subtracts a deposit from the total', () => {
		const s = invoiceSummary({ finalAmountCents: 480_000 }, [
			pay({ kind: 'deposit', amountCents: 240_000 })
		]);
		expect(s.status).toBe('open');
		expect(s.balanceCents).toBe(240_000);
	});

	it('settles at exactly zero, and only at exactly zero', () => {
		const total = { finalAmountCents: 480_000 };
		expect(invoiceSummary(total, [pay({ amountCents: 480_000 })]).status).toBe('settled');
		expect(invoiceSummary(total, [pay({ amountCents: 479_999 })]).status).toBe('open');
		expect(invoiceSummary(total, [pay({ amountCents: 480_001 })]).status).toBe('overpaid');
	});

	it('reports an overpayment as a negative balance rather than clamping it', () => {
		// Clamping at zero is how a refund someone is owed goes unnoticed.
		const s = invoiceSummary({ finalAmountCents: 100_000 }, [pay({ amountCents: 125_000 })]);
		expect(s.status).toBe('overpaid');
		expect(s.balanceCents).toBe(-25_000);
	});

	it('sums a deposit plus a balance to settled', () => {
		const s = invoiceSummary({ finalAmountCents: 480_000 }, [
			pay({ id: 'a', kind: 'deposit', amountCents: 240_000 }),
			pay({ id: 'b', kind: 'final', amountCents: 240_000 })
		]);
		expect(s.paidCents).toBe(480_000);
		expect(s.status).toBe('settled');
	});

	it('orders payments oldest-first however they arrive', () => {
		const s = invoiceSummary({ finalAmountCents: 300_000 }, [
			pay({ id: 'late', amountCents: 100_000, receivedAt: new Date('2026-05-02T00:00:00Z') }),
			pay({ id: 'early', amountCents: 200_000, receivedAt: new Date('2026-01-02T00:00:00Z') })
		]);
		expect(s.payments.map((p) => p.id)).toEqual(['early', 'late']);
	});

	it('handles a refund recorded as a negative amount', () => {
		const s = invoiceSummary({ finalAmountCents: 100_000 }, [
			pay({ id: 'in', amountCents: 120_000 }),
			pay({ id: 'back', amountCents: -20_000 })
		]);
		expect(s.paidCents).toBe(100_000);
		expect(s.status).toBe('settled');
	});
});

describe('halfOf', () => {
	it('is null when there is no total to halve', () => {
		expect(halfOf(null)).toBeNull();
	});

	it('splits an odd total so the two halves still sum exactly', () => {
		const total = 100_001;
		const first = halfOf(total)!;
		expect(first + (total - first)).toBe(total);
	});
});

describe('paymentLineLabel', () => {
	it('names the kind, the method and the note', () => {
		expect(
			paymentLineLabel(
				pay({ kind: 'deposit', method: 'check', note: 'check #1041', amountCents: 1 })
			)
		).toBe('Deposit · Check · check #1041');
	});

	it('drops the parts that were not given', () => {
		expect(paymentLineLabel(pay({ kind: 'final', amountCents: 1 }))).toBe('Final payment');
	});
});

describe('the rendered invoice', () => {
	const summary = invoiceSummary({ finalAmountCents: 480_000 }, [
		pay({ kind: 'deposit', method: 'check', amountCents: 240_000 })
	]);

	it('states the same balance in the text part and the HTML part', () => {
		// The failure this whole module is arranged to prevent: two renderers, two
		// answers. Both parts are generated from one summary, so both must agree.
		expect(invoiceText(summary)).toContain('$2,400.00');
		expect(renderInvoiceBlockHtml(summary)).toContain('$2,400.00');
	});

	it('escapes a contractor note on its way to the customer', () => {
		const withMarkup = invoiceSummary({ finalAmountCents: 10_000 }, [
			pay({ amountCents: 5_000, note: '<script>alert(1)</script>' })
		]);
		const html = renderInvoiceBlockHtml(withMarkup);
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('renders nothing at all when there is no total and no payment', () => {
		expect(renderInvoiceBlockHtml(invoiceSummary({ finalAmountCents: null }, []))).toBe('');
	});
});

describe('composeInvoiceEmail', () => {
	const branding = { businessName: 'Northgate Builders', signature: 'Thanks,\n{{contractor}}' };
	const order = { projectName: 'Back deck', customerName: 'Dana Reyes', finalNotes: null };

	it('calls itself an invoice while money is outstanding, and a receipt once it is not', () => {
		const open = invoiceSummary({ finalAmountCents: 480_000 }, [pay({ amountCents: 240_000 })]);
		const settled = invoiceSummary({ finalAmountCents: 480_000 }, [pay({ amountCents: 480_000 })]);
		expect(composeInvoiceEmail(order, open, branding).subject).toBe('Invoice for Back deck');
		expect(composeInvoiceEmail(order, settled, branding).subject).toBe('Receipt for Back deck');
	});

	it('puts the figures in both parts and states them in neither prose', () => {
		const summary = invoiceSummary({ finalAmountCents: 480_000 }, [
			pay({ kind: 'deposit', amountCents: 240_000 })
		]);
		const { html, text } = composeInvoiceEmail(order, summary, branding);
		for (const part of [html, text]) {
			expect(part).toContain('$4,800.00'); // total
			expect(part).toContain('$2,400.00'); // deposit and balance
		}
		// The message around the table never names an amount, so the two can't drift.
		expect(text).toContain('The balance is shown below.');
	});

	it('puts the invoice above the signature, not after it', () => {
		const summary = invoiceSummary({ finalAmountCents: 100_000 }, []);
		const { text } = composeInvoiceEmail(order, summary, branding);
		expect(text.indexOf('Total:')).toBeLessThan(text.indexOf('Northgate Builders'));
	});

	it('carries the contractor’s close-out details through to the customer', () => {
		const summary = invoiceSummary({ finalAmountCents: 100_000 }, []);
		const withNotes = { ...order, finalNotes: 'Includes the extra step and the gate.' };
		const { html, text } = composeInvoiceEmail(withNotes, summary, branding);
		expect(text).toContain('Includes the extra step and the gate.');
		expect(html).toContain('Includes the extra step and the gate.');
	});
});

describe('line items', () => {
	const item = (id: string, label: string, amountCents: number) => ({ id, label, amountCents });

	it('leaves the typed total alone when there is no breakdown', () => {
		const s = invoiceSummary({ finalAmountCents: 480_000 }, [], []);
		expect(s.itemised).toBe(false);
		expect(s.totalCents).toBe(480_000);
	});

	it('takes the total FROM the lines once any exist, ignoring the stored figure', () => {
		// The stored 480_000 is deliberately wrong here: the point of the rule is
		// that a breakdown and the figure above it can never be found disagreeing.
		const s = invoiceSummary(
			{ finalAmountCents: 480_000 },
			[],
			[item('a', 'Cedar decking', 300_000), item('b', 'Labour', 150_000)]
		);
		expect(s.itemised).toBe(true);
		expect(s.totalCents).toBe(450_000);
	});

	it('treats a negative line as a discount rather than a special case', () => {
		const s = invoiceSummary(
			{ finalAmountCents: null },
			[],
			[item('a', 'Deck', 500_000), item('b', 'Repeat customer discount', -50_000)]
		);
		expect(s.totalCents).toBe(450_000);
		expect(s.status).toBe('open');
	});

	it('measures the balance against the itemised total', () => {
		const s = invoiceSummary(
			{ finalAmountCents: 999_999 },
			[pay({ amountCents: 200_000 })],
			[item('a', 'Deck', 450_000)]
		);
		expect(s.balanceCents).toBe(250_000);
	});

	it('puts every line in both parts of the email, above the total', () => {
		const s = invoiceSummary(
			{ finalAmountCents: null },
			[],
			[item('a', 'Cedar decking', 300_000), item('b', 'Permit', 15_000)]
		);
		const text = invoiceText(s);
		expect(text).toContain('Cedar decking: $3,000.00');
		expect(text).toContain('Permit: $150.00');
		expect(text.indexOf('Cedar decking')).toBeLessThan(text.indexOf('Total:'));

		const html = renderInvoiceBlockHtml(s);
		expect(html).toContain('Cedar decking');
		expect(html).toContain('$3,150.00');
	});

	it('escapes a line label on its way to the customer', () => {
		const s = invoiceSummary(
			{ finalAmountCents: null },
			[],
			[item('a', '<img src=x onerror=alert(1)>', 100)]
		);
		const html = renderInvoiceBlockHtml(s);
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
	});
});

describe('paidFraction', () => {
	it('is null with no total to measure against', () => {
		expect(
			paidFraction(invoiceSummary({ finalAmountCents: null }, [pay({ amountCents: 100 })]))
		).toBeNull();
	});

	it('reports the paid share of the total', () => {
		expect(
			paidFraction(invoiceSummary({ finalAmountCents: 400_000 }, [pay({ amountCents: 100_000 })]))
		).toBeCloseTo(0.25);
	});

	it('clamps an overpayment to a full bar rather than drawing past the end', () => {
		expect(
			paidFraction(invoiceSummary({ finalAmountCents: 100_000 }, [pay({ amountCents: 150_000 })]))
		).toBe(1);
	});

	it('does not divide by a zero total', () => {
		expect(paidFraction(invoiceSummary({ finalAmountCents: 0 }, []))).toBeNull();
	});
});

describe('the balance band', () => {
	it('states the balance once, outside the itemised table', () => {
		// It used to be the last row of that table, which is where it got lost.
		const s = invoiceSummary({ finalAmountCents: 480_000 }, [pay({ amountCents: 240_000 })]);
		const html = renderInvoiceBlockHtml(s);
		expect(html).toContain('Balance due');
		// Once, not twice — a figure repeated in two places is a figure that can be
		// found disagreeing with itself after the next edit.
		expect(html.match(/Balance due/g)).toHaveLength(1);
	});

	it('calls a settled invoice paid in full rather than showing a zero balance', () => {
		const s = invoiceSummary({ finalAmountCents: 480_000 }, [pay({ amountCents: 480_000 })]);
		const html = renderInvoiceBlockHtml(s);
		expect(html).toContain('Paid in full');
		expect(html).not.toContain('Balance due');
	});

	it('names a refund rather than printing a negative balance at the customer', () => {
		const s = invoiceSummary({ finalAmountCents: 100_000 }, [pay({ amountCents: 130_000 })]);
		const html = renderInvoiceBlockHtml(s);
		expect(html).toContain('Refund owed to you');
		expect(html).toContain('$300.00');
		expect(html).not.toContain('-$300.00');
	});

	it('renders nothing when there is no total to owe against', () => {
		expect(renderInvoiceBlockHtml(invoiceSummary({ finalAmountCents: null }, []))).toBe('');
	});
});
