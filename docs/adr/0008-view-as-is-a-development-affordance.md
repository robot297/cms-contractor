# View-as is a development affordance, not an admin feature

The Customer **Portal** is reachable in development two ways: `SEED_DEV_LOGIN` provisions a real Customer
login (`customer@upliftcollective.dev`) already linked to a Customer record with a job on it, and — where
`CUSTOMER_PORTAL_DEV_TOOLS=true` — a Contractor can jump into that same Portal from their own session
without signing out. The second is impersonation, and it is read-only. It exists so the customer-facing
half of the product is reachable while being built. It is not support tooling, and it must not quietly
become support tooling.

## Context / trade-off

Every other surface is one dev login away. The Customer Portal was not: seeing it meant holding a
Customer-role **User** bound by `userId` to a real Customer record, which is a sign-out, a sign-in and
some seeding per look. That friction is the honest reason the portal stayed the least finished thing we
ship — nobody looks at what is inconvenient to look at.

We built **both** halves of the answer rather than choosing between them, because they fix different
things. The seeded login gives full fidelity — real auth, real session, a real Customer-role User — and is
what you want when the question is "does the actual sign-in path work". The switch removes the round trip,
and is what you want when the question is "does this render right", which is most of the time. They share
one seeded Customer, so the two paths always show the same portal and cannot disagree.

The switch is deliberately **one button, not a Customer picker**. An earlier draft listed every Customer
the Contractor owned; choosing among ninety seeded records is not a thing anyone wanted to do, and a
general "impersonate any customer" control is precisely the shape this ADR is trying not to grow. Pointing
it at a single known dev record keeps it a development affordance by construction rather than by policy.

Impersonation is a genuinely dangerous primitive, so the design gives up capability to stay safe:

- **The role is never mutated.** A User holds exactly one global role ([ADR-0002](0002-one-role-per-user.md)).
  Faking a Customer by writing `session.user.role` would corrupt that invariant inside the session store,
  where it could outlive the request that set it. Instead `locals.viewAs` sits _beside_ `locals.user`, and
  only the portal's own loaders consult it.
- **Ownership is re-read every request**, never trusted from the cookie, so a Customer archived or
  reassigned mid-session drops out immediately.
- **Every write is refused.** A message stored in this view would claim a Customer said something they did
  not. The composer stays visible and disabled with the reason on it, so the affordance is still
  reviewable — it just cannot write.
- **Flag off clears the cookie** rather than ignoring it. A build shipped with the flag off behaves as
  though the feature was never there, including for a browser holding a stale selection.
- **Refusals are 404, not 403.** A 403 confirms the route exists on this deployment; a 404 does not.

## Amendment: the seeded-login swap

The two entry points above were later joined by a third control that reaches both from one place — a
switcher in the bar on **both** sides, which also lands on the same Order where the destination can see
it. Comparing the two halves of one job was the actual task, and doing it meant a sign-out, a sign-in and
finding the order again.

Reaching the seeded login without the round trip needs an endpoint that establishes a session for an
account other than the one signed in, which is the shape this ADR spends its length being careful about.
It is acceptable here only because of what it cannot do:

- **The target is an enum, not an identifier.** `POST /dev/sign-in-as` takes `as=contractor|customer` and
  nothing else. There is no input in which a third account could be named, so it cannot be pointed at a
  real user by crafting a request — which is the difference between this and an impersonation primitive.
- **It signs in, it does not forge.** It calls the ordinary `signInEmail` path with the seeded password and
  forwards Better Auth's own `Set-Cookie`. The resulting session is byte-for-byte the one you get by
  typing those (public, hard-coded) credentials into the login form. It grants nothing that knowing the
  password does not already grant.
- **It requires both flags.** `SEED_DEV_LOGIN`, because without it the accounts do not exist, and
  `CUSTOMER_PORTAL_DEV_TOOLS`, so the whole affordance dies by one switch.
- **It clears the view-as cookie.** Being signed in as the customer while also impersonating them is a
  state with no meaning, and the portal would resolve its subject from the cookie rather than the session.

The distinction the two halves preserve is the reason for having both: **view-as** is instant and refuses
every write, so it answers "does this render right"; **sign-in-as** is a real session with writes enabled,
so it answers "does the customer's own path actually work". Neither substitutes for the other, and the
read-only property of view-as is not weakened by the existence of its sibling.

The production argument is unchanged and still rests on the flags: with them off, both routes 404 and the
switcher is absent from the DOM. What is new is that a deployment which enabled both flags **and** ran the
seeder would hand any visitor a contractor session. That was already true of the login page and the
published password; this makes it one request instead of one form submission. It is not a new capability,
but it is a shorter path to the same one, and it is the reason `SEED_DEV_LOGIN` must stay as unset in
production as it always was.

## Consequences

- The realistic damage of the flag leaking to production is a confusing UI, not a breach: the switch only
  targets a seeded record that a production database does not have, the underlying guard still refuses any
  Customer the signed-in Contractor does not own, and nothing can be written. That is the property that
  makes the flag acceptable to have at all — it is not a reason to enable it.
- `SEED_DEV_LOGIN` now provisions a Customer as well as a Contractor, so it writes Customer, Order and
  Timeline rows and no longer only touches `user` / `account`. It stays idempotent and reseeds a Timeline
  only when empty, so a portal you have been messing with keeps its history across restarts. It must
  remain as unset in production as it always was.
- The two entry points must keep pointing at the same seeded Customer. `findDevCustomer` looks it up by
  `DEV_CUSTOMER_LOGIN.email`, so that constant is the join between them — changing it in one place
  silently decouples the switch from the login.
- `resolveViewAs` is the single choke point. Any new portal surface must resolve its subject through the
  same `PortalSubject`, not by reading the cookie itself.
- Any new write on a portal surface must check the impersonated view and refuse. This is enforced by
  review, not by the type system — the gap to watch.
- **Turning this into an admin or support feature requires its own change**, and a different design. Real
  support impersonation needs an audit trail of who viewed whose account and when, an explicit consent or
  legal basis for viewing a customer's data, a scope that is not "any customer of the signed-in
  contractor", and an expiry that is not a dev cookie. None of that is here, and none of it should be
  bolted on by relaxing this flag.
