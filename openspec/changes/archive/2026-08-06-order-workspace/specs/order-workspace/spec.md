## ADDED Requirements

### Requirement: Dedicated orders page

The system SHALL provide a contractor-only `/contractor/orders` page that lists the contractor's orders and hosts order creation. The contractor navigation SHALL link to it, and the dashboard SHALL NOT display the order list or the New Order control.

#### Scenario: Orders live on their own page

- **WHEN** a contractor opens `/contractor/orders`
- **THEN** their orders are listed and a New Order control is available

#### Scenario: Dashboard no longer hosts orders

- **WHEN** a contractor opens the dashboard
- **THEN** the order list and New Order control are not shown there (they are on the Orders page)

### Requirement: Orders carry a project name and type

An order SHALL have a project name and a project type. The project type SHALL be one of a fixed set of shelter options (Gazebo, Pavilion, Pergola, Carport, Pole Barn, Shed, Deck) or a free-text value when "Other" is chosen.

#### Scenario: Create an order with project details

- **WHEN** a contractor creates an order with a project name and a project type
- **THEN** the order is saved with that name and type and they are shown on the order

#### Scenario: Other project type accepts free text

- **WHEN** a contractor selects "Other" and enters a custom project type
- **THEN** the order stores the custom value as its project type

#### Scenario: Project name is required

- **WHEN** a contractor submits the New Order form without a project name
- **THEN** the system rejects it and reports that a project name is required

### Requirement: New order flow selects a customer

The New Order flow SHALL let a contractor choose which customer the order is for from a searchable list of their own customers, pre-filled when the flow is started from a known customer. The order SHALL link to the chosen customer record.

#### Scenario: Pick a customer for a new order

- **WHEN** a contractor creates an order and selects one of their customers
- **THEN** the order is linked to that customer

#### Scenario: Customer is pre-filled from context

- **WHEN** a contractor starts a new order from a specific customer
- **THEN** that customer is pre-selected in the New Order flow

### Requirement: Contractor-controlled follow-up scheduling

An order SHALL carry an optional next-follow-up date that the contractor sets, snoozes, or clears. When an order is created, its next-follow-up date SHALL default to three days from creation. The system SHALL NOT derive follow-up state automatically from the order's lifecycle state.

#### Scenario: New order defaults to a 3-day follow-up

- **WHEN** a contractor creates an order without specifying a follow-up date
- **THEN** the order's next-follow-up date is set to three days from creation

#### Scenario: Set a follow-up date

- **WHEN** a contractor sets a next-follow-up date on an order
- **THEN** the order stores that date as its next follow-up

#### Scenario: Snooze a follow-up

- **WHEN** a contractor snoozes an order's follow-up by a preset (+1 day, +3 days, +1 week) or a custom date
- **THEN** the order's next-follow-up date moves to the new date

#### Scenario: Clear a follow-up

- **WHEN** a contractor clears an order's follow-up
- **THEN** the order has no next-follow-up date and is not surfaced as due

### Requirement: Surface due follow-ups

The system SHALL identify orders whose next-follow-up date is due (on or before now) and present them as the contractor's follow-up view. Orders with no follow-up date or a future date SHALL NOT appear as due.

#### Scenario: A due order appears in the follow-up view

- **WHEN** an order's next-follow-up date is today or earlier
- **THEN** it appears in the contractor's due-follow-ups view

#### Scenario: A future or unset follow-up is not due

- **WHEN** an order's follow-up date is in the future or unset
- **THEN** it does not appear as due

### Requirement: Internal order notes

A contractor SHALL be able to add free-text notes to an order. Each note SHALL be stored with a timestamp and marked internal, and internal notes SHALL NOT appear in the customer portal or in customer notifications. A status change and a note are recorded separately: changing the state notifies the customer, while a note is contractor-only.

#### Scenario: A note is internal and timestamped

- **WHEN** a contractor adds a note to an order
- **THEN** the note is saved with a timestamp and is visible only to the contractor, never in the customer portal

#### Scenario: A note does not notify the customer

- **WHEN** a contractor adds a note without changing the order state
- **THEN** no customer-visible timeline entry or notification is created for that note

### Requirement: Remove the automatic needs-attention signal

The system SHALL NOT display a "needs attention / requires follow-up" indicator derived from the order's lifecycle state. Follow-up is expressed only through the contractor-set follow-up date.

#### Scenario: No automatic needs-attention badge

- **WHEN** a contractor views an order in any lifecycle state
- **THEN** no automatic "needs attention" badge is shown based on that state
