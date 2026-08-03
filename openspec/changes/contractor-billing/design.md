## Context

The app has no billing of any kind: no Stripe dependency, no subscription table, no billing env vars. A contractor signs up through `login/+page.server.ts` (`signUp` action, hard-coded `role: 'contractor'`, or GitHub OAuth via `signInSocial`) and immediately has unlimited use of everything. `/pricing` ships a `tiers` array with `price: 'TBD'`.

Three existing patterns constrain the design more than Stripe does:

- **`contractor/+layout.server.ts` guards the whole contractor section** and lazily provisions per-contractor state (`ensureStarterTemplates`) on every load. That is the natural place to provision a Subscription too — and, per [ADR-0005](../../../docs/adr/0005-lapsing-never-reaches-customers.md), it is emphatically _not_ the place to block Lapsed contractors, because they must still be able to read.
- **[ADR-0004](../../../docs/adr/0004-derive-guide-progress-from-domain-data.md)**: derive from domain data, store only what is irreducible. Cap usage is a `COUNT(*)`; storing counters would let them disagree with reality.
- **`auth.schema.ts` is generated** by `pnpm auth:schema`. Hand-added columns there are lost on regeneration, so subscription state lives in its own table in `schema.ts`, keyed on `contractorId`, exactly as `contractor_settings` does.

## Goals / Non-Goals

**Goals:**

- Every Contractor has exactly one Subscription, always, with no code path that can observe its absence.
- Gating decisions are made from local Postgres state only — no Stripe call on any contractor page load.
- A Lapsed Contractor loses writes and nothing else; their Customers and Subcontractors are provably unaffected.
- Trial Limits are computed from live rows, so archiving frees capacity with no bookkeeping.
- The smallest possible payment surface: no card data, no billing UI beyond two redirect buttons.

**Non-Goals:**

- Multi-seat companies, seat invites, or an owner role. Pricing is per Contractor so this is additive later.
- Any feature gating. Limits are volume-only, and paid is unlimited — there is nothing to flag.
- A permanent free tier, in-app invoices, custom dunning, or proration logic.
- Tracking money between a Contractor and their own Customer. `Deposit Pending` / `Final Payment Pending` stay status labels.

## Decisions

### The local `subscription` row is authoritative for gating; Stripe is authoritative for money

A `subscription` table keyed on `contractorId` holds `status`, `trialEndsAt`, `currentPeriodEnd`, `stripeCustomerId`, `stripeSubscriptionId`. Every gate reads this one indexed row. Stripe webhooks are the only writer of paid state.

_Alternative rejected — query Stripe per request (cached):_ zero drift, but it puts Stripe's latency and uptime in front of every contractor page load and burns rate limit on our own dashboard traffic. A Stripe incident would become an outage of a CRM that has nothing to do with payments at that moment.

_Alternative rejected — no webhooks, nightly reconcile:_ ships faster, but involuntary churn (a card failing on day 40) stays invisible for up to 24h, and Stripe's own retry timeline is exactly the signal we need.

### No `plan` column

Per [ADR-0006](../../../docs/adr/0006-one-plan-priced-per-contractor.md) there is one thing to buy. A `plan` column would exist only to be branched on, and the first branch would reintroduce the plan matrix we deliberately deleted. `status` plus `trialEndsAt` is the entire model. Monthly vs annual is a Stripe price choice that the app never reads back.

### Lapse is derived at read time, not written by a scheduler

`status = 'trialing'` with `trialEndsAt` in the past _is_ Lapsed. A pure function decides:

```
subscriptionAccess(sub, now) -> { canWrite, reason }
  comped                              -> canWrite
  active                              -> canWrite
  past_due                            -> canWrite   (grace; Stripe is still retrying)
  trialing && now < trialEndsAt       -> canWrite, trial limits apply
  trialing && now >= trialEndsAt      -> blocked, reason 'trial-ended'
  lapsed / canceled                   -> blocked, reason 'subscription-ended'
```

No cron, no job runner (there is none in the stack), and no window in which the database says "trialing" but the truth is otherwise. `past_due` deliberately keeps writing: Stripe retries for weeks, and locking a paying contractor out over a temporarily declined card would do the reputational damage [ADR-0005](../../../docs/adr/0005-lapsing-never-reaches-customers.md) exists to prevent. Stripe moves them to `canceled` when it gives up, and that lapses them.

_Alternative rejected — a scheduled job flipping rows to `lapsed`:_ needs infrastructure the project doesn't have, and creates a period where the stored status is stale.

### Provisioning is lazy, in the contractor layout, and self-comping for pre-existing accounts

`ensureSubscription(contractorId, userCreatedAt)` runs in `contractor/+layout.server.ts` beside `ensureStarterTemplates`. If no row exists it inserts one: `comped` if the user was created before the `BILLING_LAUNCHED_AT` constant, otherwise `trialing` with `trialEndsAt = now + 14d`.

This covers the GitHub OAuth signup path — which never runs the `signUp` action and so cannot be hooked there — plus anything the backfill migration missed, with one code path. It reuses a provisioning pattern already proven in this file.

