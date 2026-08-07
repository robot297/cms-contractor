## Why

A contractor who signs in today sees no customers — even ones who have created accounts. Customers have no independent existence in the system: they exist only as denormalized `customerName`/`customerEmail` fields on an `order`, or as a `user` row that becomes visible only after an order links it. There is no customers table, no query that lists a contractor's customers, and no directory route. So a contractor with no orders (or whose orders have moved past the three "follow-up" states) lands on an empty screen and cannot start work. This change gives contractors a first-class customer directory — the foundation the contractor view depends on before order templates and document sharing can be built on top of it.

## What Changes

- Introduce a **first-class customer entity** (a customer/contact record) so a customer can exist independently of any order.
- Add a **contractor customer directory**: a route where a contractor sees all of their customers, searchable, regardless of order state.
- Add **"add a new customer"**: a contractor creates a customer record directly (name, email, optional details) from the directory.
- Add **"select an existing customer"**: on a new order, the contractor reuses one of their own existing customer records (a repeat customer) instead of re-typing the person. This is reuse within the contractor's own directory — never discovery of other contractors' customers or self-registered accounts.
- The directory has **exactly one source: customer records the contractor created.** Customers never self-register; a contractor creates the record, then sends an invite/magic link.
- **Invite/link binding**: accepting an invite binds the accepting user to that specific customer via the invite **token** (email match is a fallback). A user may link to at most one customer per contractor. A customer's email is editable only while unlinked (editing revokes pending invites); once linked it is read-only.
- Link orders to a customer record: order creation selects a customer from the directory (or creates one inline). The customer record is the single source of truth for name/email — the denormalized `order.customerName`/`customerEmail` columns are removed.
- Customer deletion is a **soft-archive** (drops out of directory/select, orders keep referencing it); hard delete only when a customer has no orders and no link.

Out of scope (deliberate, deferred to follow-on proposals): order/update **templates**, document **upload and send**, and back-filling the directory from customers referenced only on pre-existing orders.

## Capabilities

### New Capabilities
- `customer-directory`: A contractor-scoped directory of customer records — listing/searching customers, adding a new customer, selecting/attaching an existing signed-in or invited customer, and the customer record entity that orders and invites link to.

### Modified Capabilities
<!-- No existing specs are published under openspec/specs/ yet; order/invite behavior changes are captured within the new customer-directory capability and its design. -->

## Impact

- **Data model** (`src/lib/server/db/schema.ts`): new `customer` table (contractor-scoped) plus a link from `order` and `customerInvite` to it; migration in `drizzle/`.
- **Server logic** (`src/lib/server/crm.server.ts`): new customer operations (`listCustomers`, `createCustomer`, edit/soft-archive helpers); `createOrder` selects/creates a customer and no longer writes denormalized name/email; invite acceptance binds the user to a customer by **token** (replacing the email-only `linkCustomerByEmail` path) with a one-user-per-customer-per-contractor guard.
- **Domain** (`src/lib/crm.ts`): customer-related types/helpers.
- **Routes** (`src/routes/contractor/`): new directory route (e.g. `contractor/customers`) with load + add/select actions; the new-order form updated to pick a customer.
- **Auth/roles**: relies on existing `role=customer` accounts (`src/lib/server/auth.ts`, `src/hooks.server.ts`) to identify signed-in customers; no auth changes.
- **Tests**: extends `src/lib/crm.test.ts`, `src/lib/customer-invites.test.ts`, and adds coverage for customer directory logic.
