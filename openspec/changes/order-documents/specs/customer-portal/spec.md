## MODIFIED Requirements

### Requirement: Customers can send documents on their order

A Customer SHALL be able to upload a document against one of their own Orders, and SHALL be able to see, re-open and download the documents they have sent. The entity, the upload rules, the authorization, the viewer and the download behavior are specified by `order-documents`; this requirement covers only what is specific to the portal.

#### Scenario: Customer sends a document

- **WHEN** a Customer uploads an allowed file under the size limit on one of their own Orders
- **THEN** the document is stored against that Order, appears in their list of sent documents, and the Contractor is notified

#### Scenario: Choosing a file does not send it

- **WHEN** a Customer chooses a file
- **THEN** nothing is sent until they confirm, and they are shown what they picked with an opportunity to name it

#### Scenario: Opening a document never strands the customer

- **WHEN** a Customer opens a document they sent
- **THEN** it opens in the shared viewer over the portal, and they can return to their project without using the browser's back control

## REMOVED Requirements

### Requirement: Documents open in a dismissible viewer

**Reason**: Superseded by `order-documents`, which specifies one viewer for every surface rather than one for the portal. Stating the behavior here as well is how the Contractor's file list came to be left out of it.

**Migration**: Read `order-documents` — _Opening a document never navigates_, _The viewer can always be dismissed_, _Documents are rendered by type_, and _The viewer takes and returns focus_.

### Requirement: A document records who sent it

**Reason**: Superseded by `order-documents`, which records both the uploading role and the uploading User for every role, not only for a Customer.

**Migration**: Read `order-documents` — _Document entity_.

### Requirement: A customer may name a document before sending it

**Reason**: Naming is part of the single upload path in `order-documents` and applies to every role, not only Customers.

**Migration**: Read `order-documents` — _One upload path for every role_. The extension-preserving and sanitizing rules are unchanged.
