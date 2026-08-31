# Parallel Subcontractor Invite, not a generalized Invite

The **Subcontractor Invite** is a separate mechanism (its own table + binding path) that *mirrors* the customer Invite's token-binding, rather than generalizing the existing `customer_invite` into one polymorphic invite that targets either a Customer or a Subcontractor.

## Context / trade-off

DRY instinct says: one `invite` table with a `targetType` discriminator and a single binding path. But ADR-0001 established that the customer Invite's token-binding is *load-bearing identity plumbing* — it exists specifically to avoid the silent-empty-portal bug when a User authenticates via OAuth under a different email. Generalizing means refactoring that exact path, so a bug in the shared binding now breaks the (working, shipped) customer flow as well as the new one.

We chose a parallel `subcontractor_invite` table and a sibling binding function that reuse the *pattern* (bind by token, email fallback, single-link guard) without touching the customer path. The cost is some duplication between the two invite flows; the benefit is that the proven customer flow is untouched and the two can diverge (a Subcontractor Invite also sets the sub's **Tier** context, which a Customer Invite has no notion of).

## Consequences

- Two invite tables/flows exist by design. A future reader wondering "why not one polymorphic invite?" should read this before consolidating — consolidation re-opens ADR-0001's blast radius.
- The Subcontractor binding must independently honor the same rules: token first, email fallback, and the single-role guard from [ADR-0002](0002-one-role-per-user.md).
- If the two flows drift far enough that duplication hurts more than the coupling risk, revisit — but only with the customer flow's regression coverage in place first.
