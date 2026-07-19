## 1. Data model & migration

- [ ] 1.1 Add a `customer` table to `src/lib/server/db/schema.ts`: `id`, `contractorId` (FK → `user.id`, NOT NULL), `name`, `email` (required), `userId` (FK → `user.id`, nullable), `archivedAt` (nullable), `createdAt`/`updatedAt`
- [ ] 1.2 Add a unique constraint on `(contractorId, email)` to the `customer` table
- [ ] 1.3 Add nullable `customerId` FK (→ `customer.id`) columns to `order` and `customerInvite`
- [ ] 1.4 Define Drizzle relations for `customer` (belongs-to contractor `user`, optional linked `user` account, has-many orders)
- [ ] 1.5 Generate the migration adding `customer` + FKs; then, after readers are routed through `customer`, drop `order.customerName`/`customerEmail` (sequence so nothing reads them mid-migration)

## 2. Domain layer

- [ ] 2.1 Add a `Customer` type (with linked/unlinked and archived state) to `src/lib/crm.ts`
- [ ] 2.2 Add pure helpers: normalize/validate a required email, detect duplicate by `(contractorId, email)`, and decide edit-allowed (unlinked only)
- [ ] 2.3 Unit-test the domain helpers in `src/lib/crm.test.ts`

## 3. Server data operations (`src/lib/server/crm.server.ts`)

- [ ] 3.1 `listCustomers(contractorId, searchTerm?)` — the contractor's own non-archived customers, filterable by name/email
- [ ] 3.2 `createCustomer(contractorId, { name, email })` — requires email; rejects duplicate `(contractorId, email)` with a typed error
- [ ] 3.3 `editCustomer(contractorId, id, { name, email })` — email editable only while unlinked; editing email revokes any pending invite; reject email edit on a linked customer
- [ ] 3.4 `archiveCustomer(contractorId, id)` — soft-archive when the customer has orders; hard-delete only when no orders and no linked user
- [ ] 3.5 Replace the email-only `linkCustomerByEmail` with `bindInviteToken` — on invite acceptance, set `customer.userId` from the accepted `customerInvite.token` regardless of authenticating email; email match is fallback only; handle expired/revoked tokens
- [ ] 3.6 Enforce the guard: a user may link to at most one customer per contractor
- [ ] 3.7 Update `createOrder` to take a `customerId` (reuse existing) or inline new-customer details (upsert on duplicate email) and link the order; stop writing denormalized name/email; read customer name/email through the linked `customer`
- [ ] 3.8 Ensure order-update notifications reach the linked account via `customer.userId` when present
- [ ] 3.9 Tests: scoping, required/duplicate email, edit rules, soft-archive vs hard-delete, token binding + one-per-contractor guard

## 4. Contractor directory route

- [ ] 4.1 Create `src/routes/contractor/customers/+page.server.ts` guarded by `requireContractor`; `load` returns `{ customers }`
- [ ] 4.2 Add `addCustomer` action (validates required name+email, reports missing/duplicate fields)
- [ ] 4.3 Add `editCustomer` and `archiveCustomer` actions (respecting linked/unlinked and orders rules)
- [ ] 4.4 Add `sendInvite` from the directory (reuse the existing invite mechanism) so a contractor can invite a customer they created
- [ ] 4.5 Add search handling (server action or client-side filter over loaded customers)
- [ ] 4.6 Create `src/routes/contractor/customers/+page.svelte`: directory list, search box, empty state, add/edit/archive controls, invite button, no-results state
- [ ] 4.7 Add a link to the customer directory from the contractor navigation

## 5. Order creation wiring

- [ ] 5.1 Update the new-order form in `src/routes/contractor/+page.svelte` to select one of the contractor's own customers or add one inline
- [ ] 5.2 Update the `createOrder` action in `src/routes/contractor/+page.server.ts` to pass the selected/inline customer through to the server op

## 6. Verification

- [ ] 6.1 Verify each spec scenario end-to-end (directory lists all customers regardless of order state; add; reuse existing on order; required + duplicate email rejected; token binding across a different OAuth email; one-user-per-customer guard; edit-while-unlinked revokes invite; linked email frozen; soft-archive keeps order history; order reads name/email through customer)
- [ ] 6.2 Run the full test suite and type-check; fix regressions
- [ ] 6.3 Run `openspec validate contractor-customer-directory` and resolve any issues
