## Why

Contractors don't work alone — they delegate parts of a job to trade partners (electricians, framers, concrete crews) but today the CRM has no concept of them. There's nowhere to keep a roster, no way to give a partner controlled visibility into the jobs they're on, and no boundary protecting the homeowner's contact details from every trade that touches a project. This change introduces **Subcontractors** as first-class, contractor-administered actors with tier-gated portal access to the Orders they're assigned.

## What Changes

- Introduce the **Subcontractor**: a contractor-scoped record (mirrors the Customer record model) that Links to at most one **User** via a **Subcontractor Invite** (parallel to the customer Invite, same token-binding — see [ADR-0003](../../../docs/adr/0003-parallel-subcontractor-invite.md)).
- Add a third global User **role**, `subcontractor`. A User holds **exactly one** role; an Invite that would make a login both a Customer and a Subcontractor (or a Contractor and a Subcontractor) is **refused** — see [ADR-0002](../../../docs/adr/0002-one-role-per-user.md). **BREAKING** to the `role` domain (two variants → three) and post-login routing.
- Add a **Subcontractors supporting page** (`/contractor/subcontractors`): a searchable **roster** (add / archive, tier badge, invite/link status) and a **profile** the contractor administers (trade/specialty, contact, company, license #, insurance carrier + expiry, avatar, notes/tags).
- Add an access **Tier** on each Subcontractor: **Trusted Subcontractor** (sees the full assigned Order incl. customer contact + timeline, and may write timeline notes / upload job photos) vs **Guest Contractor** (work details only, customer PII redacted, read-only).
- Add **Assignment**: assign Subcontractors to Orders (many-to-many); manage a job's assigned subs and, from a sub's profile, see the Orders they're on.
- Add a **Subcontractor portal** (`/subcontractor`): after accepting an Invite, a sub logs in to a tier-gated list of their assigned Orders and can act on them per their Tier.

Non-goals (v1): compliance auto-flagging (expiring/missing license or insurance is stored but not surfaced as alerts); multi-hat Users; sub-task-level (below Order) assignment; subcontractor-initiated invites.

## Capabilities

### New Capabilities
- `subcontractor-directory`: The contractor-facing supporting page — Subcontractor roster + administered profile, the Trusted/Guest **Tier**, and the Subcontractor **Invite** lifecycle (send / resend / revoke, Linked/Invited/Unlinked status), including the one-role-per-User guard on acceptance.
- `order-assignment`: Assigning Subcontractors to Orders (many-to-many), managing an Order's assigned subs, and listing a Subcontractor's assigned Orders.
- `subcontractor-portal`: The authenticated Subcontractor view of assigned Orders, with Tier-gated visibility (Guest sees redacted customer PII) and Tier-gated write access (Trusted may add timeline notes / upload job photos).

### Modified Capabilities
<!-- `customer-relations` requirements do not change: the customer flow is untouched. The subcontractor identity/invite mirrors it as a parallel mechanism (ADR-0003), so it is introduced as new capabilities, not deltas. -->

## Impact

- **Data model** (`src/lib/server/db/schema.ts`): new `subcontractor` table (contractor-scoped, mirrors `customer`: name/email/phone/address/company/notes/tags/avatar/`userId`/`archivedAt`, plus `trade`, `tier` `trusted|guest`, `licenseNumber`, `insuranceCarrier`, `insuranceExpiresAt`); new `subcontractor_invite` table (mirrors `customer_invite`); new `order_subcontractor` join (many-to-many). `user.role` domain extends to include `subcontractor`. Migration(s) in `drizzle/`.
- **Domain** (`src/lib/crm.ts`): subcontractor contact/profile validation (shared Zod), tier + trade enums, PII-redaction helper for Guest Order views, single-role-collision guard.
- **Server** (`src/lib/server/crm.server.ts` + a `subcontractor.server.ts`): CRUD for subcontractors; `createSubcontractorInvite` / bind-by-token (parallel to customer invite, honoring ADR-0001/0002); assign/unassign subs to orders; tier-scoped order views for the portal; subcontractor-authored timeline notes + attachments.
- **Auth/routing** (`src/hooks.server.ts`): recognize `role: 'subcontractor'` and route to `/subcontractor`; extend guards (`requireContractor` unaffected; add `requireSubcontractor`).
- **Routes**: new `src/routes/contractor/subcontractors/**` (roster + profile + assignment UI); new `src/routes/subcontractor/**` (portal); Orders UI gains an "assigned subs" surface; contractor nav gains **Subcontractors**.
- **Seed/demo** (`scripts/demo-fixtures.js`, `demo.server.ts`, `seed.mjs`): sample subcontractors, an assignment or two, and one Trusted + one Guest to exercise both tiers.
- **Docs**: `CONTEXT.md` (done — Subcontractor / Tier / Subcontractor Invite / Assignment terms), ADR-0002, ADR-0003 (done).
