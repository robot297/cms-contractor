# A Lapsed Contractor's Customers and Subcontractors keep full portal access

When a Contractor's **Trial** ends or their payment fails, the Contractor drops to read-only — but their
**Customers** and assigned **Subcontractors** notice nothing. Sam still opens his portal, still reads his
timeline, still sends a request; a Trusted Subcontractor still posts notes and job photos to an assigned
Order. The billing gate is scoped to writes performed *by the Contractor*, never to the portals hanging
off their account.

## Context / trade-off

Freezing the whole tenant is the tidier model and the stronger lever: when Dana's customers start calling
to ask why the portal is dead, Dana pays. We rejected it because the thing we sell Dana is a reputation
with her customers — [BUSINESS_PROPOSAL.md](../../BUSINESS_PROPOSAL.md) names "reputation protection" as
the primary value. A paywall that makes Dana look unreliable to Sam destroys the product's promise at the
exact moment we're asking her to trust us with a card, and Sam never agreed to our billing terms in the
first place. He was invited; he cannot pay to fix it; he is not a party to the transaction.

Read-only lockout on the Contractor was chosen over a hard paywall for the same reason: Dana's data stays
visible and unhostaged, so the upgrade prompt reads as an invitation rather than a ransom.

## Consequences

- Portal load paths (`/customer`, `/subcontractor`) must **not** consult the Subscription at all. A guard
  added there "for consistency" is a regression, not a tidy-up.
- Customer-portal writes (requests) and Subcontractor write-backs (timeline notes, photos) continue to
  land on a Lapsed Contractor's Orders. Their timelines keep moving while they cannot answer — which is
  the pressure we're comfortable applying, because it's felt by Dana and not by Sam.
- Sending an **Invite** *is* a Contractor write and stops. A Lapsed Contractor grows no new portals; the
  existing ones are untouched.
- The gate therefore lives at the point of each contractor-side mutation, not in a single guard on
  `/contractor`. Enforcement is per-write and must be applied to new contractor actions as they are added.
