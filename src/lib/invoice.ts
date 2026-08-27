import { escapeHtml, renderEmail, type EmailBranding, type RenderedEmail } from './email';
import { formatCents, paymentMethodLabel } from './crm';

/**
 * The invoice: what a job costs, what has been paid against it, and what is left.
 *
 * Everything here is PURE and runs in both the browser and Node, because the same
 * three numbers have to appear on three surfaces that would otherwise each do
 * their own arithmetic: the contractor's workspace, the customer's portal, and
 * the email that goes out at close-out. A balance that reads $0 in the portal and
 * $500 in the inbox is the single worst bug this feature could ship, so the sum
 * is written once and the surfaces only choose how to draw it.
 *
 * ADR-0010 still holds: this RECORDS money, it never moves any. Nothing in this
 * file talks to a payment rail, and `balanceCents` is a statement about
 * bookkeeping rather than a demand anyone can act on inside the app.
 */

/**
 * What a payment WAS. Labels only — see the schema note: the arithmetic never
 * branches on kind, so a mislabelled row changes the wording on one line and
 * never changes what someone owes.
 */
export const PAYMENT_KINDS = ['deposit', 'progress', 'final'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export function isPaymentKind(value: string): value is PaymentKind {
	return (PAYMENT_KINDS as readonly string[]).includes(value);
}

export function paymentKindLabel(kind: string): string {
	switch (kind) {
		case 'deposit':
			return 'Deposit';
		case 'final':
			return 'Final payment';
		case 'progress':
			return 'Payment';
		default:
			// A kind added later renders as itself rather than vanishing off the
			// invoice — an unlabelled line is still a line of someone's money.
			return kind;
	}
}

/** One recorded payment, as every surface needs it. */
export type PaymentRecord = {
	id: string;
	kind: string;
	amountCents: number;
	method: string | null;
	note: string | null;
	receivedAt: Date;
};

/**
 * Where the money stands.
 *
 * - `unset`   — no total has been agreed yet, so there is nothing to owe against.
 *               Payments may still exist (a deposit taken before the quote was
 *               finalized), and are reported as paid with no balance.
 * - `open`    — a total is set and some of it is outstanding.
 * - `settled` — paid to the cent.
 * - `overpaid`— more came in than the job costs. Shown rather than clamped: a
 *               contractor who owes a refund needs to see it, and silently
 *               flooring the balance at zero is how that gets missed.
 */
export type InvoiceStatus = 'unset' | 'open' | 'settled' | 'overpaid';

/** One charge on the invoice. Negative is a discount, not a special case. */
export type LineItem = {
	id: string;
	label: string;
	amountCents: number;
};

export type InvoiceSummary = {
	/** The agreed job total, or null while none has been set. */
	totalCents: number | null;
	/** The breakdown, in the contractor's order. Empty when the total is a lump sum. */
	lineItems: LineItem[];
	/**
	 * Whether `totalCents` came from the breakdown rather than from a typed figure.
	 * The UI needs to know: an itemised total is not editable, because editing it
	 * would mean editing a sum.
	 */
	itemised: boolean;
	/** Sum of every recorded payment. Zero when none have been. */
	paidCents: number;
	/** total − paid, or null when there is no total to subtract from. */
	balanceCents: number | null;
	status: InvoiceStatus;
	/** Payments oldest-first — an invoice reads as a running account, not a feed. */
	payments: PaymentRecord[];
};

/**
 * Add it up.
 *
 * Sorting happens here rather than in the query so that a caller who already has
 * the rows in some other order still gets an invoice that reads correctly.
 */
export function invoiceSummary(
	order: { finalAmountCents: number | null },
	payments: readonly PaymentRecord[],
	lineItems: readonly LineItem[] = []
): InvoiceSummary {
	const ordered = [...payments].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
	const paidCents = ordered.reduce((sum, p) => sum + p.amountCents, 0);

	// The rule, and the reason there is no "recalculate total" button anywhere:
	// once a job has a breakdown, the total IS the breakdown. The stored column is
	// left alone rather than written back, so the two can never be found
	// disagreeing — which is what happens to every invoice that keeps both and
	// tries to hold them equal.
	const items = [...lineItems];
	const itemised = items.length > 0;
	const totalCents = itemised
		? items.reduce((sum, i) => sum + i.amountCents, 0)
		: order.finalAmountCents;

	const balanceCents = totalCents == null ? null : totalCents - paidCents;

	let status: InvoiceStatus = 'unset';
	if (balanceCents != null) {
		if (balanceCents > 0) status = 'open';
		else if (balanceCents === 0) status = 'settled';
		else status = 'overpaid';
	}

	return {
		totalCents,
		paidCents,
		balanceCents,
		status,
		payments: ordered,
		lineItems: items,
		itemised
	};
}

/**
 * How much of the job has been paid for, 0–1, for the progress bar.
 *
 * Null when there is no total to measure against — a bar with no denominator is
 * a decoration. Clamped at 1 so an overpayment does not draw past the end of its
 * own track; the figures beside it are what report the excess.
 */
export function paidFraction(summary: InvoiceSummary): number | null {
	if (summary.totalCents == null || summary.totalCents <= 0) return null;
	return Math.max(0, Math.min(1, summary.paidCents / summary.totalCents));
}

/**
 * Half the total, for the deposit the contractor is about to type.
 *
 * A convenience for the "initial half" that is the normal opening move on a job,
 * and nothing more — it prefills a field the contractor can overwrite, and no
 * rule anywhere requires a deposit to be half of anything. Rounded to the nearest
 * cent, so two halves of an odd total can differ by a penny and still sum exactly.
 */
export function halfOf(totalCents: number | null): number | null {
	if (totalCents == null) return null;
	return Math.round(totalCents / 2);
}

/** "Deposit · Check · check #1041" — the descriptive half of one invoice line. */
export function paymentLineLabel(p: PaymentRecord): string {
	const parts = [paymentKindLabel(p.kind)];
	const method = paymentMethodLabel(p.method);
	if (method) parts.push(method);
	const note = p.note?.trim();
	if (note) parts.push(note);
	return parts.join(' · ');
}

/** A date on an invoice: short, unambiguous, no time of day. */
export function invoiceDate(d: Date): string {
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// --------------------------------------------------------------- Presentation

/**
 * The invoice as plain text, for the text/plain part of the email and for
 * anywhere a terminal or a screen reader is better served by lines than by a
 * table. Deliberately generated from the same `InvoiceSummary` as the HTML.
 */
export function invoiceText(summary: InvoiceSummary): string {
	const lines: string[] = [];
	// The breakdown first, then the total it adds up to. A customer reading down
	// should arrive at the figure, not be told it and asked to trust the rows.
	for (const item of summary.lineItems) {
		lines.push(`${item.label}: ${formatCents(item.amountCents)}`);
	}
	if (summary.totalCents != null) lines.push(`Total: ${formatCents(summary.totalCents)}`);
	for (const p of summary.payments) {
		lines.push(
			`${invoiceDate(p.receivedAt)} — ${paymentLineLabel(p)}: ${formatCents(p.amountCents)}`
		);
	}
	if (summary.payments.length > 0) lines.push(`Paid to date: ${formatCents(summary.paidCents)}`);
	if (summary.balanceCents != null) {
		if (summary.status === 'settled') lines.push('Balance due: $0.00 — paid in full. Thank you!');
		else if (summary.status === 'overpaid')
			lines.push(`Overpaid by ${formatCents(-summary.balanceCents)} — a refund is owed to you.`);
		else lines.push(`Balance due: ${formatCents(summary.balanceCents)}`);
	}
	return lines.join('\n');
}

// The email palette, restated rather than imported: `email.ts` keeps these
// private, an email has no CSS variables to reach for, and an invoice that
// borrows the app's tokens renders unstyled in every inbox. See email.ts.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#14171c';
const BODY_FG = '#1f2328';
const MUTED_FG = '#57606a';
const LINE = '#e2e6ea';
const SUNKEN = '#f6f8fa';

/**
 * The invoice table, as an HTML fragment for the email shell's `blockHtml` slot.
 *
 * Written to email rules, exactly as `email.ts` is: a real `<table>` doing real
 * layout, every style inlined, no classes, no web fonts. Outlook renders through
 * Word and will not lay this out with anything cleverer.
 *
 * Every dynamic string that lands in here is escaped — a payment note is typed by
 * the contractor and reaches a customer's inbox, which is precisely the path that
 * must not carry markup.
 */
export function renderInvoiceBlockHtml(summary: InvoiceSummary): string {
	const cell = `padding: 9px 0; font-family: ${FONT}; font-size: 15px; line-height: 1.4; color: ${BODY_FG};`;
	const cellRight = `${cell} text-align: right; white-space: nowrap;`;
	const muted = `font-family: ${FONT}; font-size: 13px; line-height: 1.4; color: ${MUTED_FG};`;

	const rows: string[] = [];

	// Each charge, in the contractor's order, above the total they sum to.
	for (const item of summary.lineItems) {
		rows.push(`<tr>
			<td style="${cell}">${escapeHtml(item.label)}</td>
			<td style="${cellRight}">${escapeHtml(formatCents(item.amountCents))}</td>
		</tr>`);
	}

	if (summary.totalCents != null) {
		// The total's rule sits above it when it is a sum, so a customer counting
		// the rows knows they are meant to.
		rows.push(`<tr>
			<td style="${cell} ${summary.itemised ? `border-top: 2px solid ${LINE};` : ''} border-bottom: 1px solid ${LINE}; font-weight: 700;">${summary.itemised ? 'Total' : 'Project total'}</td>
			<td style="${cellRight} ${summary.itemised ? `border-top: 2px solid ${LINE};` : ''} border-bottom: 1px solid ${LINE}; font-weight: 700;">${escapeHtml(formatCents(summary.totalCents))}</td>
		</tr>`);
	}

	for (const p of summary.payments) {
		rows.push(`<tr>
			<td style="${cell} border-bottom: 1px solid ${LINE};">
				${escapeHtml(paymentLineLabel(p))}
				<div style="${muted}">${escapeHtml(invoiceDate(p.receivedAt))}</div>
			</td>
			<td style="${cellRight} border-bottom: 1px solid ${LINE};">−${escapeHtml(formatCents(p.amountCents))}</td>
		</tr>`);
	}

	// The balance is NOT a row of this table — see `balanceBand` below. It gets its
	// own block underneath, because as a row it read as one more line of an
	// itemised list and the figure people actually open the email for was the one
	// hardest to find.
	if (summary.balanceCents == null && summary.payments.length > 0) {
		// No agreed total, but money has come in. Report what was received rather
		// than a balance nobody can compute.
		rows.push(`<tr>
			<td style="${cell} padding-top: 14px; font-weight: 700; color: ${INK};">Paid to date</td>
			<td style="${cellRight} padding-top: 14px; font-weight: 700; color: ${INK};">${escapeHtml(formatCents(summary.paidCents))}</td>
		</tr>`);
	}

	const band = balanceBand(summary);
	if (rows.length === 0 && !band) return '';

	const table =
		rows.length === 0
			? ''
			: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; margin: 4px 0 12px; background: ${SUNKEN}; border: 1px solid ${LINE}; border-radius: 10px;">
	<tr>
		<td style="padding: 6px 18px 14px;">
			<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
				${rows.join('\n\t\t\t\t')}
			</table>
		</td>
	</tr>
</table>`;

	return `${table}${band}`;
}

/**
 * The balance, as its own band under the breakdown.
 *
 * A tinted block with the figure at 26px, rather than a bolder row inside the
 * table. Two reasons it is separated: it is the one number the email is sent to
 * communicate, and every mail client renders nested table rows at whatever width
 * it likes — a block is the one thing that survives Outlook, Gmail and Apple Mail
 * looking the same.
 *
 * Yellow for money owed, green for settled. Both are pinned literals with pinned
 * foregrounds: an email has no theme, and the yellow stays light in every client,
 * so its text is dark in every client.
 */
function balanceBand(summary: InvoiceSummary): string {
	if (summary.balanceCents == null) return '';
	const settled = summary.status === 'settled';
	const overpaid = summary.status === 'overpaid';
	const label = overpaid ? 'Refund owed to you' : settled ? 'Paid in full' : 'Balance due';
	const value = overpaid ? -summary.balanceCents : summary.balanceCents;

	const bg = settled ? '#e6f4ea' : '#fff8dd';
	const edge = settled ? '#4ea866' : '#e6b800';
	const fg = settled ? '#1a7f37' : INK;

	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; margin: 0 0 18px; background: ${bg}; border: 1px solid ${edge}; border-radius: 10px;">
	<tr>
		<td style="padding: 12px 18px 14px;">
			<div style="font-family: ${FONT}; font-size: 11px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: ${MUTED_FG};">${escapeHtml(label)}</div>
			<div style="font-family: ${FONT}; font-size: 26px; font-weight: 700; line-height: 1.15; color: ${fg};">${escapeHtml(formatCents(value))}</div>
		</td>
	</tr>
</table>`;
}

// ------------------------------------------------------------- The email

export type InvoiceEmailOrder = {
	projectName: string | null;
	customerName: string;
	/** Free-form close-out details the contractor typed. Customer-facing. */
	finalNotes: string | null;
};

/**
 * Compose the final-invoice email.
 *
 * Pure, and exported rather than buried in the send path, because the whole point
 * of the preview route is that a contractor can see EXACTLY what their customer
 * will receive. Two renderers would eventually disagree; one renderer called from
 * both places cannot. `sendFinalInvoiceEmail` and
 * `/contractor/orders/[id]/invoice` are the two callers.
 *
 * The figures appear once in each part: as a table in the HTML (via the shell's
 * `blockHtml` slot) and as lines in the text (via `blockText`). The message
 * around them never restates a number — a total in the prose and a different
 * total in the table is the failure this arrangement rules out.
 */
export function composeInvoiceEmail(
	order: InvoiceEmailOrder,
	summary: InvoiceSummary,
	branding: EmailBranding
): RenderedEmail {
	const notes = order.finalNotes?.trim();
	const settled = summary.status === 'settled';

	const lines = [
		'Hi {{customer}},',
		'',
		settled
			? 'Here is your receipt for the {{project}} project.'
			: 'Here is the invoice for your {{project}} project.'
	];
	if (notes) lines.push('', notes);
	// The closing line is the one place the message reacts to the numbers, and it
	// says only which SITUATION this is — never an amount. The amount is the
	// table's job, and saying it twice is how the two drift.
	//
	// "below", not "above": the block goes in under the message in both parts (see
	// the shell's `blockHtml` slot), and this line said the opposite for as long as
	// it took to render one and read it.
	lines.push(
		'',
		settled
			? 'This is paid in full — thank you for your business.'
			: summary.status === 'overpaid'
				? 'It looks like we have been overpaid — we will be in touch to arrange a refund.'
				: 'The balance is shown below. Thank you for your business.'
	);

	return renderEmail(
		{
			subject: settled ? 'Receipt for {{project}}' : 'Invoice for {{project}}',
			body: lines.join('\n')
		},
		{
			customer: order.customerName,
			contractor: branding.businessName,
			project: order.projectName ?? ''
		},
		branding,
		{ blockHtml: renderInvoiceBlockHtml(summary), blockText: invoiceText(summary) }
	);
}
