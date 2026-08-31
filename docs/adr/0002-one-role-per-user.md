# One role per User; refuse cross-role Invite collisions

A **User** holds exactly one global `role` — `contractor`, `customer`, or `subcontractor`. When a **Subcontractor Invite** would bind to a User that already has a different role (e.g. an existing **Customer**, or a **Contractor**), we refuse the binding with a clear message rather than letting one login carry multiple hats.

## Context / trade-off

A subcontractor is very often *also* a contractor (a small shop that subs for a bigger GC), or already a Customer of someone else — so the multi-hat scenario is real, not hypothetical. The tempting model is to let a single User be a Customer of Contractor A and a Subcontractor of Contractor B at once, deriving the "hat" per relationship.

We chose single-role for v1 because the codebase already treats `role` as a single global field that drives post-login routing (`hooks.server.ts`) and every access guard. Making a User multi-role means `role` becomes a set (or is derived per `(User, Contractor, kind)`), post-login must let the user *pick* a hat, and every `requireContractor` / portal guard has to disambiguate. That is a genuine auth refactor and touches the same binding path ADR-0001 warns is load-bearing. Refusing the collision keeps the Subcontractor feature additive and low-risk; the same real person can still participate under a second email.

## Consequences

- The `role` field stays a single value; the Subcontractor feature adds `'subcontractor'` as a third variant, not a set.
- Accepting a Subcontractor Invite whose email/token resolves to an existing User with a non-matching role is **refused** (mirrors the existing "a User may link to at most one Customer per Contractor" guard). Surface a clear, non-silent error — do not drop them into an empty portal.
- This is intentionally restrictive. Multi-hat Users are a deliberate future change, not an oversight — reversing this means the auth refactor above, so don't route around the guard piecemeal.
