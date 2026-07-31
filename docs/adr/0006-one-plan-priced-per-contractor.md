# One paid plan, priced per Contractor — no pricing tiers

There is exactly one thing to buy: a **Subscription** at $29 per Contractor per month (or $290/year),
unlimited in every dimension. **Trial Limits** exist only to make the 14-day Trial finite; the moment a
Contractor pays, all counting stops. A firm scales by buying more Contractor logins, not by moving up a
ladder of plans.

## Context / trade-off

`src/routes/pricing/+page.svelte` shipped three placeholder tiers (Solo / Crew / Contractor Pro) split by
feature — Subcontractors gated to Crew, email templates to Pro. Building that out means owning, forever:
upgrade and downgrade flows, proration, plan-comparison UI, feature flags on capabilities that are
currently unconditional (`ensureStarterTemplates` runs for every contractor on every contractor page
load), and an answer to "what happens to a Crew contractor's six Subcontractors when they downgrade to
Solo?"

We took none of it. A single per-Contractor price gives a solo tradesperson the cheapest possible entry —
the stated goal — while scaling linearly for a firm, and it deletes every one of those problems rather
than solving them. The cost is that we cannot price-discriminate: a Contractor running 500 Customers pays
the same as one running 5. We accept that, on the bet that for this product the axis that actually
correlates with value is *how many contractors are working*, not how many rows they hold.

The choice of "Tier" as a pricing word was also rejected: [CONTEXT.md](../../CONTEXT.md) already binds
**Tier** to Subcontractor access (Trusted vs Guest), and one word cannot mean two things.

## Consequences

- The `tiers` array in `pricing/+page.svelte` is deleted, not renamed. The page sells one price.
- No code should branch on "which plan" — only on *is this Subscription live*. A `plan` column that
  invites such branching should not exist; status plus `trialEndsAt` is the whole model.
- Multi-seat companies (one bill, several Contractor logins) are deliberately deferred. Because pricing is
  already expressed per Contractor, adding seats later is a Stripe `quantity` change plus a seat-invite
  flow — no repricing and no migration. Note that a seat invite would be the *third* parallel invite
  mechanism, which is the reconsideration point [ADR-0003](0003-parallel-subcontractor-invite.md) named.
- Price lives in Stripe, not in code. Changing $29 must not require a deploy.
