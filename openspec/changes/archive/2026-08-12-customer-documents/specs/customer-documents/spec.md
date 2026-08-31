## ADDED Requirements

### Requirement: Document entity

The system SHALL represent an uploaded document as a record owned by a single contractor and attached to one of that contractor's customers, optionally to a specific order. Each document SHALL store its display name, mime type, size in bytes, and a storage key locating its bytes on disk. A document SHALL NOT be visible to a customer unless it has been shared.

#### Scenario: Document is scoped to its contractor

- **WHEN** contractor A requests a document owned by contractor B
- **THEN** the system does not return it to contractor A

#### Scenario: Document attaches to a customer

- **WHEN** a contractor uploads a document for one of their customers
- **THEN** the document is linked to that customer and appears in that customer's document list for the contractor

### Requirement: Contractor uploads a document

The system SHALL allow a contractor to upload a document for one of their customers. The bytes SHALL be written to the configured uploads directory and a document record SHALL be created with its metadata. The system SHALL reject uploads that exceed the configured maximum size or whose type is not in the allowed set.

#### Scenario: Successful upload

- **WHEN** a contractor uploads an allowed file under the size limit for their customer
- **THEN** the system stores the file on disk and creates a document record with name, mime type, and size

#### Scenario: Oversized or disallowed upload is rejected

- **WHEN** a contractor uploads a file exceeding the size limit or of a disallowed type
- **THEN** the system rejects the upload and stores nothing

### Requirement: Contractor tags documents

The system SHALL allow a contractor to apply free-form tags to a document for organization.

#### Scenario: Tags persist on a document

- **WHEN** a contractor adds tags to a document
- **THEN** the tags are saved and shown with the document

### Requirement: Contractor shares a document with the client

The system SHALL let a contractor mark a document as shared or unshared. A shared document SHALL be visible and downloadable in the linked customer's portal; an unshared document SHALL remain visible only to the contractor.

#### Scenario: Sharing surfaces the document in the portal

- **WHEN** a contractor marks a document as shared for a customer whose portal account is linked
- **THEN** the document appears in that customer's portal and can be downloaded there

#### Scenario: Unshared documents stay private

- **WHEN** a document is not shared
- **THEN** it does not appear in the customer's portal

### Requirement: Access-controlled downloads

The system SHALL serve a document's bytes only to the owning contractor or to the linked customer when the document is shared. Any other requester SHALL be denied.

#### Scenario: Owner can download

- **WHEN** the owning contractor requests a document's file
- **THEN** the system streams the file

#### Scenario: Unauthorized download is denied

- **WHEN** a user who is neither the owner nor the shared-with customer requests a document's file
- **THEN** the system denies the request

### Requirement: Contractor requests a response on a document

The system SHALL allow a contractor to request a response (acknowledgement or reply) on a shared document. The linked customer SHALL be able to acknowledge or reply, and the contractor SHALL be notified when they do.

#### Scenario: Customer acknowledges a requested response

- **WHEN** a contractor requests a response on a shared document and the customer acknowledges or replies
- **THEN** the system records the response and notifies the contractor

#### Scenario: Response request is visible to the customer

- **WHEN** a contractor has requested a response on a shared document
- **THEN** the customer sees the request on that document in their portal
