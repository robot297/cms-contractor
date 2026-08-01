## 1. Domain Rules (no database, fully unit-testable)

- [x] 1.1 Add `TRIAL_LIMITS` to `src/lib/crm.ts`: 25 active Customers, 25 active Orders, 3 active Subcontractors, plus `TRIAL_DAYS = 14`.
- [x] 1.2 Add `SUBSCRIPTION_STATUSES` (`trialing | active | past_due | lapsed | comped`) and a Zod schema for them.
- [x] 1.3 Implement pure `subscriptionAccess(sub, now)` returning `{ canWrite, reason, trialDaysRemaining }` per the design's table — `past_due` writes, expired `trialing` does not.
- [x] 1.4 Implement pure `limitStatus(usage, limits)` returning per-record-type `{ used, limit, atLimit }`.
- [x] 1.5 Add `BILLING_LAUNCHED_AT` constant (the deploy timestamp) with a comment explaining it is the comped/trialing dividing line.
- [x] 1.6 Unit-test 1.3 and 1.4 in `src/lib/crm.test.ts`, covering each status, the exact trial-expiry boundary, and `past_due` still writing.

## 2. Data Model

- [x] 2.1 Add the `subscription` table to `src/lib/server/db/schema.ts`: `contractorId` primary key referencing `user.id` with cascade delete, `status`, `trialEndsAt`, `currentPeriodEnd`, `stripeCustomerId`, `stripeSubscriptionId`, `createdAt`, `updatedAt`. Deliberately **no** `plan` column — comment why, citing ADR-0006.
- [x] 2.2 Add a unique index on `stripeSubscriptionId` so webhook reduction can key on it.
- [x] 2.3 Add the `subscriptionRelations` one-to-one to `user`.
- [x] 2.4 Run `pnpm db:generate`, then hand-append the backfill to the generated migration: insert a `comped` row with `trialEndsAt NULL` for every `user` with `role = 'contractor'`, using `ON CONFLICT DO NOTHING`.
- [x] 2.5 Apply against the local `contractor-crm` database and confirm the comped row count equals the existing contractor count.

## 3. Billing Server Module

- [x] 3.1 Create `src/lib/server/billing.server.ts`.
- [x] 3.2 Implement `ensureSubscription(contractorId, userCreatedAt)` — insert if absent, `comped` when `userCreatedAt < BILLING_LAUNCHED_AT`, otherwise `trialing` with `trialEndsAt = now + 14d`. Idempotent.
- [x] 3.3 Implement `getSubscriptionView(contractorId)` returning the row plus `subscriptionAccess(...)` applied, for layout and billing surfaces.
- [x] 3.4 Implement `countActiveUsage(contractorId)` — live `COUNT(*)` of non-archived Customers, non-deleted Orders, non-archived Subcontractors. No stored counters (ADR-0004).
- [x] 3.5 Implement `assertCanWrite(contractorId)` throwing a typed `SubscriptionBlocked` error carrying a reason code.
- [x] 3.6 Implement `assertUnderLimit(contractorId, kind)` throwing `LimitReached` with used/limit, applied to creation only.
- [x] 3.7 Export a `blockedFail(err)` helper mapping both errors to `fail(402, { blocked: … })` for form actions.

## 4. Provisioning

- [x] 4.1 Call `ensureSubscription` in `src/routes/contractor/+layout.server.ts` alongside `ensureStarterTemplates`, and return subscription + usage to the layout.
- [x] 4.2 Confirm the GitHub OAuth signup path reaches this and is provisioned on first contractor page load.
- [x] 4.3 Provision `DEMO_CONTRACTOR` as `comped` in `src/lib/server/demo.server.ts`, and make sure the demo re-seed never deletes or recreates its subscription row.
- [x] 4.4 Add a comped contractor to `scripts/seed.mjs` fixtures.

## 5. Write Enforcement (per-write, never a section guard — ADR-0005)

- [x] 5.1 Add `assertCanWrite` to every mutating function in `src/lib/server/crm.server.ts`: `createCustomer`, `editCustomer`, `archiveCustomer`, `setCustomerAvatar`, `createOrder`, `setFollowUp`, `setOrderIcon`, `snoozeFollowUp`, `updateOrderState`, `addAttachment`, `deleteAttachment`, `addOrderNote`, `deleteOrder`, `createInvite`, `resendInvite`, `revokeInvite`, `deleteInvite`.
- [x] 5.2 Add `assertCanWrite` to the contractor-side mutators in `src/lib/server/subcontractor.server.ts`: `createSubcontractor`, `editSubcontractor`, `archiveSubcontractor`, `setSubcontractorTier`, `setSubcontractorAvatar`, `createSubcontractorInvite`, `resendSubcontractorInvite`, `revokeSubcontractorInvite`, `assignSubcontractor`, `unassignSubcontractor`.
- [x] 5.3 Add `assertCanWrite` to `createEmailTemplate`, `updateEmailTemplate`, `deleteEmailTemplate`, `reorderEmailTemplates`, `saveContractorSettings` in `templates.server.ts`. Leave `ensureStarterTemplates` unguarded — it is provisioning, not a contractor write.
- [x] 5.4 Add `assertUnderLimit` to exactly three functions: `createCustomer`, `createOrder`, `createSubcontractor`.
- [x] 5.5 Verify **no** guard is added to `getCustomerPortal`, `addCustomerRequest`, `bindInviteToken`, `bindCustomerByEmail`, `subcontractorOrderView`, `addSubcontractorNote`, `addSubcontractorAttachment`, `bindSubcontractorInviteToken`, `bindSubcontractorByEmail`, or `markNotificationRead` — required by ADR-0005, not an oversight.
- [x] 5.6 Catch the typed errors in every contractor form action and return `blockedFail(err)`.
- [x] 5.7 Add a guard-coverage test that walks `src/routes/contractor/**` for `export const actions` and asserts each mutating action reaches `assertCanWrite`, so a future route cannot silently skip the gate.

