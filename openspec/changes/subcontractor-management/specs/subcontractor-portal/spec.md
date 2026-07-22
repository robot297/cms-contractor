## ADDED Requirements

### Requirement: Subcontractor Sees Only Assigned Orders

A signed-in Subcontractor SHALL see only the Orders they are currently assigned to, and nothing else in the Contractor's account. A User with role `subcontractor` SHALL be routed to the Subcontractor portal after authentication.

#### Scenario: Portal lists only assigned orders

- **WHEN** a Subcontractor signs in
- **THEN** the system shows only the Orders assigned to them and no other Orders, Customers, or Subcontractors

#### Scenario: Subcontractor role routes to the portal

- **WHEN** a User whose role is `subcontractor` authenticates
- **THEN** the system routes them to the Subcontractor portal (not the contractor or customer surfaces)

#### Scenario: Unassignment removes access

- **WHEN** a Subcontractor is unassigned from an Order
- **THEN** that Order no longer appears in their portal and they can no longer open it

### Requirement: Guest Contractor Sees Redacted Order Details

For a Subcontractor whose Tier is `guest` (Guest Contractor), the system SHALL present an assigned Order's project name, project type, current status, and work timeline, but SHALL redact the Customer's contact PII (email, phone, address). Redaction MUST occur server-side so PII is never sent to a Guest's client.

#### Scenario: Guest opens an assigned order

- **WHEN** a Guest Contractor opens an assigned Order
- **THEN** the system shows the project, type, status, and work timeline, and withholds the Customer's email, phone, and address

#### Scenario: Redaction is server-side

- **WHEN** a Guest Contractor's assigned-Order data is produced
- **THEN** the Customer's contact PII is absent from the payload sent to the client, not merely hidden in the UI

### Requirement: Trusted Subcontractor Sees Full Order

For a Subcontractor whose Tier is `trusted` (Trusted Subcontractor), the system SHALL present the full assigned Order, including the Customer's contact details and the Order timeline.

#### Scenario: Trusted opens an assigned order

- **WHEN** a Trusted Subcontractor opens an assigned Order
- **THEN** the system shows the full Order including the Customer's name, phone, address, and timeline

### Requirement: Tier Gates Write Access

Write access on an assigned Order SHALL be gated by Tier. A Trusted Subcontractor MAY add timeline notes and upload job photos to their assigned Orders, recorded with author role `subcontractor`. A Guest Contractor's portal SHALL be read-only.

#### Scenario: Trusted posts an update

- **WHEN** a Trusted Subcontractor adds a timeline note or uploads a job photo on an assigned Order
- **THEN** the system records it against the Order with author role `subcontractor`

#### Scenario: Guest cannot write

- **WHEN** a Guest Contractor attempts to add a note or upload a photo
- **THEN** the system refuses the write and the portal offers no such action
