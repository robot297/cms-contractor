## 1. Data model

- [ ] 1.1 Add the `order_message` table to `src/lib/server/db/schema.ts`: `id`, `orderId` (fk → `order.id`, cascade), `authorRole`, `authorUserId` (fk → `user.id`, cascade), `body`, `readByContractorAt`, `readByCustomerAt`, `createdAt`, with an index on `(orderId, createdAt)`
- [ ] 1.2 Add the `orderMessageRelations` block alongside the existing relations, and reference messages from `orderRelations`
- [ ] 1.3 Generate the Drizzle migration (`pnpm drizzle-kit generate`) and confirm it is additive only — no ALTER or DROP on existing tables
- [ ] 1.4 Apply the migration locally against `contractor-crm` and confirm the table and index exist

## 2. Messaging server module

- [ ] 2.1 Create `src/lib/server/messaging.server.ts` with a `Viewer` discriminated union (`{ role: 'contractor', userId }` | `{ role: 'customer', userId }`) and a private `authorizeViewer(orderId, viewer)` that resolves the Order for a contractor by `order.contractorId` and for a customer by the Order's `customer.userId`, returning null when unauthorized
- [ ] 2.2 Implement `getThread(orderId, viewer)` returning messages ascending by `createdAt`; refuse (null) when `authorizeViewer` fails
- [ ] 2.3 Implement `sendMessage(orderId, viewer, body)`: trim and refuse empty/whitespace-only bodies, authorize, insert with the viewer's role and user id, and stamp the author's own read column so a message is never unread to its author
- [ ] 2.4 Apply the billing write guard inside `sendMessage` **only** when `viewer.role === 'contractor'` (ADR-0005 — a Customer's send never depends on their Contractor's subscription)
- [ ] 2.5 Notify the other side from `sendMessage` via the existing `notification` table: a customer message notifies `order.contractorId`; a contractor reply notifies the linked Customer's `userId`, skipped without error when the Customer is Unlinked
- [ ] 2.6 Implement `markThreadRead(orderId, viewer)` — one `UPDATE` over messages authored by the other side whose read column for this viewer is null
- [ ] 2.7 Implement `unreadCountsForContractor(contractorId)` returning a map of `orderId → count` over `authorRole = 'customer' AND readByContractorAt IS NULL`, scoped to that Contractor's own Orders
- [ ] 2.8 Write `src/lib/server/messaging.server.test.ts` covering: authorization refusals for a contractor who does not own the Order and a customer not linked to it, empty-body refusal, ascending order, own-message-never-unread, one side reading not clearing the other, unlinked-customer send succeeding without a notification, and the lapsed-contractor asymmetry (customer send succeeds, contractor reply refused)

## 3. View-as plumbing

- [ ] 3.1 Add `CUSTOMER_PORTAL_DEV_TOOLS` to `.env.schema` as `@optional`, defaulting empty, with the same MUST-stay-off-in-production wording as `EMAIL_DEV_TOOLS` / `ID_SCAN_DEV_TOOLS`; regenerate `env.d.ts`
- [ ] 3.2 Add `isViewAsEnabled()` to a new `src/lib/server/view-as.server.ts`, reading through varlock's typed `ENV` (undeclared vars are treated as sensitive and get leak-scanned)
- [ ] 3.3 Implement `resolveViewAs(event)` in the same module: return null and **clear the `dev_view_as` cookie** when the flag is off; otherwise return `{ customerId, customerName }` only when the signed-in user is a contractor and owns the named Customer, re-checked against the database on this request
- [ ] 3.4 Add `viewAs?: { customerId: string; customerName: string }` to `App.Locals` in `src/app.d.ts`
- [ ] 3.5 Wire `resolveViewAs` into `src/hooks.server.ts` after the session is resolved; leave `locals.user` and `session.user.role` untouched
- [ ] 3.6 Add `setViewAs` / `clearViewAs` form actions that set and delete the cookie and redirect to the portal / back to `/contractor`, refusing when the flag is off or the Customer is not owned
- [ ] 3.7 Write `src/lib/server/view-as.server.test.ts`: flag off clears a stale cookie, non-contractor is refused, another Contractor's customer id is refused, owned customer resolves

## 4. Customer portal shell

