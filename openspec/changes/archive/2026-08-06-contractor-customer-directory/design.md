## Context

Today a "customer" has no first-class existence. A customer is either denormalized `customerName`/`customerEmail` text on an `order` row (`src/lib/server/db/schema.ts:16-17`) or a `user` row with `role='customer'` that a contractor only sees once an `order.customerId` links them (`schema.ts:15`). The only contractor↔customer relationship in the system is the `order` row itself. `crm.server.ts` exposes `listContractorOrders` but no customer-listing query, and no contractor route renders customers. Consequently a contractor with no orders — or whose orders have moved past the three attention states — sees an empty screen.

Auth already distinguishes roles: `role` is a better-auth additional field (`src/lib/server/auth.ts:16-25`), normalized in `hooks.server.ts:18` so any non-`contractor` value collapses to `customer`. Route guards (`requireContractor`, `requireCustomer`) enforce access per portal. This change builds a customer directory on top of that existing foundation without altering auth.

## Goals / Non-Goals

**Goals:**
- A first-class `customer` record scoped to a contractor, independent of orders.
- A contractor directory route that lists/searches all of a contractor's customers regardless of order state.
- Add-new-customer flow, and reuse of the contractor's own existing customers on a new order.
- The directory has a single source: customer records the contractor created. Customers never self-register; the contractor creates the record and sends an invite/magic link.
- Invite acceptance binds a user to a customer by invite token (email fallback), one user per customer per contractor.
- Orders reference a `customer` record as the single source of truth for customer name/email (no denormalized copy), preserving customer-update notifications via the linked user.

**Non-Goals:**
- Order/update **templates** and document **upload/send** — deferred to follow-on proposals.
- Back-filling the directory from customers referenced only on pre-existing orders — deliberately excluded; data is early/throwaway and no escape-hatch script is planned.
- Any change to authentication, role assignment, or the customer portal's own UX beyond linking.
- A customer-facing view of "which contractors have me" — out of scope.

## Decisions

### Decision 1: Introduce a `customer` table rather than derive customers from orders
Add a `customer` table: `id`, `contractorId` (FK → `user.id`, NOT NULL), `name`, `email` (required), optional `userId` (FK → `user.id`, nullable — set when an invite is accepted), `archivedAt` (nullable, for soft-archive), plus timestamps. Enforce a unique constraint on `(contractorId, email)` so a contractor can't hold duplicate customers while different contractors can each have the same customer email.

- **Why:** A directory, add, and select all require customers to exist independently of orders. Deriving from orders (GROUP BY on `order.customerEmail`) can't represent a customer with zero orders, can't be searched cleanly, and has no stable identity to attach invites/accounts to.
- **Alternative considered:** Keep deriving from orders and just add a "no orders yet" placeholder. Rejected — it can't satisfy "add a customer" or "select an existing signed-in customer," and every downstream feature (templates, docs) would need the same entity anyway.

### Decision 2: `order` gains a nullable `customerId` FK, and its denormalized name/email columns are dropped
Add `customerId` (FK → `customer.id`, nullable) to `order` and `customerInvite`, and **remove** `order.customerName`/`customerEmail`. The linked `customer` record is the single source of truth for the order's customer name/email. The FK is nullable so pre-existing orders (no back-fill) remain valid with a null link.

- **Why:** A dual store (denormalized order fields + `customer.id`) drifts. Since we are pre-launch with throwaway data and no back-fill, dropping the columns outright is clean and removes the drift risk entirely. Historical name/email snapshotting isn't worth the complexity for the MVP.
- **Alternative considered:** Keep the denormalized columns for historical display. Rejected — drift risk outweighs the marginal value at this stage.

### Decision 3: "Select existing" reuses the contractor's own customers only
There is no cross-contractor candidate discovery. When creating an order, the contractor picks from `listCustomers(contractorId)` — their own non-archived records — to reuse a repeat customer. Customers never self-register, so there is no pool of self-made accounts to surface, and the cross-contractor privacy problem does not arise.

- **Why:** Matches the contractor-driven model (the contractor creates every customer, then invites them). "Select existing" is reuse within one's own directory, not discovery.
- **Alternative considered:** Surface all `role='customer'` accounts as selectable candidates. Rejected — it leaks customer existence across contractors and contradicts the no-self-registration rule.

