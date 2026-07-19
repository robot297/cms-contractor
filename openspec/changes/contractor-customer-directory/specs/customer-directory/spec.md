## ADDED Requirements

### Requirement: Customer record entity

The system SHALL represent a customer as a first-class record that exists independently of any order. A customer record SHALL be scoped to a single contractor, SHALL carry a display name and an email, and MAY link to at most one user account (`user` with `role=customer`). The email SHALL be required, and two customer records belonging to the same contractor SHALL NOT share the same email.

#### Scenario: Customer exists without an order

- **WHEN** a contractor has a customer record but no orders reference it
- **THEN** the customer record persists and remains retrievable in that contractor's directory

#### Scenario: Customer record is scoped to its contractor

- **WHEN** contractor A requests a customer record created by contractor B
- **THEN** the system does not return it to contractor A

#### Scenario: Email is required

- **WHEN** a contractor attempts to create a customer without an email
- **THEN** the system rejects the creation and reports that email is required

#### Scenario: Duplicate email is rejected

- **WHEN** a contractor attempts to create a customer with an email that already exists among that contractor's customers
- **THEN** the system rejects the creation and reports a duplicate-email error

### Requirement: Contractor views their customer directory

The system SHALL provide a contractor-only route that lists all non-archived customer records belonging to the signed-in contractor, regardless of whether any order references them and regardless of order state. The directory SHALL be reachable from the contractor's main navigation. The directory's only source is customers the contractor created — it SHALL NOT surface customers of other contractors or self-registered accounts.

#### Scenario: Directory lists all customers regardless of order state

- **WHEN** a contractor with customers across various order states (including customers with no order) opens the directory
- **THEN** every one of that contractor's non-archived customers is listed

#### Scenario: Empty directory guides the contractor

- **WHEN** a contractor with no customers opens the directory
- **THEN** the system shows an empty state that prompts the contractor to add a customer

#### Scenario: Only the contractor's own customers appear

- **WHEN** a contractor opens the directory
- **THEN** the list contains only customers scoped to that contractor and no customers of other contractors

### Requirement: Contractor searches the directory

The system SHALL allow a contractor to filter the directory by a search term matching a customer's name or email.

#### Scenario: Search narrows the list

- **WHEN** a contractor enters a search term that matches some customers by name or email
- **THEN** only matching customers are shown

#### Scenario: Search with no matches

- **WHEN** a contractor enters a search term matching no customers
- **THEN** the system shows a no-results state rather than the full list

### Requirement: Contractor adds a new customer

The system SHALL allow a contractor to create a new customer record from the directory by providing a name and email. The new record SHALL be scoped to that contractor and SHALL appear in the directory immediately. Customers do not self-register; a customer record only ever exists because a contractor created it.

#### Scenario: Successful add

- **WHEN** a contractor submits a valid name and email for a new customer
- **THEN** the system creates the customer record and it appears in that contractor's directory

#### Scenario: Missing required fields

- **WHEN** a contractor submits the add-customer form without a name or without an email
- **THEN** the system rejects the submission and reports which field is required

### Requirement: Contractor reuses an existing customer on a new order

The system SHALL allow a contractor, when creating an order, to select one of their own existing customer records instead of re-entering the customer's details. Selection is reuse of the contractor's own directory (a repeat customer); it SHALL NOT expose customers belonging to other contractors.

#### Scenario: Reuse an existing customer

- **WHEN** a contractor creating an order selects an existing customer from their directory
- **THEN** the order is linked to that customer record and no duplicate record is created

#### Scenario: Selection is limited to the contractor's own customers

- **WHEN** a contractor views selectable customers during order creation
- **THEN** only that contractor's own customers are offered

### Requirement: Invite acceptance binds a user to a customer by token

The system SHALL let a contractor send an invite (magic link) to a customer. When the invite is accepted, the system SHALL bind the accepting user to the specific customer record identified by the invite's token, regardless of which email or provider the user authenticates with; an email match SHALL be used only as a fallback when no token is present. A user SHALL link to at most one customer per contractor.

#### Scenario: Token binds regardless of authenticating email

- **WHEN** an invited customer accepts their invite link and authenticates with an email different from the invited email
- **THEN** the system binds the resulting user to the customer record referenced by the invite token

#### Scenario: A user cannot link to two customers of the same contractor

- **WHEN** a user who is already linked to one of a contractor's customers accepts an invite that would link them to a second customer of that same contractor
- **THEN** the system refuses to create the second link

#### Scenario: Linked customer becomes reachable for updates

- **WHEN** a customer record is linked to a user and its order is updated
- **THEN** the system delivers the update notification to that user

### Requirement: Customer email is frozen once linked

The system SHALL allow editing a customer's email only while the customer is unlinked (no accepted invite). Editing the email of an unlinked customer SHALL revoke any pending invite for that customer so a stale magic link cannot bind. Once a customer is linked to a user, its email SHALL be read-only.

#### Scenario: Edit email while unlinked revokes pending invite

- **WHEN** a contractor edits the email of an unlinked customer that has a pending invite
- **THEN** the system updates the email and revokes the pending invite

#### Scenario: Linked customer email cannot be edited

- **WHEN** a contractor attempts to change the email of a customer already linked to a user
- **THEN** the system rejects the change

### Requirement: Customer deletion is a soft-archive

The system SHALL soft-archive a customer rather than hard-deleting it when the customer has any orders. An archived customer SHALL be excluded from the directory and from order-time selection, while orders SHALL continue to reference it so history is preserved. A hard delete SHALL be permitted only for a customer with no orders and no linked user.

#### Scenario: Archive a customer with orders

- **WHEN** a contractor deletes a customer that has one or more orders
- **THEN** the system archives the customer, removes it from the directory and selection, and leaves its orders intact and still referencing it

#### Scenario: Hard delete only when unreferenced

- **WHEN** a contractor deletes a customer that has no orders and no linked user
- **THEN** the system removes the customer record entirely

### Requirement: Orders link to a customer record as the single source of truth

The system SHALL let a contractor associate an order with a customer record by selecting an existing customer or creating one inline during order creation. The linked customer record SHALL be the single source of truth for the order's customer name and email; the system SHALL NOT maintain a separate denormalized copy of name/email on the order.

#### Scenario: Create order for an existing customer

- **WHEN** a contractor creates an order and selects a customer from the directory
- **THEN** the order is linked to that customer record and its customer name/email are read through that record

#### Scenario: Create order with an inline new customer

- **WHEN** a contractor creates an order and enters a new customer inline
- **THEN** the system creates the customer record in the contractor's directory (or reuses the existing one on duplicate email) and links the order to it
