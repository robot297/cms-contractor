# Contractor CRM

A lightweight platform where **Contractors** track their work and give their **Customers** visibility into project progress. This context covers the contractor-facing customer directory and the customer-facing portal.

## Language

**Contractor**:
The tradesperson or firm that logs in to track work and communicate status. Owns their own customer list.
_Avoid_: Vendor, provider.

**Customer**:
A contractor-scoped contact record that one Contractor tracks. Belongs to exactly one Contractor. Identified by email (`(contractorId, email)` unique). May link to at most one User account.
_Avoid_: Client (used loosely in older docs), buyer, contact-as-a-separate-thing.

**Linked / Unlinked Customer**:
A Customer is _Linked_ once someone accepts its Invite and a User binds to it; _Unlinked_ before that. An Unlinked Customer's email is editable (and editing revokes pending Invites); a Linked Customer's email is read-only.

**Archived Customer**:
A Customer whose state has been set to archived — removed from the Directory and "select existing" but never deleted; the record and its Orders are preserved. Archiving always updates state (reversible), never deletes, and is confirmed before it takes effect.

**User**:
A login identity (a `user` row / better-auth account) with a `role` of `contractor`, `customer`, or `subcontractor`. Distinct from a Customer or Subcontractor record. A User holds exactly one role globally: the same real person cannot be both a Customer and a Subcontractor (or a Contractor and a Subcontractor) under one login — an Invite that would create such a collision is refused. See [ADR-0002](docs/adr/0002-one-role-per-user.md).
_Avoid_: Account (ambiguous — could mean User or Customer or Subcontractor).

