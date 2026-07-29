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

## Example dialogue

> **Dev:** "When a **Customer** signs up on their own, do they show up in a **Contractor's** directory?"
> **Domain expert:** "Customers don't sign up on their own. The **Contractor** creates the **Customer** record first, then sends an **Invite**. The Customer only ever appears because a Contractor put them there."

## Flagged ambiguities

- "Client" vs "Customer": older docs (BUSINESS_PROPOSAL.md) say "client"; canonical term is **Customer**.
- "Account": used to mean both **User** (login) and **Customer** (contact record) — these are distinct.
- "No login for clients" (BUSINESS_PROPOSAL.md:66) was reversed in the actual codebase: Customers DO authenticate via magic-link **Invite**. The proposal's anonymous-shareable-link model is not what was built.
