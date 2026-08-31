## 1. Data model

- [x] 1.1 Add the `order_message` table to `src/lib/server/db/schema.ts`: `id`, `orderId` (fk → `order.id`, cascade), `authorRole`, `authorUserId` (fk → `user.id`, cascade), `body`, `readByContractorAt`, `readByCustomerAt`, `createdAt`, with an index on `(orderId, createdAt)`
- [x] 1.2 Add the `orderMessageRelations` block alongside the existing relations, and reference messages from `orderRelations`
- [x] 1.3 Generate the Drizzle migration (`pnpm drizzle-kit generate`) and confirm it is additive only — no ALTER or DROP on existing tables
- [x] 1.4 Apply the migration locally against `contractor-crm` and confirm the table and index exist

## 2. Messaging server module

- [x] 2.1 Create `src/lib/server/messaging.server.ts` with a `Viewer` discriminated union (`{ role: 'contractor', userId }` | `{ role: 'customer', userId }`) and a private `authorizeViewer(orderId, viewer)` that resolves the Order for a contractor by `order.contractorId` and for a customer by the Order's `customer.userId`, returning null when unauthorized
- [x] 2.2 Implement `getThread(orderId, viewer)` returning messages ascending by `createdAt`; refuse (null) when `authorizeViewer` fails
- [x] 2.3 Implement `sendMessage(orderId, viewer, body)`: trim and refuse empty/whitespace-only bodies, authorize, insert with the viewer's role and user id, and stamp the author's own read column so a message is never unread to its author
- [x] 2.4 Apply the billing write guard inside `sendMessage` **only** when `viewer.role === 'contractor'` (ADR-0005 — a Customer's send never depends on their Contractor's subscription)
- [x] 2.5 Notify the other side from `sendMessage` via the existing `notification` table: a customer message notifies `order.contractorId`; a contractor reply notifies the linked Customer's `userId`, skipped without error when the Customer is Unlinked
- [x] 2.6 Implement `markThreadRead(orderId, viewer)` — one `UPDATE` over messages authored by the other side whose read column for this viewer is null
- [x] 2.7 Implement `unreadCountsForContractor(contractorId)` returning a map of `orderId → count` over `authorRole = 'customer' AND readByContractorAt IS NULL`, scoped to that Contractor's own Orders
- [x] 2.8 Write `src/lib/server/messaging.server.test.ts` covering: authorization refusals for a contractor who does not own the Order and a customer not linked to it, empty-body refusal, ascending order, own-message-never-unread, one side reading not clearing the other, unlinked-customer send succeeding without a notification, and the lapsed-contractor asymmetry (customer send succeeds, contractor reply refused)

## 3. View-as plumbing

- [x] 3.1 Add `CUSTOMER_PORTAL_DEV_TOOLS` to `.env.schema` as `@optional`, defaulting empty, with the same MUST-stay-off-in-production wording as `EMAIL_DEV_TOOLS` / `ID_SCAN_DEV_TOOLS`; regenerate `env.d.ts`
- [x] 3.2 Add `isViewAsEnabled()` to a new `src/lib/server/view-as.server.ts`, reading through varlock's typed `ENV` (undeclared vars are treated as sensitive and get leak-scanned)
- [x] 3.3 Implement `resolveViewAs(event)` in the same module: return null and **clear the `dev_view_as` cookie** when the flag is off; otherwise return `{ customerId, customerName }` only when the signed-in user is a contractor and owns the named Customer, re-checked against the database on this request
- [x] 3.4 Add `viewAs?: { customerId: string; customerName: string }` to `App.Locals` in `src/app.d.ts`
- [x] 3.5 Wire `resolveViewAs` into `src/hooks.server.ts` after the session is resolved; leave `locals.user` and `session.user.role` untouched
- [x] 3.6 Add `setViewAs` / `clearViewAs` form actions that set and delete the cookie and redirect to the portal / back to `/contractor`, refusing when the flag is off or the Customer is not owned
- [x] 3.7 Write `src/lib/server/view-as.server.test.ts`: flag off clears a stale cookie, non-contractor is refused, another Contractor's customer id is refused, owned customer resolves