## 6. Stripe Integration

- [x] 6.1 Add the `stripe` package with pnpm.
- [x] 6.2 Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` to `.env.schema` with varlock annotations (`@sensitive` on the key and webhook secret) and regenerate `env.d.ts`.
- [ ] 6.3 Create the Stripe product and the two recurring prices ($29/month, $290/year) in test mode; record the price IDs.
- [x] 6.4 Implement `createCheckoutSession(contractorId, interval)` — creates the Stripe Customer on first checkout only, sets `client_reference_id`, success/cancel URLs back to `/contractor/billing`.
- [x] 6.5 Implement `createPortalSession(contractorId)` with the return URL at `/contractor/billing`.
- [x] 6.6 Implement `reconcileFromStripe(contractorId)` for the billing page load, repairing drift from a missed webhook.

## 7. Webhook Endpoint

- [x] 7.1 Create `src/routes/api/stripe/webhook/+server.ts`; read the raw body via `request.text()` and verify the signature before parsing anything.
- [x] 7.2 Confirm `svelteKitHandler` in `hooks.server.ts` passes this path through untouched and the raw body survives.
- [x] 7.3 Reduce `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` into absolute desired state keyed on `stripeSubscriptionId` — never an increment, so repeats and out-of-order delivery converge.
- [x] 7.4 Map provider states: active/trialing → `active`; past_due/unpaid → `past_due`; canceled/incomplete_expired → `lapsed`.
- [x] 7.5 Return 200 on already-applied events and a non-2xx only on genuine failure, so Stripe retries only what needs retrying.
- [ ] 7.6 Test with the Stripe CLI: subscribe, fail a payment, cancel, and replay one event twice to prove idempotency.

## 8. Contractor Surfaces

- [x] 8.1 Build `/contractor/billing`: current status, trial countdown or renewal date, usage against Trial Limits, monthly/annual subscribe buttons, and Manage Billing for paid contractors. Reconcile against Stripe on load.
- [x] 8.2 Ensure `/contractor/billing` is reachable and fully functional for a Lapsed Contractor — it is the one contractor surface that must never be blocked.
- [x] 8.3 Add a trial countdown and a Lapsed banner to `src/routes/contractor/+layout.svelte`, plus a Billing entry in the contractor nav.
- [x] 8.4 Render the 402 refusal consistently wherever a contractor write is blocked, with a link to `/contractor/billing`.
- [x] 8.5 Show at-limit state on the create affordances for Customers, Orders, and Subcontractors, naming archiving as the way to free capacity.
- [ ] 8.6 Confirm dark-theme styling for the new banner and billing surfaces, watching the `[data-theme='dark'] .btn` specificity trap.

## 9. Public Pricing Page

- [x] 9.1 Delete the `tiers` array from `src/routes/pricing/+page.svelte` outright (ADR-0006) and replace it with one Subscription and a monthly/annual toggle.
- [x] 9.2 State the 14-day Trial honestly: no card required, every feature, limited only to 25 Customers / 25 Orders / 3 Subcontractors.
- [x] 9.3 Point the CTA at sign-up, keeping the existing back-link and theme toggle.

## 10. Verification

- [x] 10.1 End-to-end: sign up → confirm trial → hit a limit → archive → confirm capacity freed.
- [x] 10.2 Force a trial to expire by backdating `trialEndsAt`; confirm every read still works and every contractor write is refused.
- [x] 10.3 With that contractor Lapsed, confirm their Customer's portal is fully working — status, timeline, history, and sending a request.
- [x] 10.4 With that contractor Lapsed, confirm a Trusted Subcontractor can still post a timeline note and upload a photo to an assigned Order.
- [ ] 10.5 Subscribe through test-mode Checkout; confirm writes restore and limits lift with no data recovery step.
- [ ] 10.6 Cancel via the Billing Portal; confirm the contractor lapses at period end with all data intact.
- [x] 10.7 Stop the Stripe API (bad key) and confirm every contractor surface still loads and gates from local state.
- [x] 10.8 Confirm Demo Mode still works after a re-seed and is never blocked by billing.
- [x] 10.9 Run `pnpm check`, `pnpm lint`, `pnpm test`.

## 11. Documentation

- [x] 11.1 Correct `BUSINESS_PROPOSAL.md`, which lists payments under "Deliberately Deferred" — scope it to _customer_ payments (invoicing/accounting), which remain deferred, and record that Subscription billing now exists.
- [x] 11.2 Note the Stripe env vars and webhook setup in `README.md`.
- [x] 11.3 Set `BILLING_LAUNCHED_AT` to the real deploy timestamp before shipping.
