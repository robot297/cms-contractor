# 10. Record a final payment, never process it

Date: 2026-08-18

## Status

Accepted

## Context

Until now the product modelled no money at a job level at all. Payment existed
only as two order *states* (`Deposit Pending`, `Final Payment Pending`) and as a
message topic, and `CONTEXT.md` stated the principle plainly:

> The only money this product moves is a Contractor's Subscription.

That principle is about *moving* money — taking a card, holding funds, paying out.
It says nothing about *recording* what happened offline, and the gap showed:
completing a job dropped the contractor straight to "Work Complete" with nowhere to
note the final invoice total or that the customer had paid. Contractors close jobs
out; the app had no place for the one fact that makes a job closed.

## Decision

The contractor's **complete-order** flow records a final invoice and payment on the
order: a total (`final_amount_cents`), free-form details (`final_notes`), how the
customer paid (`payment_method` — cash / check / card / other), and whether it was
received (`paid_at`). It can also email the invoice to the customer, reusing the
existing send/render/record chain.

Crucially, the app still **never processes** a payment. There is no card entry, no
Stripe Connect, no payout — the contractor keys in figures for money that changed
hands outside the app. This is bookkeeping, not a payment rail. The `Deposit
Pending` / `Final Payment Pending` states remain what they were; this only adds a
record at close-out.

Cancelling an order takes no money at all — just a reason (kept internal) and an
optional heads-up to the customer.

## Consequences

- `CONTEXT.md`'s "only money is the subscription" line is now too strong and should
  read that the app *records but never processes* customer payment.
- New nullable columns on `order`; existing rows are simply unrecorded (all null),
  which reads correctly as "no close-out figures captured".
- If real customer payments are ever wanted, they build on top of this record
  rather than replacing it — the amounts are already here; a rail would fill in
  `paid_at` itself instead of the contractor.
- Complete/Cancel are no longer offered in the status dropdown; they are a
  dedicated full-screen flow, because each now carries more than a state change.
