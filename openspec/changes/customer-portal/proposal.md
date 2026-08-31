## Why

The Customer portal is the half of the product a Contractor's customers actually see, and it is the least finished surface we have: one 127-line page of inline styles, no dark mode, no navigation, a single "active order" with everything else flattened into a list, and a send-only request form that gives the Customer no way to hear back inside the app. Meanwhile `customer-relations` has claimed **Two-Way Messaging** as a requirement since the beginning without it ever being built — a Customer sends a question and the Contractor's only reply channel is email, outside the record.

We also have no way to look at the portal while building it. Every other role's surface is reachable from a local dev login; the Customer's is not, because seeing it means owning a Customer login bound to a real Customer record. That friction is why the portal has stayed unfinished.

## What Changes

- **Portal shell**: the Customer portal gets a real layout — header, order navigation, the app's design tokens, dark mode, and the shared `Toaster` — matching the standard set by the Contractor and Subcontractor surfaces. It replaces the current single-page inline-styled placeholder.
- **Order navigation**: a Customer with more than one Order can move between them. Each Order gets its own addressable route (`/customer/orders/[id]`) instead of only the most-recently-updated one being viewable.
- **Project detail**: an Order's page leads with its project name (customer-visible status secondary), and shows the customer-visible timeline for that Order — never internal notes.
- **Two-way messaging** _(new capability)_: a per-Order message thread. The Customer writes a message; the Contractor replies from the Order workspace; both see the same thread in order. Each side is notified of the other's messages, and unread counts surface on the Contractor's Order list. This **replaces** today's one-shot question/service/issue request form.
- **Dev-only "view as customer"**: behind a new `CUSTOMER_PORTAL_DEV_TOOLS` flag (off by default, mirroring `EMAIL_DEV_TOOLS` / `ID_SCAN_DEV_TOOLS`), a Contractor can open any of _their own_ Customers' portals as that Customer would see it, without changing session. A persistent banner marks the impersonated view and offers an exit. Every write made while viewing-as is refused.

Out of scope (deferred): shared documents and downloads in the portal (owned by the `customer-documents` change), a contractor contact card, the invite-acceptance landing experience, email delivery of message notifications (in-app notification only; `email-delivery` can carry it later), and message attachments.

## Capabilities

### New Capabilities

- `customer-portal`: The Customer-facing surface — portal shell, navigation across a Customer's own Orders, per-Order project detail and customer-visible timeline, and the dev-only view-as switch that makes the surface reachable during local development.
- `order-messaging`: A two-way message thread on an Order, shared by the Customer portal and the Contractor's Order workspace, including authorship, ordering, unread state, and notification on both sides.

### Modified Capabilities

- `customer-relations`: Four requirements are **removed** as superseded, so each behavior has exactly one spec that owns it — **Two-Way Messaging** and **Customer Requests and Issue Reporting** move to `order-messaging`; **Customer Order Visibility** and **Customer Order History** move to `customer-portal`. The billing-independence guarantees the in-flight `contractor-billing` change attaches to those requirements are carried across intact rather than dropped.

## Impact

- **Data model** (`src/lib/server/db/schema.ts`, `drizzle/`): a new `order_message` table (orderId, authorRole, authorUserId, body, readAt/read flags, createdAt) plus a migration. `timeline_entry` keeps its existing meaning — messages stop being written into it.
- **Server logic**: a new `src/lib/server/messaging.server.ts` for thread reads, sends, and read-marking on both sides; `crm.server.ts`'s `getCustomerPortal` / `addCustomerRequest` are replaced by per-Order portal reads and the messaging module.
- **Routes**: new `src/routes/customer/+layout.svelte` / `+layout.server.ts` (shell + order nav), `src/routes/customer/orders/[id]/`, rewritten `src/routes/customer/+page.*`; a reply surface and unread badge on `src/routes/contractor/orders/[id]/` and the Order list.
- **Impersonation**: a dev-only view-as mechanism in `src/hooks.server.ts` / `App.Locals` plus a control in the Contractor layout, gated server-side by the flag and by ownership of the target Customer.
- **Config** (`.env.schema`, `env.d.ts`): new `CUSTOMER_PORTAL_DEV_TOOLS` flag, documented as MUST-stay-off-in-production alongside the existing dev tools.
- **Domain** (`CONTEXT.md`): **Message** and **Thread** enter the ubiquitous language; the portal's relationship to Orders is stated. A new ADR records that view-as is a development affordance, not an admin feature.
- **Billing**: unaffected by design — a Lapsed Contractor's Customers keep full portal access including sending messages ([ADR-0005](../../../docs/adr/0005-lapsing-never-reaches-customers.md)); only the Contractor's own reply is gated by the billing guard.
