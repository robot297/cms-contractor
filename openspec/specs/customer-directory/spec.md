# customer-directory Specification

## Purpose

Give contractors a customer directory in which a customer is a first-class record that exists independently of any order. The capability covers creating, viewing, searching, editing, and archiving customer records scoped to a single contractor; reusing an existing customer when creating a new order; and binding an invited customer to a user account by invite token. The directory record is the single source of truth for a customer's name and email — orders link to it rather than carrying their own copies.

## Requirements

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

### Requirement: Customer contact details

A customer record SHALL support optional contact and organization details in addition to name and email: phone, address, and free-form notes (project details). Contact fields SHALL be validated by a shared schema used on both client and server; when a phone number is provided it SHALL contain ten digits and be stored in a normalized display format.

#### Scenario: Optional details are saved

- **WHEN** a contractor provides phone, address, or notes for a customer
- **THEN** the system saves those details with the customer record

#### Scenario: Invalid phone is rejected

- **WHEN** a contractor submits a phone number that does not contain ten digits
- **THEN** the system rejects the submission and reports an invalid-phone error

#### Scenario: Details are optional

- **WHEN** a contractor provides only a valid name and email
- **THEN** the system creates the customer with no phone, address, or notes

### Requirement: Contractor views one directory of people

The system SHALL provide a single contractor-only route (`/contractor/people`) that lists everyone the signed-in contractor knows — customers, crew and subcontractors — regardless of whether any order references them and regardless of order state. The directory SHALL be reachable from the contractor's main navigation, as its only people entry. Its only source is records the contractor created — it SHALL NOT surface other contractors' records or self-registered accounts.

A person's records SHALL be matched by email within one contractor, so that somebody who is both a customer and crew appears once, carrying every role they hold; a record with no email SHALL be its own person. Each role SHALL remain its own record: adding a role creates that record from the details on file, and removing one archives that record only.

#### Scenario: One person, several roles

- **WHEN** a contractor holds a customer record and a crew record with the same email
- **THEN** the directory lists that person once, showing both roles, and each role's record is reachable from that row

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

### Requirement: Archiving a customer is a reversible state change

Archiving a customer SHALL always be a soft-archive that updates the record's state; it SHALL NOT delete the record. An archived customer SHALL be excluded from the directory and from order-time selection, while the record and its orders are preserved. The contractor SHALL confirm the action before it takes effect.

#### Scenario: Archive updates state without deleting

- **WHEN** a contractor confirms archiving a customer
- **THEN** the system marks the customer archived, removes it from the directory and order-time selection, and preserves the record and any orders that reference it

#### Scenario: Archiving requires confirmation

- **WHEN** a contractor initiates archiving a customer
- **THEN** the system asks the contractor to confirm before the customer is archived

### Requirement: Orders link to a customer record as the single source of truth

The system SHALL let a contractor create an order for one of their existing directory customers, linking the order to that customer record. The linked customer record SHALL be the single source of truth for the order's customer name and email; the system SHALL NOT maintain a separate denormalized copy of name/email on the order. Contractors create customers in the directory, not inline during order creation.

#### Scenario: Create order for a directory customer

- **WHEN** a contractor creates an order for one of their directory customers
- **THEN** the order is linked to that customer record and its customer name/email are read through that record
