# 11. Payments are rows, and the balance is derived

Date: 2026-08-23

## Status

Accepted

Extends [ADR-0010](0010-record-final-payment-never-process-it.md).

## Context

ADR-0010 gave an Order a close-out record: one total (`final_amount_cents`), one
method, and one `paid_at` stamp. That shape can express exactly two situations —
nothing paid, or all of it paid — and it is written at the moment a job ends.

Neither matches how these jobs are actually paid for. A deposit up front and the
balance on completion is the ordinary arrangement, and the deposit arrives at the
_start_, which is the one period the close-out record cannot describe. There was
nowhere to put it, so contractors had nowhere to record half their money and
customers were shown none of it: `src/routes/customer/orders/[id]/` referenced no
figure at all, while `Deposit Pending` sat in the status line as a demand with no
amount attached.

Two shapes were considered. Adding `deposit_amount_cents` / `deposit_paid_at`
beside the existing columns is smaller, but it hard-codes _two_ payments: a third
instalment, a correction, or a refund each need another migration, and an invoice
built from fixed columns cannot itemise.

## Decision

**A `payment` table.** One row per payment, carrying an amount in whole cents, a
kind (`deposit` / `progress` / `final`), a method, an optional note, and the date
the money changed hands — which is the contractor's to state, and is not the date
the row was written.

**`order.final_amount_cents` becomes the job's TOTAL**, settable from the moment a
quote is agreed rather than only at close-out. Half of an unknown total is not a
number, so a deposit needs the total to exist first.

**The balance is never stored.** `invoiceSummary(order, payments)` in
`src/lib/invoice.ts` subtracts, and every surface reads that one result: the
contractor's Invoice card, the customer's portal, and the emailed invoice. The
same module renders the invoice's HTML and text, so `composeInvoiceEmail` is the
only thing that builds the document and `/contractor/orders/[id]/invoice` serves
byte-identical output to what is sent.

**`order.paid_at` and `order.payment_method` are superseded**, no longer read or
written. Migration 0029 copies every order that had `paid_at` into a `final`
payment row. The columns stay, matching the precedent set by `expected_at`:
dropping them is a separate decision from stopping using them.

ADR-0010's rule is untouched. The app still **records** money and never processes
it: no card entry, no Connect, no payout, and no control on the portal that could
be mistaken for one.

## Consequences

- `CONTEXT.md`'s "Payments" ambiguity — "this product only ever tracks [money] as
  a status" — was already too strong after ADR-0010 and is now plainly wrong. It
  and a new **Payment** / **Invoice** entry are updated in the same change.
- "Mark final payment received" at close-out now records what is **outstanding**,
  not the total. On a job with a deposit, stamping the total would count the
  deposit twice — which is what the single-payment version would have done the
  moment deposits existed.
- Kind is a label and nothing else. The arithmetic never branches on it, so a
  mislabelled row changes one line of wording and never changes what someone owes.
- An overpayment is reported as a negative balance rather than clamped at zero: a
  refund the contractor owes is exactly the thing that must not be rounded away.
- A refund is a negative amount, not a second concept, so the balance stays one
  sum.
- Deleting a payment leaves the original timeline entry standing and adds a
  reversal beside it. A customer who was told their deposit landed must not find
  that line quietly gone.
- The customer is now shown their own money unconditionally. This is a real
  change in what the portal discloses, and it is deliberate: a balance is not a
  contractor-only fact.
