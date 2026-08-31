## 1. Data model & migration

- [x] 1.1 Add a `customer` table to `src/lib/server/db/schema.ts`: `id`, `contractorId` (FK → `user.id`, NOT NULL), `name`, `email` (required), `userId` (FK → `user.id`, nullable), `archivedAt` (nullable), `createdAt`/`updatedAt`
- [x] 1.2 Add a unique constraint on `(contractorId, email)` to the `customer` table
- [x] 1.3 Add nullable `customerId` FK (→ `customer.id`) columns to `order` and `customerInvite`
- [x] 1.4 Define Drizzle relations for `customer` (belongs-to contractor `user`, optional linked `user` account, has-many orders)
- [x] 1.5 Generate the migration adding `customer` + FKs and dropping `order.customerName`/`customerEmail` (`drizzle/0001_customer_directory.sql`)
- [x] 1.6 Add customer contact detail columns — `phone`, `address`, `notes`, `tags` (text[]) — and migration (`drizzle/0002_customer_contact_fields.sql`)

## 2. Domain layer

- [x] 2.1 Add a `Customer`/`CustomerContact` type (linked/unlinked, archived, tags) to `src/lib/crm.ts`
- [x] 2.2 Add a shared Zod `customerContactSchema` (name/email required, 10-digit phone, tag parsing) plus `formatPhone`, `parseTags`, `normalizeEmail`, `canEditCustomerEmail`
- [x] 2.3 Unit-test the domain helpers in `src/lib/crm.test.ts` (validation, phone formatting, tags, link state) — 21 tests pass

## 3. Server data operations (`src/lib/server/crm.server.ts`)

- [x] 3.1 `listCustomers(contractorId, searchTerm?)` — the contractor's own non-archived customers, filterable by name/email
- [x] 3.2 `createCustomer(contractorId, details)` — requires email; persists phone/address/notes/tags; rejects duplicate `(contractorId, email)` with a typed error
- [x] 3.3 `editCustomer(contractorId, id, details)` — email editable only while unlinked; editing email revokes any pending invite; reject email edit on a linked customer
- [x] 3.4 `archiveCustomer(contractorId, id)` — always a soft-archive (sets `archivedAt`); never deletes the record
- [x] 3.5 Replace the email-only `linkCustomerByEmail` with `bindInviteToken` (token-first) + `bindCustomerByEmail` fallback; handle expired/revoked tokens
- [x] 3.6 Enforce the guard: a user may link to at most one customer per contractor
- [x] 3.7 Update `createOrder` to take a `customerId` (reuse) or inline new-customer details (upsert on duplicate email); stop writing denormalized name/email; read through the linked `customer`
- [x] 3.8 Ensure order-update notifications reach the linked account via `customer.userId` when present
- [x] 3.9 Cover decision logic with pure unit tests (email validation, edit-lock, link state). NOTE: full DB-integration tests (scoping/dupe/archive/binding against Postgres) still need a test-DB harness this repo does not yet have

## 4. Contractor directory route

- [x] 4.1 Create `src/routes/contractor/customers/+page.server.ts` guarded by `requireContractor`; `load` returns `{ customers, search }`
- [x] 4.2 Add `addCustomer` action (Zod-validated; reports missing/duplicate/invalid fields)
- [x] 4.3 Add `editCustomer` and `archiveCustomer` actions (respecting linked/unlinked and orders rules)
- [x] 4.4 Add `sendInvite` from the directory (customer-based invite)
- [x] 4.5 Live client-side search: debounced filter over the loaded directory with instant name suggestions (no submit)
- [x] 4.6 Build `+page.svelte`: **read-only cards with Edit → Save/Cancel**, **modal add-customer**, **inline archive confirmation**, tag chips, phone/address/notes, live phone formatting, client-side Zod pre-check, empty/no-results states
- [x] 4.7 Add a link to the customer directory from the contractor dashboard

## 5. Order creation & deletion

- [x] 5.1 `createOrder` server op links an order to a directory customer (`{ customerId }`)
- [x] 5.2 New Order modal on the dashboard: search the contractor's customers and create an order for the chosen one
- [x] 5.3 `deleteOrder` (contractor-scoped, cascades timeline/notifications/invites) with an inline confirm on each order card

## 7. Dashboard & nav

- [x] 7.1 Notifications in a header bell with an unread-count badge and dropdown (mark read / mark all read)
- [x] 7.2 Shared `/contractor` layout: top nav with Dashboard/Customers menu + Sign out via a `/logout` endpoint
- [x] 7.3 Per-page sign-out actions removed; page headers simplified (nav lives in the layout)

## 6. Verification

- [x] 6.2 Type-check (`pnpm run check`, 0 errors) and unit suite (21 tests) pass
- [x] 6.3 `openspec validate contractor-customer-directory` passes
- [x] 6.1 Drive each spec scenario end-to-end against a running app with a live Postgres (verified via demo-contractor session on `pnpm dev` + migrated `contractor-crm` DB: list/create/edit/soft-archive, duplicate + missing-email rejection, email-editable-while-unlinked, and notification delivery to a linked user on order update)
