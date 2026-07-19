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
A login identity (a `user` row / better-auth account) with a `role` of `contractor` or `customer`. Distinct from a Customer record.
_Avoid_: Account (ambiguous — could mean User or Customer).

**Invite**:
A magic/invite link a Contractor sends so a Customer can access their portal. The Contractor initiates it; Customers do not self-register.
_Avoid_: Signup, registration.

**Directory**:
A Contractor's private, searchable list of their own Customers, independent of whether any Order references them. Its ONLY source is Customers the Contractor created. "Select existing" means reusing one of your own repeat Customers on a new Order — never discovering another Contractor's Customers or self-registered accounts.

**Order**:
A unit of tracked work a Contractor performs for a Customer, with a lifecycle state and a timeline. Links to one Customer.
_Avoid_: Project (used in older business proposal), job, ticket.

## Relationships

- A **Contractor** owns many **Customers** (contractor-scoped).
- A **Customer** links to at most one **User** account (set when the Customer accepts an **Invite**).
- The same real person working with two **Contractors** = two **Customer** records pointing at one **User**.
- A **Contractor** sends an **Invite** to a **Customer**; the Customer does not self-register.
- Accepting an **Invite** binds the accepting **User** to the **Customer** via the Invite's token (email match is a fallback). A **User** may link to at most one **Customer** per **Contractor**.
- An **Order** belongs to one **Contractor** and references one **Customer**.

## Example dialogue

> **Dev:** "When a **Customer** signs up on their own, do they show up in a **Contractor's** directory?"
> **Domain expert:** "Customers don't sign up on their own. The **Contractor** creates the **Customer** record first, then sends an **Invite**. The Customer only ever appears because a Contractor put them there."

## Flagged ambiguities

- "Client" vs "Customer": older docs (BUSINESS_PROPOSAL.md) say "client"; canonical term is **Customer**.
- "Account": used to mean both **User** (login) and **Customer** (contact record) — these are distinct.
- "No login for clients" (BUSINESS_PROPOSAL.md:66) was reversed in the actual codebase: Customers DO authenticate via magic-link **Invite**. The proposal's anonymous-shareable-link model is not what was built.