**Subcontractor**:
A contractor-scoped record for a trade partner the Contractor delegates work to. Belongs to exactly one Contractor and may Link to at most one User via a Subcontractor Invite — mirroring the Customer record↔User pattern (the same trade person under two Contractors = two Subcontractor records → one User). Carries a profile the Contractor administers (trade/specialty, contact, company, license #, insurance) and an access Tier. A Subcontractor is assigned to Orders to receive work.
_Avoid_: Vendor, crew, worker, contractor (a Subcontractor is a distinct record, not a Contractor User).

**Tier (Trusted Subcontractor / Guest Contractor)**:
An access level the primary Contractor assigns to each Subcontractor, gating both visibility and write access on assigned Orders. A **Trusted Subcontractor** sees the full Order (including the Customer's contact details + timeline) and may write back (timeline notes, job photos). A **Guest Contractor** sees work details only — project, type, status, work timeline — with the Customer's contact PII redacted, and is read-only. The Tier lives on the Subcontractor record and applies to all their assignments.
_Avoid_: Permission, role (role is a User concept; Tier is a Subcontractor-record concept).

**Subcontractor Invite**:
A magic/invite link a Contractor sends so a Subcontractor can access their portal, bound to the Subcontractor record by token (email is a fallback) — the same load-bearing binding as the customer Invite ([ADR-0001](docs/adr/0001-bind-customer-to-user-by-invite-token.md)), implemented as a parallel mechanism rather than by generalizing the customer Invite. See [ADR-0003](docs/adr/0003-parallel-subcontractor-invite.md).
_Avoid_: Signup, registration.

**Assignment**:
The link that puts a Subcontractor on an Order (many-to-many: an Order may have several assigned Subcontractors; a Subcontractor's portal lists the Orders assigned to them). Assignment is what makes an Order appear as a Subcontractor's "work".
_Avoid_: Dispatch, allocation.

**Invite**:
A magic/invite link a Contractor sends so a Customer can access their portal. The Contractor initiates it; Customers do not self-register.
_Avoid_: Signup, registration.

**Directory**:
A Contractor's private, searchable list of their own Customers, independent of whether any Order references them. Its ONLY source is Customers the Contractor created. "Select existing" means reusing one of your own repeat Customers on a new Order — never discovering another Contractor's Customers or self-registered accounts.

**Order**:
A unit of tracked work a Contractor performs for a Customer, with a lifecycle state and a timeline. Links to one Customer.
_Avoid_: Project (used in older business proposal), job, ticket.

**Subscription**:
A Contractor's billing standing. Every Contractor has exactly one, created the moment they sign up and never absent. Its status is `trialing`, `active`, `past_due`, `lapsed`, or `comped`. Only Contractors have one — Customers and Subcontractors arrive by Invite and never pay.
_Avoid_: Account (see Flagged ambiguities), plan, membership, licence.

**Trial**:
The first 14 days of a Subscription. Every feature is available; only the volume of records is capped by Trial Limits. Starts automatically at sign-up with no card, and needs no action to begin or to end.
_Avoid_: Free tier (there isn't one — the Trial ends), evaluation, demo (Demo Mode is a separate, seeded shared login).

**Trial Limit**:
The maximum number of _active_ Customers, Orders, or Subcontractors a Contractor may hold during their Trial. Counted over live records only, so Archiving a Customer or deleting an Order frees capacity. Limits exist only during the Trial — a paid Subscription is unlimited.
_Avoid_: Quota, cap-on-everything (Limits never restrict features, only counts).

**Lapsed**:
The state of a Contractor whose Trial ended or whose payment failed past recovery. They keep full read access to everything they built, and every write is refused behind an upgrade prompt. Lapsing never deletes, hides, or archives anything, and never reaches their Customers or Subcontractors.
_Avoid_: Suspended, disabled, expired, locked out (nothing is taken away).

**Comped**:
A Subscription granted permanently at no charge and with no Stripe record — held by the Contractors who predate billing and by the Demo Mode contractor. Behaves exactly like a paid Subscription and never lapses.
_Avoid_: Free plan, internal account, beta.

**Guide**:
The getting-started checklist a Contractor sees on their dashboard, walking them along the path the product requires anyway: add a Customer, create an Order for them, then optionally invite that Customer to their portal, learn how follow-ups work, and assign a Subcontractor. A Guide is _active_ until the Contractor says otherwise; completing the first two steps offers a fork — _extended_ (show the remaining steps) or _dismissed_. Only that choice is remembered; whether a step is done is always read back from the Contractor's real Customers, Orders, Invites and Assignments, so the Guide can never disagree with the account it describes. The single exception is the follow-up step, which teaches rather than asks and is completed by acknowledgement.
_Avoid_: Onboarding (ambiguous with signup and with the Invite flow), tour, wizard, walkthrough.

## Relationships

- A **Contractor** owns many **Customers** (contractor-scoped).
- A **Customer** links to at most one **User** account (set when the Customer accepts an **Invite**).
- The same real person working with two **Contractors** = two **Customer** records pointing at one **User**.
- A **Contractor** sends an **Invite** to a **Customer**; the Customer does not self-register.
- Accepting an **Invite** binds the accepting **User** to the **Customer** via the Invite's token (email match is a fallback). A **User** may link to at most one **Customer** per **Contractor**.
- An **Order** belongs to one **Contractor** and references one **Customer**.
- A **Contractor** owns many **Subcontractors** (contractor-scoped, exactly as with Customers).
- A **Subcontractor** links to at most one **User** account (set when it accepts a **Subcontractor Invite**), and a **User** holds one global role — so a login is never both a Customer and a Subcontractor.
- A **Subcontractor** is assigned to many **Orders**, and an **Order** may have many assigned **Subcontractors** (**Assignment**).
- A Subcontractor's **Tier** (Trusted Subcontractor vs Guest Contractor) determines what they see and whether they can write on their assigned **Orders**.
- Every **Contractor** has exactly one **Guide**, and only Contractors have one — **Customers** and **Subcontractors** arrive by **Invite** into their own portals and never see it.
- A **Guide**'s steps are derived from the Contractor's own **Customers**, **Orders**, **Invites** and **Assignments**; only the Contractor's continue-or-dismiss choice is stored.
- Every **Contractor** has exactly one **Subscription**, created at sign-up; **Customers** and **Subcontractors** never have one and are never billed.
- A **Subscription** begins as a **Trial** and, if unpaid, becomes **Lapsed** — it is never absent and never deleted.
- **Trial Limits** are measured against a Contractor's _active_ **Customers**, **Orders** and **Subcontractors**; Archiving is therefore a real remedy for a Contractor at their Limit.
- A **Lapsed** Subscription gates only that **Contractor's** own writes. Their **Customers** and assigned **Subcontractors** keep full portal access, including writing back. See [ADR-0005](docs/adr/0005-lapsing-never-reaches-customers.md).
- Paid **Subscriptions** are priced per **Contractor**, so a firm scales by buying more Contractor logins rather than by moving between plans. See [ADR-0006](docs/adr/0006-one-plan-priced-per-contractor.md).

## Example dialogue

> **Dev:** "When a **Customer** signs up on their own, do they show up in a **Contractor's** directory?"
> **Domain expert:** "Customers don't sign up on their own. The **Contractor** creates the **Customer** record first, then sends an **Invite**. The Customer only ever appears because a Contractor put them there."

> **Dev:** "Dana's **Trial** ran out last night. Her customer Sam opens his portal this morning — what does he see?"
> **Domain expert:** "Exactly what he saw yesterday. Sam isn't the one who didn't pay. Dana is **Lapsed**, so Dana can't post an update or send an **Invite** — but Sam's portal, his timeline, his ability to send a request, all of it keeps working. We sell Dana a reputation with her customers; we don't take it hostage."

> **Dev:** "Dana's at her **Trial Limit** of 25 Customers and wants to add one more. Does she have to pay?"
> **Domain expert:** "Only if all 25 are live work. Limits count active records, so if she Archives three finished jobs she's at 22 and can carry on — nothing is lost, and she can unarchive any of them later. The Limit is about how much she's juggling now, not how much she's ever done."

## Flagged ambiguities

- "Client" vs "Customer": older docs (BUSINESS_PROPOSAL.md) say "client"; canonical term is **Customer**.
- "Account": used to mean both **User** (login) and **Customer** (contact record) — these are distinct.
- "No login for clients" (BUSINESS_PROPOSAL.md:66) was reversed in the actual codebase: Customers DO authenticate via magic-link **Invite**. The proposal's anonymous-shareable-link model is not what was built.
- "Tier": `src/routes/pricing/+page.svelte` shipped a `tiers` array of pricing levels (Solo / Crew / Contractor Pro), colliding with **Tier** as defined above (Trusted Subcontractor vs Guest Contractor). Resolved: **Tier** is exclusively a Subcontractor-record concept. There are no pricing tiers — there is one paid **Subscription** priced per Contractor, so the pricing page's `tiers` array is to be removed outright rather than renamed.
- "Payments": the **Order** lifecycle includes states named _Deposit Pending_ and _Final Payment Pending_. Those describe money moving between a **Contractor** and their **Customer**, which this product only ever tracks as a status — it never handles it. The only money this product moves is a Contractor's **Subscription**.
- Seats: pricing is per Contractor, but a company buying several Contractor logins under one bill is not built. Until it is, one **Subscription** covers exactly one Contractor; a firm buys separate Subscriptions.
