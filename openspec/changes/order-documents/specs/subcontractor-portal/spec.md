## ADDED Requirements

### Requirement: Subcontractor documents use the shared viewer

Job photos and files a Subcontractor uploads to an assigned Order SHALL be Documents as specified by `order-documents`, and SHALL open in the same dismissible viewer as every other surface. A Subcontractor SHALL see the Documents on Orders they are assigned to and no others.

#### Scenario: Subcontractor opens a document without leaving the job

- **WHEN** a Subcontractor opens a document on an assigned Order
- **THEN** it opens in the shared viewer over the page, dismissible the same way as on every other surface

#### Scenario: An unassigned order's documents are refused

- **WHEN** a Subcontractor requests a document on an Order they are not assigned to
- **THEN** the request is refused and no bytes are returned

### Requirement: Tier still gates writing a document

A Guest Contractor SHALL be able to open the Documents on an assigned Order and SHALL NOT be able to upload or delete one. A Trusted Subcontractor SHALL be able to upload. Sharing the viewer SHALL NOT change what a Tier permits.

#### Scenario: Guest can read but not write

- **WHEN** a Guest Contractor opens an assigned Order
- **THEN** they can open its documents and are offered no upload or delete control

#### Scenario: Trusted subcontractor can upload

- **WHEN** a Trusted Subcontractor uploads a document to an assigned Order
- **THEN** it is stored and recorded as having come from them
