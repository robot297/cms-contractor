## 1. Data model & migrations

- [x] 1.1 Add `subcontractor` table to `schema.ts` (contractor-scoped; mirrors `customer`: name/email/phone/address/company/notes/tags/avatar/`userId`/`archivedAt` + `trade`, `tier` default `'guest'`, `licenseNumber`, `insuranceCarrier`, `insuranceExpiresAt`; unique `(contractorId, email)`)
- [x] 1.2 Add `subcontractor_invite` table mirroring `customer_invite` (token, status, expiresAt, subcontractorEmail, FKs)
- [x] 1.3 Add `order_subcontractor` join table (`(orderId, subcontractorId)` PK, `assignedAt`, both FKs cascade)
- [x] 1.4 Generate + apply the migration (`pnpm db:generate`; verify `scripts/migrate.mjs` applies cleanly)

## 2. Domain (`src/lib/crm.ts`)

- [x] 2.1 Add `SUBCONTRACTOR_TIERS = ['trusted','guest']` + type/guard, and a `TRADES` list (or free-text) with validation
- [x] 2.2 Add `subcontractorContactSchema` (shared Zod) for the profile fields, mirroring `customerContactSchema`
- [x] 2.3 Add `role` type widening to `contractor | customer | subcontractor` and a `redactCustomerForGuest()` projection helper
- [x] 2.4 Unit tests for tier/trade validation and the redaction helper

## 3. Server — subcontractor administration (`src/lib/server/subcontractor.server.ts`)

- [x] 3.1 CRUD: `createSubcontractor` / `editSubcontractor` / `listSubcontractors` / `archiveSubcontractor` (contractor-scoped, `(contractorId,email)` dedupe)
- [x] 3.2 `setSubcontractorTier` and profile field updates (trade, company, license, insurance)
- [x] 3.3 `createSubcontractorInvite` / `resendInvite` / `revokeInvite`; Linked/Invited/Unlinked derivation

## 4. Server — invite binding & role guard

- [x] 4.1 `bindSubcontractorInviteToken` mirroring the customer token-bind (token first, email fallback) per ADR-0001/0003 — do NOT touch the customer path
- [x] 4.2 Enforce one-role-per-User (ADR-0002): refuse binding for a User with a conflicting role, returning a clear error (no silent empty portal); set `role='subcontractor'` for a fresh User
- [x] 4.3 Tests: token bind, email fallback, and collision-refused cases (pure link-status/tier/redaction unit-tested; DB-dependent bind + role-collision paths verified end-to-end in 11.2 against live Postgres — this repo has no test-DB harness yet, mirroring `contractor-customer-directory` 3.9)

## 5. Server — assignment & tier-scoped views

- [x] 5.1 `assignSubcontractor` / `unassignSubcontractor` (same-contractor check, idempotent)
- [x] 5.2 `listOrderSubcontractors(orderId)` and `listSubcontractorOrders(subId)`
- [x] 5.3 `subcontractorOrderView(subId, orderId)` that returns full detail for Trusted and a server-side-redacted projection for Guest (PII never in the Guest payload)

## 6. Auth & routing (`src/hooks.server.ts`)

- [x] 6.1 Recognize `role: 'subcontractor'` in the session and route those Users to `/subcontractor`
- [x] 6.2 Add `requireSubcontractor` guard; confirm `requireContractor`/customer guards reject the new role

## 7. Contractor supporting page (`src/routes/contractor/subcontractors/**`)

- [x] 7.1 Roster page: searchable list, add-subcontractor modal, tier badge, invite/link status, archive-with-confirm
- [x] 7.2 Subcontractor profile: view/edit fields, tier toggle, license/insurance, avatar; show assigned Orders with status
- [x] 7.3 Assignment UI: assign/unassign subs on an Order, and the Order's "assigned subs" surface
- [x] 7.4 Add **Subcontractors** to the contractor nav (`contractor/+layout.svelte`)

## 8. Subcontractor portal (`src/routes/subcontractor/**`)

- [x] 8.1 Portal home: list only the signed-in sub's assigned Orders
- [x] 8.2 Assigned-Order view: full for Trusted, redacted for Guest (drives off the tier-scoped view from 5.3)
- [x] 8.3 Trusted write paths: add timeline note + upload job photo (`authorRole='subcontractor'`); Guest portal read-only with no write affordances

## 9. Invite acceptance flow

- [x] 9.1 Subcontractor Invite accept route: bind via 4.1/4.2, surface the collision error clearly, land a fresh sub in the portal

## 10. Seed / demo

- [x] 10.1 Extend `scripts/demo-fixtures.js` with sample Subcontractors (≥1 Trusted, ≥1 Guest) + at least one Assignment
- [x] 10.2 Thread the new fixtures through `demo.server.ts` and `scripts/seed.mjs`; re-seed and verify both tiers render

## 11. Verification

- [x] 11.1 `pnpm check` clean
- [x] 11.2 Manual pass (end-to-end vs live Postgres + `pnpm dev`, demo-contractor session): roster add/edit/tier/soft-archive + duplicate-email reject; invite send/revoke; assign/idempotent/unassign; token-accept promotes a fresh user to `subcontractor` while an existing customer is refused (sub stays unlinked); Trusted portal shows full customer PII + can post notes, Guest portal is PII-redacted server-side + read-only (write → 403); role routes to `/subcontractor`; unassignment removes portal access
