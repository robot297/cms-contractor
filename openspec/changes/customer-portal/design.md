## Context

Three surfaces exist today. The Contractor app (`/contractor`) has a full layout: nav, theme toggle, account menu, billing chrome, `Toaster`. The Subcontractor portal (`/subcontractor`, `/subcontractor/[id]`) has a list route and a per-Order detail route, server-side tier redaction, and write-back. The Customer portal is one route — `/customer/+page.svelte`, 127 lines of hardcoded `#d0d7de` / `#57606a` inline styles, no layout, no dark mode, no `Toaster`. It renders exactly one "active" Order (`rows.find(isActiveState)`) with every other Order flattened into a non-navigable list.

Its write path is `addCustomerRequest(orderId, user, type, detail)`: the Customer picks question / service / issue, the text lands as a `timeline_entry` with `authorRole: 'customer'`, and a `notification` row goes to the Contractor. The Contractor sees it in the Order timeline. There is no reply path — the Contractor's only response is email, which leaves the record entirely.

The constraint that has kept this unfinished is reachability: the Contractor portal is one `SEED_DEV_LOGIN=true` away, the Subcontractor portal is reachable by seeding, and the Customer portal requires a Customer-role login bound to a real `customer` row by `userId`. That is several minutes of setup per look, so nobody looks.

Three existing decisions constrain the design. [ADR-0002](../../../docs/adr/0002-one-role-per-user.md): a User holds exactly one global role, so impersonation must not mutate `user.role`. [ADR-0005](../../../docs/adr/0005-lapsing-never-reaches-customers.md): a Lapsed Contractor's Customers keep full portal access, so no billing guard may sit on a Customer's send. `timeline_entry.internal` is the existing customer-visibility boundary and stays exactly as it is.

## Goals / Non-Goals

**Goals:**

- A Customer portal that looks like the rest of the app: shared tokens, dark mode, `Toaster`, mobile-first.
- Every one of a Customer's Orders addressable and navigable, not just the most-recently-updated active one.
- A real two-way thread per Order, with one storage model serving both ends and both sides notified.
- The portal reachable in one click during local development, with a guard strong enough that shipping the flag on by accident is not catastrophic in itself.

**Non-Goals:**

- Documents in the portal — `customer-documents` owns upload, sharing, and download.
- Contractor contact card, invite-acceptance landing polish, message attachments, typing indicators, read receipts shown to the other party.
- Email delivery of message notifications. In-app `notification` rows only; wiring them to `email-delivery` is a later change.
- Real-time push. Threads refresh on navigation and after a send.
- Any admin-facing impersonation. View-as is a development affordance and must never become a support tool without its own change (see ADR-0008).

## Decisions

### 1. A dedicated `order_message` table, not more `timeline_entry` rows

**Chosen:** a new table.

```
order_message
  id            text pk
  orderId       text not null → order.id  cascade
  authorRole    text not null              -- 'contractor' | 'customer'
  authorUserId  text not null → user.id    cascade
  body          text not null
  readByContractorAt  timestamp null
  readByCustomerAt    timestamp null
  createdAt     timestamp not null default now()
  index (orderId, createdAt)
```

**Alternative rejected:** keep writing messages as `timeline_entry` rows with `kind: 'message'`. Tempting because the plumbing exists, but the timeline is a *record of what happened to the job* — status changes, milestones, notes, photos — ordered newest-first and read as history. A conversation is a different object with different needs: it is ordered oldest-first, it has per-side unread state, and it wants an unread count. Bolting `readByContractorAt` onto `timeline_entry` would put conversation columns on every status change ever written, and "which timeline entries are actually messages" becomes a `kind` filter that any new `kind` value can silently break. Two concepts, two tables.

`timeline_entry` keeps its meaning untouched. Existing `kind: 'message'` rows stay as historical timeline records — they are not migrated into threads (see Migration Plan).

