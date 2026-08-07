## MODIFIED Requirements

### Requirement: Template Selection in the Contact Composer

When composing an email in the contact composer, the system SHALL let the contractor
pick one of their templates to fill the subject and body with placeholders resolved,
and SHALL still allow the contractor to edit the subject and body before the message
is sent. Selecting a template SHALL NOT affect the Text (SMS) channel.

#### Scenario: Contractor fills the email from a template

- **WHEN** a contractor selects a template in the composer's Email mode
- **THEN** the system populates the subject and body with placeholders resolved and the signature applied

#### Scenario: Contractor edits before sending

- **WHEN** a contractor edits the pre-filled subject or body after selecting a template
- **THEN** the composed email reflects the contractor's edits, whether the message is sent by the app or handed off to the contractor's mail client

#### Scenario: Template picker is available wherever the composer is

- **WHEN** the contact composer is opened from the dashboard, orders list, order detail, customer directory, or subcontractor roster
- **THEN** the same set of the contractor's templates is offered
