## ADDED Requirements

### Requirement: Administer the Subcontractor Roster

A Contractor SHALL be able to create, list, search, and archive Subcontractor records that belong only to them. Subcontractors MUST be contractor-scoped: a Contractor SHALL never see or select another Contractor's Subcontractors.

#### Scenario: Contractor adds a subcontractor

- **WHEN** a Contractor adds a Subcontractor with a name and email
- **THEN** the system persists a Subcontractor record owned by that Contractor and shows it in their roster

#### Scenario: Duplicate email within a contractor is rejected

- **WHEN** a Contractor adds a Subcontractor whose email already exists among their Subcontractors
- **THEN** the system rejects it and reports the duplicate, preserving the `(contractorId, email)` uniqueness

#### Scenario: Roster is scoped to the owner

- **WHEN** a Contractor lists or searches their roster
- **THEN** the system returns only Subcontractors that Contractor owns, and never any belonging to another Contractor

#### Scenario: Archiving hides but never deletes

- **WHEN** a Contractor archives a Subcontractor and confirms
- **THEN** the record leaves the active roster but is preserved (reversible), and its assignment history is not deleted

### Requirement: Maintain a Subcontractor Profile

A Contractor SHALL be able to record and edit an administered profile for each Subcontractor: trade/specialty, contact (email/phone), company, license number, insurance carrier and expiry, avatar, and notes/tags. License and insurance are stored for reference; the system SHALL NOT raise compliance alerts in this version.

#### Scenario: Contractor edits profile fields

- **WHEN** a Contractor edits a Subcontractor's trade, company, license number, insurance carrier, or insurance expiry
- **THEN** the system saves the changes and reflects them on the Subcontractor's profile

#### Scenario: License and insurance are stored, not enforced

- **WHEN** a Subcontractor's insurance expiry is in the past
- **THEN** the system stores the date and displays it but does NOT block assignment or raise an alert

### Requirement: Assign an Access Tier

A Contractor SHALL assign each Subcontractor a Tier of either `trusted` (Trusted Subcontractor) or `guest` (Guest Contractor). The Tier is a property of the Subcontractor record and applies to all of that Subcontractor's assignments. New Subcontractors SHALL default to `guest`.

#### Scenario: Contractor sets the tier

- **WHEN** a Contractor sets a Subcontractor's Tier to `trusted`
- **THEN** the system records the Tier on the Subcontractor and that Tier governs every Order the Subcontractor is assigned to

#### Scenario: New subcontractor defaults to guest

- **WHEN** a Contractor creates a Subcontractor without choosing a Tier
- **THEN** the system defaults the Tier to `guest` (least privilege)

### Requirement: Invite a Subcontractor

A Contractor SHALL be able to send, resend, and revoke a Subcontractor Invite. Acceptance MUST bind the accepting User to the Subcontractor record by the Invite's token, with email as a fallback — mirroring the customer Invite binding. A Subcontractor SHALL be Unlinked before acceptance, Invited while a pending Invite exists, and Linked once a User binds.

#### Scenario: Contractor sends an invite

- **WHEN** a Contractor sends an Invite to an Unlinked Subcontractor
- **THEN** the system creates a pending Subcontractor Invite with a token and marks the Subcontractor as Invited

#### Scenario: Acceptance binds by token

- **WHEN** a User accepts a Subcontractor Invite via its magic link and authenticates (even under a different email)
- **THEN** the system binds that User to the Subcontractor by the Invite's token and marks the Subcontractor Linked

#### Scenario: Revoking invalidates the link

- **WHEN** a Contractor revokes a pending Subcontractor Invite
- **THEN** the token can no longer bind and the Subcontractor returns to Unlinked

### Requirement: Enforce One Role Per User on Acceptance

A User SHALL hold exactly one global role. When accepting a Subcontractor Invite would give an existing User a second, conflicting role (e.g. the User is already a Customer or a Contractor), the system SHALL refuse the binding with a clear, non-silent message and MUST NOT drop the User into an empty portal.

#### Scenario: Existing customer accepts a subcontractor invite

- **WHEN** a User who is already a Customer accepts a Subcontractor Invite
- **THEN** the system refuses the binding and shows a clear explanation, leaving the Subcontractor Unlinked

#### Scenario: New user accepts and becomes a subcontractor

- **WHEN** a User with no prior role accepts a Subcontractor Invite
- **THEN** the system binds them and sets their role to `subcontractor`
