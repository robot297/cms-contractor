# Bind invited Customers to Users by invite token, not email

When an invited Customer accepts their magic link and authenticates, we bind the resulting **User** to the specific **Customer** record via the **Invite's token**, not by matching the User's email to the Customer's email. Email matching is only a fallback for a User who signs in without a fresh invite link.

## Context / trade-off

The obvious approach is email matching (`linkCustomerByEmail`), and it's what the code started with. But a Customer can authenticate via OAuth (GitHub/Google) under a *different* email than the Contractor invited them at — in which case an email match silently fails and the Customer lands in an empty portal with no error. The magic-link token is the Contractor's explicit "this person is this Customer" assertion; honoring the token is robust to whatever identity the Customer logs in with.

## Consequences

- The invite token is load-bearing identity plumbing, not just an access gate — don't "simplify" binding back to pure email matching without reintroducing the silent-empty-portal bug.
- Guard: a **User may link to at most one Customer per Contractor**; accepting a token that would create a second link for the same (User, Contractor) is refused.
- Once a Customer is **Linked**, its email becomes read-only (it's backed by a real login). Editing an **Unlinked** Customer's email revokes any pending Invite so a stale magic link can't still bind.
