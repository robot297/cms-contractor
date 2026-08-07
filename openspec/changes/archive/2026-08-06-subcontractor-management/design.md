## Context

The CRM models a **Contractor** (a login `User` with `role`) who owns contractor-scoped **Customer** records; a Customer Links to a `User` via a token-bound **Invite** ([ADR-0001](../../../docs/adr/0001-bind-customer-to-user-by-invite-token.md)) and gets a portal. **Orders** belong to a Contractor and reference one Customer. This change adds a parallel actor — the **Subcontractor** — that the Contractor administers and gives tier-gated portal access to assigned Orders. The design deliberately reuses the *shape* of the Customer machinery while keeping the proven customer paths untouched. All key decisions below were resolved in a grilling session and recorded in `CONTEXT.md` + ADR-0002/0003.

## Goals / Non-Goals

**Goals:**
- A Subcontractor is a contractor-scoped record that mirrors the Customer record↔User pattern, Linking to a `User` via a parallel token-bound Invite.
- A "strong supporting page": roster + administered profile + assignment management.
- Tier-gated portal: **Trusted Subcontractor** (full Order + write) vs **Guest Contractor** (redacted PII + read-only).
- Assign Subcontractors to Orders (many-to-many); a sub sees their assigned Orders on login.

**Non-Goals:**
- Compliance auto-flagging (license/insurance is stored, not surfaced as alerts).
- Multi-hat Users (a User is exactly one role — ADR-0002).
- Sub-task/line-item assignment below the Order.
- Subcontractor-initiated invites or self-registration.
- Reworking the customer Invite into a shared/polymorphic mechanism.

## Decisions

### 1. Subcontractor is a full actor, mirroring the Customer record model
A Subcontractor is a **contractor-scoped record** (belongs to one Contractor) that Links to at most one `User` via a Subcontractor Invite — "same trade person under two Contractors = two records → one User", exactly like Customers. Adds `role: 'subcontractor'`.
- **Why:** Maximum reuse of the proven record↔User↔Invite spine and the strict contractor-scoping the model relies on.
- **Alternatives:** (a) a shared cross-contractor roster — breaks scoping and opens cross-Contractor visibility; (b) User-only with no profile record — nowhere to "administer them" (trade, license, tier).

### 2. One role per User; refuse cross-role Invite collisions (ADR-0002)
`user.role` stays a single global value; extend it to `contractor | customer | subcontractor`. Accepting a Subcontractor Invite that resolves to a User with a conflicting role is refused with a clear, non-silent message.
- **Why:** `role` drives `hooks.server.ts` routing and every guard today; multi-hat means a real auth refactor and re-opens ADR-0001's binding. Keeps this change additive.
- **Alternative:** multi-hat Users (role as a set, hat-picker at login) — deferred as its own change.

### 3. Tier lives on the Subcontractor record; gates both visibility and writes
`tier ∈ {trusted, guest}` on the `subcontractor` row, applied to all that sub's assignments. **Trusted** → full Order view (customer name/phone/address + timeline) and may write timeline notes + upload job photos (`authorRole: 'subcontractor'`). **Guest** → project/type/status + work timeline with customer contact PII **redacted**, read-only.
- **Why:** One setting per sub is the simplest thing that expresses the primary Contractor's trust; the tier the Contractor already reasons about.
- **Alternatives:** per-assignment tier (more flexible, more UI/data) — deferred; a single fixed visibility policy — the user explicitly wanted a Contractor-assigned trust distinction.

### 4. Assignment is Order-level, many-to-many
An `order_subcontractor` join links Orders and Subcontractors. A sub's "work" = the Orders assigned to them.
- **Why:** Order is already the unit of tracked work; smallest addition that satisfies "see assigned work".
- **Alternative:** sub-task assignment — needs a whole work-breakdown model; out of scope.

### 5. Parallel Subcontractor Invite, not a generalized Invite (ADR-0003)
A `subcontractor_invite` table + a sibling bind-by-token function reuse the ADR-0001 pattern (token first, email fallback, single-link/-role guard) without touching `customer_invite`.
- **Why:** ADR-0001 flags the customer binding as load-bearing; generalizing risks the shipped customer flow. A parallel flow also lets the Subcontractor Invite carry Tier context a Customer Invite has no notion of.
- **Alternative:** polymorphic invite with a `targetType` discriminator — DRYer but larger blast radius.

### 6. Data model shapes
- `subcontractor`: `id`, `contractorId` (FK, cascade), `name`, `email`, `phone?`, `address?`, `company?`, `trade?`, `tier` (`text`, default `'guest'`), `licenseNumber?`, `insuranceCarrier?`, `insuranceExpiresAt?`, `avatar?`, `notes?`, `tags[]`, `userId?` (Link), `archivedAt?`, timestamps. Unique `(contractorId, email)`, mirroring Customer.
- `subcontractor_invite`: mirrors `customer_invite` (`token`, `status`, `expiresAt`, `subcontractorEmail`, FKs).
- `order_subcontractor`: `(orderId, subcontractorId)` PK, `assignedAt`. Both FKs cascade.
- `user.role`: no schema change (free-text today), but the domain/type widens to include `subcontractor`.

## Risks / Trade-offs

- **Duplication between customer and subcontractor invite flows** → Accept per ADR-0003; keep the sub flow a thin mirror and lean on the customer flow's existing behavior as the reference. Revisit only with regression coverage in place.
- **PII leak to Guest Contractors** → The Guest Order view must be a *separate, redaction-first* projection, not the customer portal view with fields hidden in the template. Redact server-side in the query/view layer so PII never reaches the client.
- **Role collision surfaces as a dead end** → Binding must return a clear error (mirror the customer single-link guard), never a silent empty portal (the exact ADR-0001 failure).
- **Third role expands auth surface** → `hooks.server.ts` and guards must handle `subcontractor` explicitly; a User with the new role must route to `/subcontractor`, and contractor/customer guards must not accidentally admit it.
- **Tier is global per sub, not per job** → Accepted simplification; if a Contractor needs job-specific trust, that's the per-assignment-tier follow-up.

## Migration Plan

- Additive migrations only: create `subcontractor`, `subcontractor_invite`, `order_subcontractor`. No changes to existing tables (role stays free-text). Generate with `pnpm db:generate`; applied at startup by `scripts/migrate.mjs`.
- No backfill required (net-new tables). Rollback = drop the three new tables; existing customer/order/auth flows are untouched.
- Seed/demo updated to include sample subs (one Trusted, one Guest) and an assignment so both tiers are exercisable in the demo.

## Open Questions

- Exact redaction set for Guest Contractors (first name + job-site area only, vs project + status with no customer identity at all) — to be pinned in the `subcontractor-portal` spec scenarios.
- Whether a Subcontractor's avatar reuses the customer avatar capture (data-URL) or the construction-icon set — cosmetic, defaulting to reuse of the avatar mechanism.