- [ ] 4.1 Create `src/routes/customer/+layout.server.ts`: resolve the portal subject as `locals.viewAs?.customerId ?? <customer linked to locals.user>`, redirect signed-out visitors to `/login`, and load the Order list (id, project name, customer-visible state via `getVisibleCustomerState`, active/past split, unread count for the customer side)
- [ ] 4.2 Create `src/routes/customer/+layout.svelte`: shell using the shared design tokens (`--surface`, `--fg`, `--line`, …) with no hardcoded color literals, dark-theme support via `theme.sync()`, and the shared `Toaster` mounted
- [ ] 4.3 Build the order rail in the layout — active work above, past work behind a disclosure — with the current Order marked, collapsing to a mobile-friendly control at small widths
- [ ] 4.4 Render the impersonation banner in the layout whenever `data.viewAs` is set: names the Customer and offers a single exit action
- [ ] 4.5 Rewrite `src/routes/customer/+page.server.ts` to redirect to the most recently updated Order, or return the empty state when the Customer has none; delete the old single-page load
- [ ] 4.6 Rewrite `src/routes/customer/+page.svelte` as the empty state only ("your contractor hasn't started an order yet"), with no order rail rendered
- [ ] 4.7 Move invite-token binding (`bindInviteToken` / `bindCustomerByEmail`) into the layout load so it still runs on arrival at any portal URL, preserving the `CustomerAlreadyLinkedError` handling

## 5. Customer order detail

- [ ] 5.1 Create `src/routes/customer/orders/[id]/+page.server.ts`: load the Order for the portal subject, 404 when it is not theirs, read the timeline filtered on `internal = false` **in the query**, read the thread via `getThread`, and call `markThreadRead` for the customer viewer
- [ ] 5.2 Create `src/routes/customer/orders/[id]/+page.svelte`: project name as the heading, customer-visible status secondary, timeline newest-first, thread oldest-first with author attribution ("You" vs the contractor's business name)
- [ ] 5.3 Add the `sendMessage` form action, refusing the send when `locals.viewAs` is set and returning the reason
- [ ] 5.4 Render the composer disabled with a visible explanation while viewing-as, rather than hiding it
- [ ] 5.5 Delete `addCustomerRequest` from `src/lib/server/crm.server.ts` and the question/service/issue form, in this same change so no build ships with both paths
- [ ] 5.6 Replace `getCustomerPortal` in `crm.server.ts` with the per-Order reads the new routes need, and remove the now-unused `CustomerPortal` type
- [ ] 5.7 Update `src/lib/crm.test.ts` and any other tests that referenced the removed functions

## 6. Contractor side

- [ ] 6.1 Add a Messages panel to `src/routes/contractor/orders/[id]/+page.svelte` showing the thread and a reply composer, distinct from the timeline
- [ ] 6.2 Add the reply action to `src/routes/contractor/orders/[id]/+page.server.ts` via `sendMessage` with a contractor viewer, and call `markThreadRead` in the load
- [ ] 6.3 Disable the composer with an explanation when the Order's Customer is Unlinked ("invite <name> to their portal first") — resolves the first Open Question in design.md
- [ ] 6.4 Surface unread counts on `src/routes/contractor/orders/+page.server.ts` / `+page.svelte` using `unreadCountsForContractor`
- [ ] 6.5 Add the view-as control to `src/routes/contractor/+layout.svelte`, rendered only when the flag is on, listing that Contractor's own Customers and posting to `setViewAs`
- [ ] 6.6 Expose `viewAsEnabled` and the Customer list from `src/routes/contractor/+layout.server.ts`, gated on the flag so nothing is sent to the browser when it is off

## 7. Documentation

- [ ] 7.1 Add **Message**, **Thread**, and a pinned definition of **Portal** to `CONTEXT.md`'s Language section, and the Order↔Thread relationship to Relationships
- [ ] 7.2 Note in `CONTEXT.md` that Message is distinct from a Timeline entry — what was said about the job vs what happened to it
- [ ] 7.3 Write `docs/adr/0008-view-as-is-a-development-affordance.md`: dev-flag-only, write-refused, never mutates role, and turning it into support tooling requires its own change with audit logging and consent
- [ ] 7.4 Document the `CUSTOMER_PORTAL_DEV_TOOLS` workflow in the README or Makefile alongside `SEED_DEV_LOGIN`

## 8. Verification

- [ ] 8.1 `pnpm check` and `pnpm lint` clean
- [ ] 8.2 `pnpm test` — full suite green, including the new messaging and view-as tests
- [ ] 8.3 `openspec validate customer-portal --strict` passes
- [ ] 8.4 Grep the portal routes for hardcoded color literals (`#d0d7de`, `#57606a`, `#f6f8fa`) and confirm none remain
- [ ] 8.5 Confirm with the flag unset that no view-as markup, loader data, or cookie survives a request
- [ ] 8.6 Hand off to the user for browser review: dark mode, mobile widths, order rail, thread on both ends, and the view-as banner