### Decision 4: Invite acceptance binds user↔customer by token, not email
Replace the email-only `linkCustomerByEmail` path (`crm.server.ts:112-122`) with token-first binding: when an invite is accepted, set `customer.userId` on the `customer` record referenced by the accepted `customerInvite.token`, regardless of the authenticating email; email match is a fallback only. Enforce a guard that a user links to at most one `customer` per contractor. Editing an unlinked customer's email revokes its pending invite; a linked customer's email is read-only. (See ADR 0001.)

- **Why:** OAuth sign-in can carry a different email than the invited address, so an email-only match silently fails and yields an empty portal. The token is the contractor's explicit "this person = this customer" assertion.
- **Alternative considered:** Keep email matching. Rejected — the silent-empty-portal failure mode; recorded in `docs/adr/0001-bind-customer-to-user-by-invite-token.md`.

### Decision 4b: Archiving is always a soft-archive (never a delete)
A `customer` carries an `archivedAt` column. Archiving only sets `archivedAt`; it never deletes the record. Archived customers are excluded from the directory and order-time selection, but the record and its orders are preserved. The contractor confirms in the UI (inline "are you sure?") before the archive is submitted.

- **Why:** Deletion is destructive and surprising; contractors expect archive to hide, not erase. Keeping the record also keeps order history and any future un-archive trivial.

### Decision 5: New route `contractor/customers` with load + form actions
Add `src/routes/contractor/customers/+page.server.ts` (guarded by the existing `requireContractor`) with a `load` returning `{ customers }` and actions `addCustomer`, `editCustomer`, `archiveCustomer`, `sendInvite` (or reuse the existing invite action), plus search via client-side filter or a server action over the loaded list. Update the new-order form on `contractor/+page.svelte` to pick one of the contractor's own customers or add one inline. All new DB operations live in `crm.server.ts` (`listCustomers`, `createCustomer`, `editCustomer`, `archiveCustomer`, `bindInviteToken`) and stay scoped by `contractorId`.

- **Why:** Matches the codebase's established SvelteKit form-action + `*.server.ts` data-layer pattern and its per-route guard/ownership scoping.

## Risks / Trade-offs

- **`(contractorId, email)` uniqueness collides with an inline order-create for an existing customer** → The order-create path must upsert/select the existing record on duplicate email rather than error.
- **Dropping `order.customerName`/`customerEmail` breaks any reader of those columns** → Acceptable pre-launch with throwaway data; audit `crm.server.ts`/`+page.svelte` for reads and route them through the linked `customer`. Orders with a null `customerId` (pre-change) have no customer to read — accepted, since there is no back-fill.
- **Existing orders won't appear in the directory** (back-fill excluded, by decision) → Accepted; data is early/throwaway. No escape-hatch script is planned.
- **Token-first binding depends on the invite token surviving to acceptance** → Editing an unlinked customer's email revokes the pending invite so a stale token can't bind; the accept path must handle an expired/revoked token gracefully.
- **Migration drops columns from `order`** → Not purely additive. Safe pre-launch, but sequence the migration (add `customer` + FKs first, then drop the denormalized columns) and confirm no code still reads them.

## Migration Plan

1. Add the `customer` table and nullable `customerId` FK columns on `order` and `customerInvite`; generate a Drizzle migration under `drizzle/`.
2. Route all customer name/email reads through the linked `customer`, then drop `order.customerName`/`customerEmail` in a follow-up migration step.
3. Deploy server logic and the new route behind the existing contractor guard.
4. Existing orders keep working with a null `customerId`. **No back-fill** runs — accepted by decision (early/throwaway data).
5. **Rollback:** restore the dropped columns from migration history if needed; the `customer` table and FKs can be dropped in reverse order.

## Open Questions

- Should a customer record capture more than name/email now (phone, address, notes) to avoid a schema change when templates/docs land, or add those fields when those features need them? (Leaning: add when needed.)
- The contractor dashboard's default `follow-ups` view can look empty even when orders exist ([contractor/+page.svelte:9](../../../src/routes/contractor/+page.svelte)); tracked as a **separate** order-visibility change, out of scope here.