_Alternative rejected — insert on signup only:_ misses OAuth, and any gap between the migration and a deploy leaves a contractor with no row and therefore no defined behaviour.

### Enforcement is per-write, never a section guard

`assertCanWrite(locals)` throws a typed `SubscriptionBlocked` error; contractor form actions catch it and return `fail(402, { blocked })`. `assertUnderLimit(contractorId, 'customer' | 'order' | 'subcontractor')` runs additionally on the three creating functions: `createCustomer`, `createOrder`, `createSubcontractor`.

A single guard in `contractor/+layout.server.ts` would be one line instead of dozens — and would break the whole design, because a Lapsed contractor must still load every read surface. The cost is that a new contractor write added later can forget the guard. Mitigated below.

Limits gate **creation only**, matching the one rule that runs through the whole change: _block creation, never touch what exists._ A Contractor who somehow exceeds a limit keeps every record fully editable.

### Portal paths are audited to have no subscription check at all

`src/routes/customer/**`, `src/routes/subcontractor/**`, `getCustomerPortal`, `addCustomerRequest`, `subcontractorOrderView`, `addSubcontractorNote`, `addSubcontractorAttachment` take no subscription dependency. This is a requirement, not an omission, and is stated in the spec so it survives a future tidy-up.

### Stripe surface: two redirects and one webhook

`/contractor/billing` posts to create a Checkout Session (price from env, `client_reference_id = contractorId`) or a Billing Portal session. `/api/stripe/webhook` verifies the signature against the raw body and reduces `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed` into the local row. Handling is idempotent — every event is reduced to an absolute desired state keyed by `stripeSubscriptionId`, never an increment — so Stripe's at-least-once delivery and out-of-order retries are harmless.

The Stripe Customer is created at first Checkout, not at signup, so a trial that never converts leaves no Stripe record and no vendor cost.

## Risks / Trade-offs

- **A future contractor write path forgets `assertCanWrite`** → The guard lives in one exported helper, and a test enumerates every `export const actions` under `src/routes/contractor/**` asserting each mutating action references it. Cheap, and it fails loudly when someone adds a route.
- **Local row drifts from Stripe** (missed or failed webhook) → `/contractor/billing` reconciles against Stripe on load, and the Billing Portal return URL points there, so the surface where drift is visible is the surface that repairs it. Drift can only ever over-grant briefly, never over-block.
- **Webhook route needs the raw body, but `hooks.server.ts` wraps everything in `svelteKitHandler`** → Verify the signature inside the route handler from `await request.text()` before any parsing; confirm during implementation that the better-auth handler passes non-auth paths through untouched (it should — it only claims `/api/auth/*`).
- **Backfill misclassifies an existing contractor as a trialist** → The migration comps by `user.createdAt < BILLING_LAUNCHED_AT`, and `ensureSubscription` applies the same rule, so the two cannot disagree. Verify the comped count against the real contractor count before deploying.
- **Demo Mode re-seeds and could reset billing state** → `prepareDemoSession` provisions `DEMO_CONTRACTOR` as `comped`; the demo re-seed must not delete or recreate its subscription row.
- **Trial limits set too generously to convert** (25 customers is a lot of real work for a solo contractor) → They are constants in `src/lib/crm.ts`, changeable in one commit; the price is a Stripe object changeable with no deploy at all.
- **Lapsed contractors' timelines keep moving underneath them** — customers and subs can still write to Orders the Contractor cannot answer. Accepted deliberately: the pressure lands on the person who owes money, which is the whole point of [ADR-0005](../../../docs/adr/0005-lapsing-never-reaches-customers.md).
- **402 is an unusual status for a form action** → It is semantically right (Payment Required) and never reaches a browser as a bare error; actions return it as `fail`, which SvelteKit renders through the normal form-error path.

## Migration Plan

1. Add `subscription` to `schema.ts`; `pnpm db:generate`.
2. Hand-edit the generated migration to append the backfill: insert a `comped`, `trialEndsAt NULL` row for every existing `user` with `role = 'contractor'`. Idempotent (`ON CONFLICT DO NOTHING`) so re-running is safe.
3. Set `BILLING_LAUNCHED_AT` to the deploy timestamp before shipping — this is the line between comped and trialing.
4. Deploy with Stripe env vars set but the pricing page still live; the app runs correctly with zero contractors on a paid subscription.
5. Register the webhook endpoint in Stripe and confirm delivery against a test-mode subscription before announcing.

**Rollback:** the feature degrades safely by comping everyone — set `BILLING_LAUNCHED_AT` far in the future and `ensureSubscription` comps all new signups too, restoring pre-change behaviour without dropping the table or losing paid subscriptions.

## Open Questions

- Do we send trial-ending email at day 11? There is no outbound email infrastructure in the app today (notifications are in-app only), so the trial currently ends silently apart from the in-app countdown. Worth resolving before launch, likely as its own change.
- Stripe Tax on or off at launch? Off is simplest and correct for a US-only start; turning it on later changes prices customers see.
