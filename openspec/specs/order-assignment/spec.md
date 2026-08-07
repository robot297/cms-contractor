# order-assignment Specification

## Purpose

Connect a contractor's orders to the subcontractors doing the work. Assignment is a many-to-many relationship between orders and subcontractors owned by the same contractor, and it is the mechanism that grants a subcontractor visibility into an order. Assignments are visible from both directions: an order lists its assigned subcontractors, and a subcontractor's profile lists the orders they are working.

## Requirements

### Requirement: Assign Subcontractors to an Order

A Contractor SHALL be able to assign one or more of their Subcontractors to one of their Orders, and unassign them. Assignment is many-to-many: an Order MAY have several assigned Subcontractors, and a Subcontractor MAY be assigned to several Orders. The system SHALL only allow assigning a Subcontractor and an Order that belong to the same Contractor.

#### Scenario: Contractor assigns a subcontractor to an order

- **WHEN** a Contractor assigns one of their Subcontractors to one of their Orders
- **THEN** the system records the Assignment and the Subcontractor appears on that Order's assigned list

#### Scenario: Contractor unassigns a subcontractor

- **WHEN** a Contractor unassigns a Subcontractor from an Order
- **THEN** the system removes the Assignment and the Order no longer appears as that Subcontractor's work

#### Scenario: Cross-contractor assignment is refused

- **WHEN** a Contractor attempts to assign a Subcontractor or Order they do not own
- **THEN** the system refuses the Assignment

#### Scenario: Assigning the same subcontractor twice is idempotent

- **WHEN** a Contractor assigns a Subcontractor already assigned to that Order
- **THEN** the system keeps a single Assignment rather than creating a duplicate

### Requirement: View Assignments From Both Sides

The system SHALL let a Contractor see the Subcontractors assigned to a given Order, and see the Orders a given Subcontractor is assigned to (surfaced from the Subcontractor's profile).

#### Scenario: Order shows its assigned subcontractors

- **WHEN** a Contractor opens an Order
- **THEN** the system lists the Subcontractors currently assigned to it

#### Scenario: Subcontractor profile shows assigned orders

- **WHEN** a Contractor opens a Subcontractor's profile
- **THEN** the system lists the Orders that Subcontractor is assigned to, with each Order's status
