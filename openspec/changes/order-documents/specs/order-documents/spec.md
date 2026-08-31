## ADDED Requirements

### Requirement: Document entity

The system SHALL represent a document as a file attached to exactly one Order, recording its display name, MIME type, size in bytes, the role that uploaded it, the User that uploaded it, and when it arrived. A document SHALL be owned by the Order's Contractor regardless of who uploaded it.

#### Scenario: A document records who sent it

- **WHEN** any role uploads a document to an Order
- **THEN** the stored record carries both the uploader's role and their User id

#### Scenario: Ownership follows the order

- **WHEN** a Customer or a Subcontractor uploads a document
- **THEN** the document is owned by the Order's Contractor, taken from the Order rather than from the request

### Requirement: One upload path for every role

The system SHALL accept uploads through a single operation that takes the uploader's identity, validates type and size once, and applies the same naming rules to every caller. Per-role upload behavior SHALL be limited to authorization and notification.

#### Scenario: The same file is accepted or refused identically for every role

- **WHEN** a Contractor, a Customer, and a Subcontractor each upload the same disallowed file type
- **THEN** all three are refused for the same reason and nothing is stored

#### Scenario: Oversized upload is refused

- **WHEN** any role uploads a file exceeding the configured size limit
- **THEN** the upload is refused and nothing is stored

### Requirement: Several documents can be sent at once

The system SHALL allow selecting more than one file in a single upload, SHALL show every selected file before anything is sent, and SHALL allow naming each one and removing any of them from the batch. Validation SHALL be applied per file: a file that is refused SHALL NOT prevent the others from being stored, and the outcome SHALL name which files were stored and which were refused, with the reason.

#### Scenario: A batch of valid files is sent together

- **WHEN** someone selects three allowed files and confirms
- **THEN** all three are stored against the Order and all three appear in the list

#### Scenario: One bad file does not cost the batch

- **WHEN** someone selects four files of which one exceeds the size limit and confirms
- **THEN** the other three are stored, the oversized one is not, and the outcome names the refused file and why

#### Scenario: A file can be dropped before sending

- **WHEN** someone selects several files and removes one on the confirm step
- **THEN** only the remaining files are sent

#### Scenario: Each file can be named independently

- **WHEN** someone selects two files and renames one of them
- **THEN** the renamed file is stored under its new name and the other keeps its original

### Requirement: Document bytes are read and written through one seam

All reading, writing and deleting of a document's bytes SHALL go through a single module, so that no feature code touches the storage medium directly.

#### Scenario: No feature code reads bytes directly

- **WHEN** the document operations are inspected
- **THEN** upload, download and delete obtain bytes only through the storage module, never from the table directly

### Requirement: Document access is resolved from the viewer

Every read of a document SHALL be authorized by a single rule that takes the viewer's identity: a Contractor SHALL own the Order, a Customer SHALL be linked to the Order's Customer, and a Subcontractor SHALL be assigned to the Order. Authorization SHALL NOT be re-implemented per route or per surface.

#### Scenario: Unrelated user is refused

- **WHEN** a signed-in User with no relationship to an Order requests one of its documents
- **THEN** the request is refused and no bytes are returned

#### Scenario: Every surface applies the same rule

- **WHEN** the same document is requested from the Contractor, Customer, and Subcontractor surfaces
- **THEN** each request is decided by the same authorization rule

### Requirement: Opening a document never navigates

Opening a document SHALL render it over the current page. The application SHALL NOT link directly to a document's bytes from any list on any surface.

#### Scenario: The page is not replaced

- **WHEN** someone opens a document from any list in the application
- **THEN** the page underneath remains loaded and returning to it does not require the browser's back control

### Requirement: The viewer can always be dismissed

The document viewer SHALL offer an explicit close control, SHALL close when the backdrop is activated, and SHALL close on Escape. These SHALL be present in every state of the viewer, including when the document cannot be previewed.

#### Scenario: Viewer closes every way it is asked to

- **WHEN** someone opens a document and then presses Escape, activates the backdrop, or uses the close control
- **THEN** the viewer closes and the page underneath is as they left it

#### Scenario: A failed preview still has exits

- **WHEN** the browser cannot render a document inline
- **THEN** the viewer states that it cannot be previewed and offers download, open-in-new-tab, and close

### Requirement: Documents are rendered by type

The viewer SHALL render a PDF as a readable portrait document and an image contained within the available space. A type it cannot preview SHALL NOT be embedded; the viewer SHALL say so instead of presenting an empty frame.

#### Scenario: A PDF is readable

- **WHEN** someone opens a PDF
- **THEN** it is presented at a readable width with its pages scrollable inside the viewer

#### Scenario: An unpreviewable type is stated, not faked

- **WHEN** someone opens a document of a type the viewer cannot render
- **THEN** the viewer says it cannot be previewed rather than showing a blank embed

### Requirement: The viewer takes and returns focus

Opening the viewer SHALL move focus to its close control and SHALL prevent the page behind it from scrolling. Closing SHALL return focus to the control that opened it.

#### Scenario: Focus returns on close

- **WHEN** someone opens a document from a list and then closes the viewer
- **THEN** focus is back on the item they opened

#### Scenario: The page behind does not scroll

- **WHEN** the viewer is open
- **THEN** scrolling affects the document, not the page underneath

### Requirement: Documents can be downloaded

The system SHALL serve a document for download as well as for inline rendering, and the download SHALL preserve the document's display name.

#### Scenario: Download saves rather than renders

- **WHEN** someone uses the viewer's download control
- **THEN** the file is saved under its display name rather than rendered

### Requirement: Deleting and withdrawing a document

A Contractor SHALL be able to delete any document on an Order they own. A Customer SHALL be able to withdraw a document they uploaded until the Contractor has read it, and SHALL NOT be able to withdraw it afterwards. A refused withdrawal SHALL state why.

#### Scenario: Contractor deletes a document

- **WHEN** a Contractor deletes a document on their own Order
- **THEN** it is removed and no longer appears on any surface

#### Scenario: Customer withdraws an unread document

- **WHEN** a Customer withdraws a document the Contractor has not yet read
- **THEN** it is removed from the Order

#### Scenario: A read document cannot be withdrawn

- **WHEN** a Customer attempts to withdraw a document the Contractor has already read
- **THEN** the withdrawal is refused and the reason is shown

### Requirement: A customer's upload never depends on their contractor's subscription

Uploading, viewing, downloading and withdrawing a document SHALL apply the billing write guard only when the uploader is a Contractor.

#### Scenario: Customer of a lapsed contractor can still send a document

- **WHEN** a Customer whose Contractor's subscription has lapsed uploads a document
- **THEN** it is stored and the Contractor is notified

#### Scenario: Lapsed contractor cannot upload

- **WHEN** a Contractor whose subscription has lapsed uploads a document
- **THEN** the upload is refused behind the upgrade prompt
