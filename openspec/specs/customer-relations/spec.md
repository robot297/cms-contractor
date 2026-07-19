# customer-relations Specification

## Purpose

Support a mobile-first contractor customer relations workflow that helps contractors manage client communication while giving customers a simple way to stay informed and request help. The capability lets contractors share invoices, order status, and updates quickly; lets customers see the current state of their own orders and recent activity; keeps communication lightweight and accessible on mobile; and notifies users when important updates occur across a long-running order lifecycle from inquiry to completion or cancellation.

## Requirements

### Requirement: Manage Customer-Facing Order Records

Contractors SHALL be able to create and manage customer-facing order records that represent customer relationships and their associated orders.

#### Scenario: Contractor creates an order record

- **WHEN** a contractor creates a new customer-facing order record
- **THEN** the system persists the order record and associates it with the customer

#### Scenario: Contractor manages an existing order record

- **WHEN** a contractor updates an existing order record
- **THEN** the system saves the changes and reflects them in the contractor and customer views

### Requirement: Share Invoices with Customers

Contractors SHALL be able to attach invoices to an order and share them with the associated customer.

#### Scenario: Contractor attaches and shares an invoice

- **WHEN** a contractor attaches an invoice to an order and shares it
- **THEN** the invoice becomes visible to the associated customer

### Requirement: Publish Order Status Updates

Contractors SHALL be able to publish order status updates that appear in the customer's recent activity.

#### Scenario: Contractor publishes a status update

- **WHEN** a contractor publishes an order status update
- **THEN** the update is recorded and appears in the customer's recent activity feed

### Requirement: Two-Way Messaging

Contractors and customers SHALL be able to send and receive messages with each other about an order.

#### Scenario: Contractor sends a message

- **WHEN** a contractor sends a message on an order
- **THEN** the customer can view the message on that order

#### Scenario: Customer sends a question or request

- **WHEN** a customer sends a question, service request, or issue report
- **THEN** the contractor receives the message and can respond

### Requirement: Quick Lifecycle State Updates

Contractors SHALL be able to update an order's lifecycle state through a quick action, supporting the following states: Inquiry, Quote Sent, Deposit Pending, Parts Ordered, Work Scheduled, In Progress, Final Payment Pending, Work Complete, Work Cancelled, and On Hold / Archived.

#### Scenario: Contractor changes order state via quick action

- **WHEN** a contractor uses the quick action to change an order's lifecycle state
- **THEN** the system records the new state and updates both contractor and customer views

#### Scenario: Customer sees human-friendly status labels

- **WHEN** a customer views an order's lifecycle state
- **THEN** the state is displayed using human-friendly status labels rather than internal contractor workflow terms

### Requirement: Customer Order Visibility

Customers SHALL be able to view the status of their own active order and its recent activity.

#### Scenario: Customer views active order

- **WHEN** a customer opens their portal
- **THEN** they see the status of their active order and its recent activity and milestone updates

### Requirement: Customer Requests and Issue Reporting

Customers SHALL be able to ask questions, request service, and report issues on their order.

#### Scenario: Customer submits a service request or issue

- **WHEN** a customer submits a question, service request, or issue report
- **THEN** the request is recorded on the order and surfaced to the contractor

### Requirement: Customer Order History

Customers SHALL be able to view a history of their prior orders alongside their active order.

#### Scenario: Customer reviews prior orders

- **WHEN** a customer views their portal
- **THEN** they can see a compact history of prior orders in addition to the active order

### Requirement: Milestone Notifications

The system SHALL send app-first notifications and email notifications for major order milestones.

#### Scenario: Milestone event triggers notifications

- **WHEN** a major order milestone occurs
- **THEN** the system sends an app-first notification and an email notification to the relevant user

### Requirement: Invitation-Based Customer Access

The system SHALL support invitation-based customer access using time-limited magic links.

#### Scenario: Customer accesses portal via magic link

- **WHEN** a customer follows a valid, unexpired invitation magic link
- **THEN** they are granted access to their customer portal

#### Scenario: Expired magic link is rejected

- **WHEN** a customer follows an expired invitation magic link
- **THEN** access is denied and they are prompted to request a new invitation

### Requirement: Mobile-First Accessible Experience

The interface SHALL be clean, simple, and accessible, prioritizing mobile-first usage so that core tasks are reachable in a small number of taps and communication feels direct and low-friction.

#### Scenario: User completes a core task on mobile

- **WHEN** a user performs a core task on a mobile device
- **THEN** the task is reachable in a small number of taps through an accessible, mobile-first interface
