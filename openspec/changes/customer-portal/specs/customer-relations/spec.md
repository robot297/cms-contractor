## REMOVED Requirements

### Requirement: Two-Way Messaging

**Reason**: Superseded by the `order-messaging` capability, which owns this behavior in full and specifies what this requirement only asserted — the message entity, authorship, ordering, per-side unread state, notification of both sides, and the guarantee that a Lapsed Contractor never blocks their Customer's message. Keeping a second, vaguer statement of the same behavior in `customer-relations` leaves two specs disagreeing about what messaging is.

**Migration**: Read `order-messaging` instead. Every scenario previously stated here is carried there: "Contractor sends a message" → *Contractor replies from the order workspace*; "Customer sends a question or request" → *Customer sends a message on their order* plus *Both sides are notified of new messages*; the lapsed-contractor scenarios added by `contractor-billing` → *A lapsed contractor never blocks their customer's message*.

### Requirement: Customer Requests and Issue Reporting

**Reason**: The question / service-request / issue-report form is removed by this change. It was a send-only channel with no reply path, and its three-way taxonomy only ever set a notification priority. A single message thread replaces it, so a Customer asking a question and a Contractor answering are the same conversation rather than a request in one place and an answer outside the product.

**Migration**: Use the thread specified by `order-messaging` — *Customer sends a message on their order*. Notification of the Contractor is preserved by *Both sides are notified of new messages*; the at-a-glance signal previously carried by the issue priority is preserved by *Unread messages are surfaced on the order list*. Existing timeline entries written by the old form are left in place unchanged.

### Requirement: Customer Order Visibility

**Reason**: Superseded by the `customer-portal` capability, which specifies the portal surface concretely — order navigation, project-led detail, customer-visible status labels, and the exclusion of internal timeline entries — where this requirement only asserted that a Customer can see "their active order".

**Migration**: Read `customer-portal` instead: *Customer navigates their own orders*, *Order detail leads with the project*, *Portal shows customer-facing status only*, and *Portal timeline excludes internal entries*. The billing-independence guarantee stated here by `contractor-billing` is carried over intact as *The contractor's billing state is invisible in the portal*.

### Requirement: Customer Order History

**Reason**: Superseded by `customer-portal`. This change replaces the flattened non-navigable list of prior orders with real navigation in which every Order — active or not — is addressable and readable at its own route, so history is no longer a separate concept from the rest of the portal.

**Migration**: Read `customer-portal`: *Portal shows a customer's order history*, together with *Customer navigates their own orders*.
