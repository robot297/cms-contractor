## MODIFIED Requirements

### Requirement: Manage Customer-Facing Order Records

Contractors SHALL be able to create and manage customer-facing order records that represent customer relationships and their associated orders, provided their Subscription permits writing. A Lapsed Contractor SHALL retain full read access to every order record and SHALL be refused every creation and update. A Contractor within their Trial SHALL additionally be refused creation of a new record once the relevant Trial Limit is reached, while remaining able to update the records they already hold.

#### Scenario: Contractor creates an order record

- **WHEN** a contractor creates a new customer-facing order record
- **THEN** the system persists the order record and associates it with the customer

#### Scenario: Contractor manages an existing order record

- **WHEN** a contractor updates an existing order record
- **THEN** the system saves the changes and reflects them in the contractor and customer views

#### Scenario: Lapsed contractor is refused

- **WHEN** a Lapsed Contractor attempts to create or update an order record
- **THEN** the system refuses the write, presents an upgrade prompt, and leaves the existing record untouched and fully readable

#### Scenario: Trial contractor at the limit is refused creation only

- **WHEN** a Contractor within their Trial holding the maximum active Orders attempts to create another
- **THEN** the system refuses the creation, and still allows them to update every Order they already hold

### Requirement: Share Invoices with Customers

Contractors SHALL be able to attach invoices to an order and share them with the associated customer, provided their Subscription permits writing.

#### Scenario: Contractor attaches and shares an invoice

- **WHEN** a contractor attaches an invoice to an order and shares it
- **THEN** the invoice becomes visible to the associated customer

#### Scenario: Lapsed contractor cannot attach

- **WHEN** a Lapsed Contractor attempts to attach an invoice
- **THEN** the system refuses the upload, and every previously shared invoice remains visible to the customer and downloadable by the Contractor

### Requirement: Publish Order Status Updates

Contractors SHALL be able to publish order status updates that appear in the customer's recent activity, provided their Subscription permits writing.

#### Scenario: Contractor publishes a status update

- **WHEN** a contractor publishes an order status update
- **THEN** the update is recorded and appears in the customer's recent activity feed

#### Scenario: Lapsed contractor cannot publish

- **WHEN** a Lapsed Contractor attempts to publish a status update
- **THEN** the system refuses it and presents an upgrade prompt, leaving the existing timeline intact

### Requirement: Two-Way Messaging

Contractors and customers SHALL be able to send and receive messages with each other about an order. The Contractor's side SHALL require a Subscription that permits writing. The Customer's side SHALL NOT depend on the Contractor's Subscription in any way.

#### Scenario: Contractor sends a message

- **WHEN** a contractor sends a message on an order
- **THEN** the customer can view the message on that order

#### Scenario: Customer sends a question or request

- **WHEN** a customer sends a question, service request, or issue report
- **THEN** the contractor receives the message and can respond

#### Scenario: Lapsed contractor cannot send

- **WHEN** a Lapsed Contractor attempts to send a message
- **THEN** the system refuses it and presents an upgrade prompt

#### Scenario: Customer of a lapsed contractor can still send

- **WHEN** a Customer of a Lapsed Contractor sends a question, service request, or issue report
- **THEN** the system records it and notifies the Contractor exactly as it would for a paying Contractor

### Requirement: Quick Lifecycle State Updates

Contractors SHALL be able to update an order's lifecycle state through a quick action, supporting the following states: Inquiry, Quote Sent, Deposit Pending, Parts Ordered, Work Scheduled, In Progress, Final Payment Pending, Work Complete, Work Cancelled, and On Hold / Archived. The quick action SHALL require a Subscription that permits writing. These states describe money moving between a Contractor and their own Customer, which the system tracks as status only and never processes.

#### Scenario: Contractor changes order state via quick action

- **WHEN** a contractor uses the quick action to change an order's lifecycle state
- **THEN** the system records the new state and updates both contractor and customer views

#### Scenario: Customer sees human-friendly status labels

- **WHEN** a customer views an order's lifecycle state
- **THEN** the state is displayed using human-friendly status labels rather than internal contractor workflow terms

#### Scenario: Lapsed contractor cannot change state

- **WHEN** a Lapsed Contractor uses the quick action
- **THEN** the system refuses the change and presents an upgrade prompt

#### Scenario: Payment states move no money

- **WHEN** an Order enters Deposit Pending or Final Payment Pending
- **THEN** the system records a status only and initiates no payment, independently of the Contractor's own Subscription

### Requirement: Customer Order Visibility

Customers SHALL be able to view the status of their own active order and its recent activity. This SHALL NOT depend on the Contractor's Subscription: a Customer of a Lapsed Contractor SHALL see exactly what they saw before.

#### Scenario: Customer views active order

- **WHEN** a customer opens their portal
- **THEN** they see the status of their active order and its recent activity and milestone updates

#### Scenario: Contractor's billing state is invisible to the customer

- **WHEN** a Customer of a Lapsed Contractor opens their portal
- **THEN** the system shows their order in full and gives no indication of the Contractor's billing state

### Requirement: Invitation-Based Customer Access

The system SHALL support invitation-based customer access using time-limited magic links. Sending, resending, and revoking an Invite are Contractor writes and SHALL require a Subscription that permits writing. Invites already accepted SHALL continue to grant portal access regardless of the Contractor's Subscription.

#### Scenario: Customer accesses portal via magic link

- **WHEN** a customer follows a valid, unexpired invitation magic link
- **THEN** they are granted access to their customer portal

#### Scenario: Expired magic link is rejected

- **WHEN** a customer follows an expired invitation magic link
- **THEN** access is denied and they are prompted to request a new invitation

#### Scenario: Lapsed contractor cannot send new invites

- **WHEN** a Lapsed Contractor attempts to send, resend, or revoke an Invite
- **THEN** the system refuses it

#### Scenario: Existing portals survive lapsing

- **WHEN** a Contractor lapses
- **THEN** every Customer who had already accepted an Invite keeps working portal access