## 4. Customer portal shell

- [x] 4.1 Create `src/routes/customer/+layout.server.ts`: resolve the portal subject as `locals.viewAs?.customerId ?? <customer linked to locals.user>`, redirect signed-out visitors to `/login`, and load the Order list (id, project name, customer-visible state via `getVisibleCustomerState`, active/past split, unread count for the customer side)
- [x] 4.2 Create `src/routes/customer/+layout.svelte`: shell using the shared design tokens (`--surface`, `--fg`, `--line`, …) with no hardcoded color literals, dark-theme support via `theme.sync()`, and the shared `Toaster` mounted
- [x] 4.3 Build the order rail in the layout — active work above, past work behind a disclosure — with the current Order marked, collapsing to a mobile-friendly control at small widths
- [x] 4.4 Render the impersonation banner in the layout whenever `data.viewAs` is set: names the Customer and offers a single exit action
- [x] 4.5 Rewrite `src/routes/customer/+page.server.ts` to redirect to the most recently updated Order, or return the empty state when the Customer has none; delete the old single-page load
- [x] 4.6 Rewrite `src/routes/customer/+page.svelte` as the empty state only ("your contractor hasn't started an order yet"), with no order rail rendered
- [x] 4.7 Move invite-token binding (`bindInviteToken` / `bindCustomerByEmail`) into the layout load so it still runs on arrival at any portal URL, preserving the `CustomerAlreadyLinkedError` handling

## 5. Customer order detail

