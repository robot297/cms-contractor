## ADDED Requirements

### Requirement: Scanned ID entity

The system SHALL represent a scanned ID as a transient set of fields read off one document: full name, given and family names, a single-line address, an ID number, a date of birth, an expiry date, and which path produced it (`barcode` or `vision`). A Scanned ID SHALL NOT be persisted — it exists only between capture and the moment the contractor saves or dismisses the form.

#### Scenario: A scan produces fields, not a record

- **WHEN** a contractor scans an ID
- **THEN** the system produces field values for the open form and creates no Subcontractor, document, or image record

#### Scenario: Every scan reports its source

- **WHEN** a scan completes by either path
- **THEN** the result states whether it came from the barcode or from vision

### Requirement: On-device barcode decode

The system SHALL decode the PDF417 barcode on the back of a US or Canadian driver's licence or state ID entirely in the browser, and SHALL NOT transmit the image to do so. The system SHALL parse the decoded payload according to the AAMVA element codes, reading the name, address, ID number, date of birth, and expiry.

#### Scenario: A valid AAMVA payload yields fields

- **WHEN** the decoder returns a payload beginning with the AAMVA `ANSI ` header
- **THEN** the system returns a Scanned ID carrying the name, address, ID number, date of birth, and expiry the payload encodes

#### Scenario: Dates are read in the jurisdiction's order

- **WHEN** a payload declares country `USA`
- **THEN** dates are read as MMDDCCYY
- **AND WHEN** a payload declares country `CAN`
- **THEN** dates are read as CCYYMMDD

#### Scenario: A payload whose header offsets are wrong still parses

- **WHEN** a payload's subfile offsets do not match its actual content
- **THEN** the system still reads every element it can identify by element code

#### Scenario: A non-AAMVA barcode is refused

- **WHEN** the decoder returns a payload with no AAMVA header
- **THEN** the system reports that it is not an ID and captures nothing

#### Scenario: Nothing is sent for a barcode scan

- **WHEN** a barcode scan succeeds
- **THEN** no request carrying the image is made

### Requirement: Vision fallback for cards with no barcode

The system SHALL allow a contractor to send a captured photo to the server for field extraction when no barcode decodes. The server SHALL return the same Scanned ID shape, validated against a schema before it reaches the contractor. The image SHALL NOT be written to disk, stored in the database, or logged.

#### Scenario: A trade licence card is read by vision

- **WHEN** a contractor captures a card with no barcode and chooses to read it
- **THEN** the system returns the name, licence number and address the card shows, marked as coming from vision

#### Scenario: An unreadable image is reported, not guessed

- **WHEN** the model cannot identify the document as an ID or licence
- **THEN** the system reports that nothing could be read and prefills nothing

#### Scenario: Vision is unavailable without configuration

- **WHEN** no vision provider key is configured
- **THEN** the scanner offers only the barcode path and says so, and no request is attempted

#### Scenario: The image is not retained

- **WHEN** a vision extraction completes, successfully or not
- **THEN** no record of the image exists on the server

### Requirement: The contractor confirms before anything is saved

The system SHALL present every scanned field for review and SHALL apply them only to the open Add or Edit Subcontractor form. Saving SHALL go through the same path as a typed entry, including the billing write guard, the trial limit, and the duplicate-email rule.

#### Scenario: Scanned fields land in the form, not the database

- **WHEN** a scan completes
- **THEN** the Add or Edit form shows the scanned values and no Subcontractor is created or changed until the contractor saves

#### Scenario: A contractor can correct a scan

- **WHEN** a scanned value is wrong
- **THEN** the contractor can edit it in the form before saving

#### Scenario: A lapsed contractor cannot save a scan

- **WHEN** a lapsed contractor scans an ID and saves
- **THEN** the write is refused behind the upgrade prompt exactly as a typed entry would be

### Requirement: Only fields that belong to a Subcontractor are prefilled

The system SHALL prefill from a government ID only the name and the address. The system SHALL display the ID number, date of birth and expiry for the contractor to check against the card, and SHALL discard them. The system SHALL prefill a licence number and its expiry only from a trade or contractor licence read by vision.

#### Scenario: A driver's licence number and expiry are shown but not stored

- **WHEN** a driver's licence is scanned
- **THEN** its document number and expiry are displayed on the confirm step and the Subcontractor's licence number and licence expiry fields are left untouched

#### Scenario: A trade licence fills the licence number and its expiry

- **WHEN** a contractor licence card is read by vision
- **THEN** the licence number and expiry it carries prefill the Subcontractor's licence number and licence expiry

#### Scenario: Fields the scan keeps are not also listed as discarded

- **WHEN** a trade licence is read
- **THEN** its number and expiry appear as editable form fields and not among the fields shown as not saved

### Requirement: A Subcontractor holds a trade licence expiry

The system SHALL store an optional licence expiry alongside a Subcontractor's licence number, editable on the Add and Edit forms, and SHALL present it as a status — expired, expiring soon, or a date — rather than as a bare date, matching how the insurance expiry is presented.

#### Scenario: A licence expiry is captured by typing

- **WHEN** a contractor enters a licence expiry on the Add or Edit form
- **THEN** it is saved against that Subcontractor and shown in their Credentials panel

#### Scenario: An expired licence reads as expired

- **WHEN** a Subcontractor's licence expiry is in the past
- **THEN** the Credentials panel says so rather than showing a date the reader has to compare against today

#### Scenario: Subcontractors without one are unaffected

- **WHEN** a Subcontractor has no licence expiry
- **THEN** the field reads as not on file and nothing else about the record changes

### Requirement: Scanning degrades to typing

The system SHALL keep every field manually editable and SHALL keep the Add and Edit forms fully usable when the camera is unavailable, permission is denied, nothing decodes, or vision is unconfigured.

#### Scenario: Camera permission denied

- **WHEN** camera access is refused
- **THEN** the scanner says so and the contractor completes the form by typing

#### Scenario: Nothing decodes

- **WHEN** no barcode is found and vision is unconfigured or fails
- **THEN** the form is left as it was and the contractor completes it by typing

### Requirement: Scan simulator for development

The system SHALL provide a development-only mode, off unless explicitly enabled, that produces a Scanned ID from a fixture instead of a camera frame, and that returns a canned vision result without calling the provider.

#### Scenario: A scan can be exercised with no camera and no card

- **WHEN** the simulator is enabled
- **THEN** a contractor can run a scan end to end from a fixture payload and see the confirm step and the prefilled form

#### Scenario: The simulator is off by default

- **WHEN** the simulator setting is absent or is any value other than `true`
- **THEN** no simulator controls appear and no fixture can be substituted for a real scan
