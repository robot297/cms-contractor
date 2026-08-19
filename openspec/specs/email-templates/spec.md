# email-templates Specification

## Purpose

Save a contractor from retyping the same follow-up. Each contractor owns a set of reusable email
templates — name, subject, body — with placeholders that fill from the message context and a branded
signature appended automatically, so branding lives in one place instead of being repeated inside every
template. Templates are offered wherever the contact composer appears, and a contractor who has never
made one starts with a usable starter set.

## Requirements

### Requirement: Contractor-Owned Email Templates

The system SHALL let each contractor own a set of reusable email templates, each
with a name, subject, and body, scoped so a contractor only ever sees and uses
their own templates.

#### Scenario: Contractor views their templates

- **WHEN** a signed-in contractor opens the template administration surface
- **THEN** the system lists only that contractor's templates, in their configured order

#### Scenario: Templates are isolated per contractor

- **WHEN** contractor A requests templates
- **THEN** the system returns none of contractor B's templates

### Requirement: Manage Email Templates

The system SHALL let a contractor create, edit, reorder, and delete their email
templates, and each change SHALL be reflected the next time the composer offers
templates.

#### Scenario: Contractor creates a template

- **WHEN** a contractor submits a new template with a name, subject, and body
- **THEN** the system saves it to that contractor and it becomes selectable in the composer

#### Scenario: Contractor edits a template

- **WHEN** a contractor changes an existing template's name, subject, or body
- **THEN** the system persists the change and later selections use the updated content

#### Scenario: Contractor deletes a template

- **WHEN** a contractor confirms deletion of a template
- **THEN** the system removes it and it no longer appears in the composer

#### Scenario: Contractor reorders templates

- **WHEN** a contractor changes the order of their templates
- **THEN** the composer and admin list present templates in the new order

### Requirement: Placeholder Substitution

Email templates SHALL support placeholders that are automatically filled from the
message context at selection/send time. The system SHALL support at least the
customer name, the contractor/business name, and the order's project name. Unknown
placeholders SHALL be left unchanged and placeholders with no available value SHALL
resolve to an empty string.

#### Scenario: Placeholders resolve to context values

- **WHEN** a contractor selects a template whose subject or body contains the customer,
  contractor, or project placeholders while messaging a specific customer/order
- **THEN** the system replaces each placeholder with the corresponding value before the email is composed

#### Scenario: Missing context resolves to empty

- **WHEN** a template uses the project placeholder but the message is not tied to an order
- **THEN** the system renders the project placeholder as an empty string rather than literal placeholder text

### Requirement: Branded Signature

Each contractor SHALL have a branding signature (business name and/or sign-off) that
the system appends automatically to every templated email body, so branding does not
have to be repeated inside individual templates. The contractor SHALL be able to edit
their signature.

#### Scenario: Signature is appended on send

- **WHEN** a contractor sends a templated email
- **THEN** the system appends the contractor's signature block to the end of the body

#### Scenario: Contractor edits their signature

- **WHEN** a contractor updates their signature in the administration surface
- **THEN** subsequent templated emails use the updated signature

### Requirement: Template Selection in the Contact Composer

When composing an email in the contact composer, the system SHALL let the contractor
pick one of their templates to fill the subject and body with placeholders resolved,
and SHALL still allow the contractor to edit the subject and body before the email
client opens. Selecting a template SHALL NOT affect the Text (SMS) channel.

#### Scenario: Contractor fills the email from a template

- **WHEN** a contractor selects a template in the composer's Email mode
- **THEN** the system populates the subject and body with placeholders resolved and the signature applied

#### Scenario: Contractor edits before sending

- **WHEN** a contractor edits the pre-filled subject or body after selecting a template
- **THEN** the composed email reflects the contractor's edits

#### Scenario: Template picker is available wherever the composer is

- **WHEN** the contact composer is opened from the dashboard, orders list, order detail, or customer directory
- **THEN** the same set of the contractor's templates is offered

### Requirement: Starter Templates for New Contractors

The system SHALL ensure a contractor who has never created a template starts with a
small set of usable starter templates, so the feature is useful without setup.

#### Scenario: New contractor has starter templates

- **WHEN** a contractor with no templates first reaches a surface that offers templates
- **THEN** the system provides a starter set of templates they can use or edit