- [x] 5.1 Create `src/routes/customer/orders/[id]/+page.server.ts`: load the Order for the portal subject, 404 when it is not theirs, read the timeline filtered on `internal = false` **in the query**, read the thread via `getThread`, and call `markThreadRead` for the customer viewer
- [x] 5.2 Create `src/routes/customer/orders/[id]/+page.svelte`: project name as the heading, customer-visible status secondary, timeline newest-first, thread oldest-first with author attribution ("You" vs the contractor's business name)
- [x] 5.3 Add the `sendMessage` form action, refusing the send when `locals.viewAs` is set and returning the reason
- [x] 5.4 Render the composer disabled with a visible explanation while viewing-as, rather than hiding it
- [x] 5.5 Delete `addCustomerRequest` from `src/lib/server/crm.server.ts` and the question/service/issue form, in this same change so no build ships with both paths
- [x] 5.6 Replace `getCustomerPortal` in `crm.server.ts` with the per-Order reads the new routes need, and remove the now-unused `CustomerPortal` type
- [x] 5.7 Update `src/lib/crm.test.ts` and any other tests that referenced the removed functions

## 6. Contractor side

- [x] 6.1 Add a Messages panel to `src/routes/contractor/orders/[id]/+page.svelte` showing the thread and a reply composer, distinct from the timeline
- [x] 6.2 Add the reply action to `src/routes/contractor/orders/[id]/+page.server.ts` via `sendMessage` with a contractor viewer, and call `markThreadRead` in the load
- [x] 6.3 Disable the composer with an explanation when the Order's Customer is Unlinked ("invite <name> to their portal first") — resolves the first Open Question in design.md
- [x] 6.4 Surface unread counts on `src/routes/contractor/orders/+page.server.ts` / `+page.svelte` using `unreadCountsForContractor`
- [x] 6.5 Add the view-as control to `src/routes/contractor/+layout.svelte`, rendered only when the flag is on, listing that Contractor's own Customers and posting to `setViewAs`
- [x] 6.6 Expose `viewAsEnabled` and the Customer list from `src/routes/contractor/+layout.server.ts`, gated on the flag so nothing is sent to the browser when it is off

## 7. Documentation

- [x] 7.1 Add **Message**, **Thread**, and a pinned definition of **Portal** to `CONTEXT.md`'s Language section, and the Order↔Thread relationship to Relationships
- [x] 7.2 Note in `CONTEXT.md` that Message is distinct from a Timeline entry — what was said about the job vs what happened to it
- [x] 7.3 Write `docs/adr/0008-view-as-is-a-development-affordance.md`: dev-flag-only, write-refused, never mutates role, and turning it into support tooling requires its own change with audit logging and consent
- [x] 7.4 Document the `CUSTOMER_PORTAL_DEV_TOOLS` workflow in the README or Makefile alongside `SEED_DEV_LOGIN`

## 9. Portal rework (mobile-first, quick actions, support)

- [x] 9.1 Rebuild `src/routes/customer/+layout.svelte` mobile-first: phone layout as the base, `min-width` breakpoints only, no `max-width` corrections
- [x] 9.2 App name in the leading nav position with a **Customer** view badge; add the matching **Contractor** badge to the contractor nav
- [x] 9.3 Collapse the user's name, sign-out, theme toggle and project nav behind a hamburger on small screens, matching the contractor bar's structure
- [x] 9.4 Give the portal its own `--accent` (teal) against the contractor's safety yellow, defined on the shell so dark mode needs nothing extra
- [x] 9.5 Add a `topic` column to `order_message` + migration; `MESSAGE_TOPICS`, `normalizeMessageTopic` and `CUSTOMER_QUICK_ACTIONS` in `src/lib/crm.ts`
- [x] 9.6 Thread the topic through `sendMessage`: customer-set only, `general` on every reply, high notification priority for a reported problem
- [x] 9.7 Replace the bare composer with quick actions (Ask a question / Make a payment / Scheduling / Report a problem); state on screen that payment is handled by the contractor, not the app
- [x] 9.8 Show the topic on the contractor's Messages panel so a thread can be triaged without opening it
- [x] 9.9 Add `surface` to `Feedback`, set by the route and never read from the form; carry it into the issue title, body and a `from:<surface>` label
- [x] 9.10 Add `/customer/support` mirroring the contractor form, tagged `from:customer`, refusing submission while viewing-as, and pointing project questions back at the contractor
- [x] 9.11 44px minimum targets and 16px+ text inputs throughout the portal, so iOS does not zoom on focus

## 10. Portal polish pass

- [x] 10.1 Rewrite `/customer/support` as a structural twin of the contractor form — same segmented type control, same fields, same wording — substituting `--accent` for `--yellow`; drop the extra explanatory copy
- [x] 10.2 Make the mobile nav an absolutely-positioned overlay that tweens over the page, matching the contractor bar, instead of an inline block that shoves content down
- [x] 10.3 Lead the order page with the single latest update; collapse earlier ones behind a counted drill-down
- [x] 10.4 Add a Project details panel (status, type, contractor, started)
- [x] 10.5 Strip the "Get in touch" description text; demote quick actions to plain chips below the update and details; move the thread to the bottom and hide it when empty

## 11. Dashboard pass

- [x] 11.1 Replace the hazard-yellow view-as banner with a compact chip in the nav — same marker, same one-tap exit, no band across every page
- [x] 11.2 Add `CUSTOMER_PROGRESS_STEPS` / `customerProgress` to `src/lib/crm.ts`, with Cancelled and On Hold reported as off-path rather than as steps
- [x] 11.3 Build the hero: accent-gradient panel carrying status, the progress track, and the latest update, visually dominant over the plain cards
- [x] 11.4 Add `timelineKindIcon` and use it on both the hero update and the earlier-updates list
- [x] 11.5 Delete the Project details card — status is in the hero, the rest was noise
- [x] 11.6 Move the whole contact surface behind a floating button into a bottom sheet (centred dialog at ≥48rem), reclaiming the page for the job
- [x] 11.7 Unit-test `customerProgress`, `normalizeMessageTopic`, `messageTopicLabel` and the quick-action table

## 12. Theme + polish pass

- [x] 12.1 Neutralize app.css's global bare-`h1` yellow-highlight treatment for the whole portal shell, so no page has to remember to opt out
- [x] 12.2 Move the hero onto `--hero-*` tokens; give dark a deep tinted surface with accent detailing rather than an inverted copy of the light accent slab
- [x] 12.3 Rebuild the stepper as one rail with a percentage fill and dots on top — ticks on completed steps, a ring on the current one — instead of per-step pseudo-element connectors
- [x] 12.4 Rebuild the earlier-updates list as a timeline rail with nodes, relative dates, and kind-colored icons (issue red, milestone accent)

## 13. Customer documents + hero fixes

- [x] 13.1 Redraw the stepper connectors per gap, inset clear of each dot, so the rule never crosses a completed circle
- [x] 13.2 Strip the latest-update panel back to a rule and text — no inset box, no icon chip
- [x] 13.3 Remove the portal footer line
- [x] 13.4 Add `uploadedByRole` to `attachment` + migration, defaulting to `contractor` so existing rows keep their meaning
- [x] 13.5 Add `listPortalAttachments` / `addPortalAttachment` / `getPortalAttachment`, scoped by `PortalSubject` and NOT billing-guarded (ADR-0005); notify the contractor on upload
- [x] 13.6 Add a Documents card to the order page: list of sent files with type badge, size and age, plus an upload control; refused under view-as
- [x] 13.7 Add `/customer/orders/[id]/attachment/[attachmentId]` serving only the customer's own uploads
- [x] 13.8 Show a "From <customer>" chip on the contractor's file list for anything they did not upload
- [x] 13.9 Add the new portal paths to the billing-guard safety net

## 14. Upload confirm step

- [x] 14.1 Replace send-on-pick with a confirm step: thumbnail (or type badge), original name, size, and a Cancel
- [x] 14.2 Let the customer name the document; keep the extension outside the field so a rename can never drop it
- [x] 14.3 Add `splitFilename` / `safeFilename` to `src/lib/crm.ts` and use them server-side — the name reaches a Content-Disposition header, so it is sanitized there, not in the browser
- [x] 14.4 Client-side type and size pre-check so a doomed upload never leaves the browser; server still re-checks
- [x] 14.5 Simplify the trigger to a single accent-outline "+ Add document" pill and drop the "Photos, permits, receipts" hint
- [x] 14.6 Unit-test the filename helpers, including path-escape and empty-name cases

## 15. Attachment viewing

- [x] 15.1 Extract `src/lib/AttachmentViewer.svelte` — one dismissible overlay (✕, backdrop, Escape), used by every surface that lists attachments
- [x] 15.2 Move the contractor's Files tab onto it too; no attachment anywhere is reached by navigating at its bytes
- [x] 15.6 Lock body scroll while the viewer is open, focus the close control, and restore focus to the opener on close
- [x] 15.7 Embed non-images best-effort with a visible open-in-new-tab beside it, so a blank preview is never a dead end
- [x] 15.3 Support `?dl` on the attachment route to force a save; wire the viewer's Download to it
- [x] 15.4 Show real thumbnails for image documents in the list, type badge for the rest
- [x] 15.5 Reduce the upload trigger to a single `+` beside the Documents heading

## 8. Verification

- [x] 8.1 `pnpm check` and `pnpm lint` clean
- [x] 8.2 `pnpm test` — full suite green, including the new messaging and view-as tests
- [x] 8.3 `openspec validate customer-portal --strict` passes
- [x] 8.4 Grep the portal routes for hardcoded color literals (`#d0d7de`, `#57606a`, `#f6f8fa`) and confirm none remain
- [x] 8.5 Confirm with the flag unset that no view-as markup, loader data, or cookie survives a request
- [ ] 8.6 Hand off to the user for browser review: dark mode, mobile widths, order rail, thread on both ends, and the view-as banner