**Why `authorRole` *and* `authorUserId`:** the role is what the UI renders ("You" vs the Contractor's business name) and it must stay correct even if the User row is later reassigned; the user id is what makes authorship auditable and lets a future multi-Contractor firm attribute a reply. Denormalizing the role costs one column and removes a join from the hot read.

**Read state:** two nullable timestamps rather than a per-message `unread` boolean, because "unread" is asymmetric — the same row is read by its author the moment it is written and unread by the other side. Marking a thread read is one `UPDATE ... WHERE orderId = ? AND readByXAt IS NULL AND authorRole <> ?` on load. An unread count per Order is a `COUNT(*)` with the same predicate.

### 2. Messaging is its own server module, used by both ends

`src/lib/server/messaging.server.ts` owns the thread: `getThread(orderId, viewer)`, `sendMessage(orderId, viewer, body)`, `markThreadRead(orderId, viewer)`, `unreadCountsForContractor(contractorId)`.

`viewer` is a discriminated union — `{ role: 'contractor', userId }` or `{ role: 'customer', userId }` — and **every** function authorizes from it rather than trusting the caller. A Contractor viewer must own the Order (`order.contractorId = userId`); a Customer viewer must be linked to the Order's Customer (`customer.userId = userId`). This mirrors how `subcontractor.server.ts` scopes by assignment, and it means the two routes cannot drift into different access rules.

`crm.server.ts`'s `addCustomerRequest` is deleted, not kept alongside. Two ways to say something to your Contractor is one too many, and leaving the old form in place means the Contractor has two inboxes.

**Notification on send** reuses the existing `notification` table and `createNotification` helper — no new mechanism. A Customer's message notifies `order.contractorId`; a Contractor's reply notifies the linked Customer's `userId` (skipped when the Customer is Unlinked, which cannot happen on a Customer-initiated thread but can on a Contractor-initiated one).

**Billing:** `sendMessage` applies the billing write guard **only** when `viewer.role === 'contractor'`. ADR-0005 is explicit that lapsing never reaches Customers, and a portal that silently swallows a Customer's question because their Contractor's card failed is precisely the hostage-taking that ADR forbids.

### 3. Portal shape: a layout with an order rail, and per-Order routes

```
/customer                    → redirect to the most recently updated order,
                               or the empty state when there are none
/customer/orders/[id]        → project detail + timeline + thread
```

with `+layout.server.ts` loading the Customer's Order list once (id, project name, customer-visible state, unread count) and `+layout.svelte` rendering the shell and the order rail.

**Alternative rejected:** keep one page and switch Orders client-side. It costs a route but loses addressability — a Contractor cannot send "here's your kitchen job" as a link, and the browser back button stops meaning anything. The Subcontractor portal already settled this question the same way (`/subcontractor` list, `/subcontractor/[id]` detail), so matching it also means one fewer pattern in the codebase.

**A Customer may be linked under several Contractors** (the same person, two Customer records, one User — see CONTEXT.md). The Order rail is therefore grouped by Contractor business name when there is more than one; the load reads across all Customer records for the User rather than picking one. The current implementation already queries `customer.userId = userId` unscoped, so this is preserved, not introduced.

**Status wording** stays `getVisibleCustomerState` — Pending / Scheduled / In Progress / Completed / Cancelled / On Hold. No contractor workflow terms reach the portal. **Timeline** stays filtered on `internal = false` at the query, never in the component.

**Leading with the project name** follows the established rule for order surfaces: project name is the heading, customer-visible status is secondary.

### 4. View-as: a signed dev cookie read in `hooks.server.ts`, never a role mutation

`CUSTOMER_PORTAL_DEV_TOOLS=true` (read through `ENV` from varlock, like `EMAIL_DEV_TOOLS` and `ID_SCAN_DEV_TOOLS`) enables a control in the Contractor layout listing that Contractor's own Customers. Choosing one sets a `dev_view_as` cookie holding a Customer id and redirects to that Customer's portal.

In `hooks.server.ts`, **after** the real session is resolved:

1. If the flag is off, the cookie is ignored **and cleared**. This is the load-bearing line: a build that ships with a stale cookie in someone's browser and the flag off behaves as if the feature does not exist.
2. Otherwise, if `locals.user.role === 'contractor'` and the cookie names a Customer that this Contractor owns, set `locals.viewAs = { customerId, customerName }`.
3. Ownership is re-checked **on every request**, not trusted from the cookie. A Contractor who archives or loses a Customer stops being able to view as them immediately.

`locals.user` is left alone throughout. The Customer portal's loaders resolve their subject as `locals.viewAs?.customerId ?? <customer linked to locals.user>`, so exactly one branch exists and the real path is the default. Per ADR-0002 a User holds one global role; mutating `session.user.role` to fake a Customer would violate that invariant in the session store and could leak into a real request.

**Every write is refused while viewing-as.** Sending a message as an impersonated Customer would write a `order_message` row that claims a Customer said something they did not. The send action returns a clear refusal, and the composer renders disabled with the reason visible — not silently missing, so the affordance is still reviewable.

**Alternative rejected:** a seeded Customer login (`SEED_DEV_LOGIN`-style). It exercises real auth end-to-end, which is genuinely better fidelity — but it needs a sign-out/sign-in round trip per look, which is the friction this decision exists to remove. It also only ever shows *one* seeded Customer's portal, when the thing usually worth checking is a specific real-looking Customer's data. Rejected for this change; nothing here forecloses adding it later.

**Alternative rejected:** a `?viewAs=` query parameter with no cookie. Simpler, but it falls off the moment the user navigates within the portal, and a parameter that silently grants another identity is easier to leave in a copied URL than a cookie is.

### 5. Domain language and ADR

`CONTEXT.md` gains **Message** (one entry in a Thread, authored by the Contractor or the Customer, always attached to one Order — distinct from a **Timeline** entry, which records what happened to the job rather than what someone said about it) and **Thread** (the ordered set of Messages on one Order; there is exactly one per Order and it is never deleted). **Portal** is already used loosely; this change pins it to "the surface a Customer or Subcontractor sees", explicitly not the Contractor app.

New **ADR-0008: view-as is a development affordance, not an admin feature** — records that impersonation exists only behind a dev flag, is write-refused, never mutates role, and that turning it into support tooling requires its own change with audit logging and consent as first-class concerns.

## Risks / Trade-offs

- **`CUSTOMER_PORTAL_DEV_TOOLS` ships enabled to production** → Layered: the flag defaults off and is absent from any deployed `.env`; enabling it only permits a Contractor to view *their own already-visible* Customers' data — never another Contractor's, and never anything the Contractor could not read from their own Order pages; all writes are refused; the impersonation banner is unmissable. The realistic damage of a leak is a confusing UI, not a data breach. Documented in `.env.schema` with the same MUST-stay-off-in-production wording as the existing dev tools.
- **Deleting `addCustomerRequest` drops the question / service / issue taxonomy** → That taxonomy only ever set a notification priority (`issue` → high) and a timeline title. Losing it means a Contractor no longer sees "Issue reported" at a glance. Mitigation: message notifications keep a single clear title (`New message from <customer>`) and the Order list unread badge does the at-a-glance work the priority flag was doing. If triage by type proves necessary it can return as a field on the message rather than as a separate form.
- **Two-way messaging invites a support-inbox expectation** the product does not meet — no search, no cross-order view, no email delivery → Accepted for this change and stated in Non-Goals. The Contractor's entry point is the unread badge on the Order, which keeps the conversation attached to the job rather than pretending to be an inbox.
- **Historical `kind: 'message'` timeline entries will look orphaned** — old customer requests stay in the timeline while new conversation lives in the thread, so an Order predating this change shows the question in one place and the reply in another → Accepted. Migrating them would need an author user id the timeline never stored. The volume is small (this is a pre-launch product) and the timeline entry remains truthful about what happened.
- **The Order rail grows unbounded** for a Customer with many past jobs → Group by active vs past and collapse past behind a disclosure; revisit only if a real Customer exceeds a screenful.
- **Unread counts add a query to the Contractor's Order list** → One grouped `COUNT(*)` over `order_message` filtered by `readByContractorAt IS NULL AND authorRole = 'customer'`, joined on the Contractor's own Orders, with the `(orderId, createdAt)` index. Not a scan; measurable if the Order list ever gets slow.

## Migration Plan

1. Add the `order_message` table via a new Drizzle migration. Additive only — nothing existing is altered or dropped, so the migration is safe to apply ahead of the code.
2. Ship the messaging module and both ends. **No data migration**: existing `kind: 'message'` timeline entries stay where they are (see Risks).
3. Remove `addCustomerRequest` and the request form in the same change that lands the thread, so there is never a build with both.
4. Add `CUSTOMER_PORTAL_DEV_TOOLS` to `.env.schema` as `@optional`, defaulting empty. Regenerate `env.d.ts`.
5. **Rollback:** the flag is independently revertible — unset it and view-as vanishes with no other effect. Reverting messaging means reverting the routes; the `order_message` table can be left in place empty and harmless.

## Open Questions

- Should a Contractor be able to *start* a thread on an Order whose Customer is Unlinked (no portal login yet)? The design permits the write and skips the notification, but the message is then invisible until the Customer accepts an Invite. Leaning toward disabling the composer with "invite <name> to their portal first", which is a smaller decision to make during implementation.
- Does the Order rail need a Contractor grouping header in v1, or only once a real Customer is linked under two Contractors? Cheap to add, and cheap to defer — decide when the rail is built.
