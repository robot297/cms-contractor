## Why

The product has no way to charge anyone. Contractors sign up, get everything forever, and `/pricing` ships three placeholder plans with `price: 'TBD'` — the landing CTA leads to a page that cannot sell. This change makes the CRM a business: every new Contractor gets a genuinely useful 14-day **Trial**, and after it a single, unlimited **Subscription** at $29 per Contractor per month.

## What Changes

- Introduce the **Subscription**: exactly one per Contractor, created at sign-up, never absent. Status is `trialing`, `active`, `past_due`, `lapsed`, or `comped`. Customers and Subcontractors never have one and are never billed.
- Introduce the **Trial**: 14 days, no card, starting automatically at sign-up. Every feature is available — only volume is capped by **Trial Limits** of 25 active Customers, 25 active Orders, and 3 active Subcontractors.
- Count Trial Limits over **active records only**, so archiving a Customer or deleting an Order frees capacity. Usage is always derived by counting real rows — never a stored counter (the [ADR-0004](../../../docs/adr/0004-derive-guide-progress-from-domain-data.md) rule).
- Introduce **Lapsed**: when the Trial ends or payment fails past recovery, the Contractor keeps full read access to everything they built and every write is refused behind an upgrade prompt. Nothing is deleted, hidden, or archived.
- **Lapsing never reaches Customers or Subcontractors.** Their portals keep working in full, including write-backs. Portal load paths must not consult the Subscription at all — see [ADR-0005](../../../docs/adr/0005-lapsing-never-reaches-customers.md).
- Take payment via **Stripe hosted Checkout** (subscribe) and the **Stripe Billing Portal** (card changes, invoices, cancellation). No card data, no billing UI, and no card form is built here.
- Keep the local `subscription` row authoritative for gating, synced by **Stripe webhooks**, so a Stripe outage is not an outage of the app and no contractor page load waits on Stripe.
- **BREAKING to `/pricing`**: delete the three-tier placeholder outright. One price, per Contractor, monthly ($29) or annual ($290 — two months free). Pricing levels do not exist as a concept — see [ADR-0006](../../../docs/adr/0006-one-plan-priced-per-contractor.md).
- Grandfather every Contractor who predates this change, and the Demo Mode contractor, to a **Comped** Subscription: permanently free, no Stripe record, never lapses.

Non-goals: multi-seat companies (one bill, several Contractor logins) — pricing is already expressed per Contractor, so seats are a later `quantity` change plus a seat-invite flow, with no repricing and no migration. Also out: feature gating of any kind (limits are volume-only), a permanent free tier, in-app invoice rendering, dunning email sequences beyond what Stripe sends, tax/VAT handling beyond Stripe Tax defaults, and any handling of the money that flows between a Contractor and their own Customer (the _Deposit Pending_ / _Final Payment Pending_ Order states remain status labels only).

## Capabilities

### New Capabilities
- `contractor-subscription`: The Subscription lifecycle — creation at sign-up, the 14-day Trial, Trial Limits measured over active records, the transition to Lapsed, Comped subscriptions, and the read-only enforcement rules including the explicit guarantee that Customer and Subcontractor portals are unaffected.
- `subscription-payments`: Taking money — the public pricing surface, Stripe hosted Checkout for subscribing, the Stripe Billing Portal for self-service management, and webhook-driven synchronisation of the local subscription row.

### Modified Capabilities
- `customer-relations`: Contractor-side write requirements (create/manage orders, publish status updates, attach invoices, quick state changes, send invites, message customers) become conditional on a live Subscription and, during the Trial, on remaining within Trial Limits. Customer-side requirements are explicitly **unchanged** and are restated as such so a future reader does not "fix" the asymmetry.

## Impact

- **Data model** (`src/lib/server/db/schema.ts`): new `subscription` table keyed on `contractorId` (status, `trialEndsAt`, `currentPeriodEnd`, `stripeCustomerId`, `stripeSubscriptionId`, timestamps). Per [ADR-0006](../../../docs/adr/0006-one-plan-priced-per-contractor.md) there is deliberately **no** `plan` column — status plus `trialEndsAt` is the whole model. New migration in `drizzle/`, including a backfill that comps every existing contractor.
- **Domain** (`src/lib/crm.ts`): `TRIAL_LIMITS` constants, a pure `subscriptionAccess(subscription, now)` returning whether writes are allowed and why, and a `limitStatus(usage, limits)` helper. Unit-testable without a database (`src/lib/crm.test.ts`).
- **Server** (new `src/lib/server/billing.server.ts`): `ensureSubscription(contractorId)`, derived usage counts, `assertCanWrite` / `assertUnderLimit` guards, Stripe Checkout + Portal session creation, and the webhook reducer.
- **Auth** (`src/routes/login/+page.server.ts`, `src/lib/server/auth.ts`): create the Subscription when a contractor signs up — including the GitHub OAuth path, which does not currently run through the `signUp` action.
- **Contractor surfaces**: every write path in `crm.server.ts`, `subcontractor.server.ts`, `templates.server.ts` and their form actions gains a subscription guard. Per [ADR-0005](../../../docs/adr/0005-lapsing-never-reaches-customers.md) this is per-write, **not** a single guard on `/contractor` — that layout still loads for Lapsed contractors so they can read.
- **Routes**: new `/contractor/billing` (status, subscribe, manage), new `/api/stripe/webhook`, rewritten `/pricing`. Trial countdown and Lapsed banner in `contractor/+layout.svelte`.
- **Untouched by design**: `src/routes/customer/**` and `src/routes/subcontractor/**` gain no subscription checks whatsoever.
- **Config**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` added to `.env.schema` via varlock.
- **Demo/seed** (`demo.server.ts`, `scripts/seed.mjs`): the demo contractor is comped so demos never expire.
- **Docs**: `CONTEXT.md` (done — Subscription / Trial / Trial Limit / Lapsed / Comped), [ADR-0005](../../../docs/adr/0005-lapsing-never-reaches-customers.md), [ADR-0006](../../../docs/adr/0006-one-plan-priced-per-contractor.md) (done). `BUSINESS_PROPOSAL.md` lists payments under "Deliberately Deferred" and needs correcting.
