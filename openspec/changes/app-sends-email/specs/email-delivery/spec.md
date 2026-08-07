## ADDED Requirements

### Requirement: The App Sends Composed Messages

When email sending is configured, the system SHALL deliver a message composed in the contact composer
through a transactional email provider rather than handing off to the contractor's mail client. The
message SHALL be sent as a multipart message carrying both an HTML part and a plain-text part, and both
parts SHALL be produced from the same composed subject and body so they cannot differ in content.

#### Scenario: A configured send goes out through the provider

- **WHEN** a contractor sends an email from the composer and sending is configured
- **THEN** the system delivers the message through the provider and reports success to the contractor without opening their mail client

#### Scenario: Both parts carry the same message

- **WHEN** the system sends a composed message
- **THEN** the HTML part and the plain-text part are rendered from the same composed subject and body

#### Scenario: Text and Call are unaffected

- **WHEN** a contractor uses the composer's Text or Call channel
- **THEN** the system hands off to the device's `sms:` or `tel:` handler exactly as before, with no provider involvement

### Requirement: Sending Is Configured Or Degrades

Email sending SHALL be treated as configured only when the provider credential and the sending address
are both present. When sending is not configured, the composer SHALL fall back to the `mailto:` handoff
and every contractor surface SHALL continue to work. The system SHALL NOT present sending as broken,
report an error, or block the contractor when sending is simply unconfigured.

#### Scenario: Unconfigured install falls back silently

- **WHEN** a contractor sends an email and no provider credential is configured
- **THEN** the system opens the composed message in the contractor's mail client via `mailto:` and reports no error

#### Scenario: Partial configuration counts as unconfigured

- **WHEN** the provider credential is present but the sending address is not (or vice versa)
- **THEN** the system treats sending as unconfigured and uses the `mailto:` fallback

### Requirement: Sender Identity And Reply Routing

Sent mail SHALL come from the single sending address the product verifies, with the display name set to
the contractor's business name. The system SHALL set `Reply-To` to the contractor's own account email so
a recipient replying reaches the contractor directly and not the product. The system SHALL NOT require a
contractor to verify their own domain in order to send.

#### Scenario: Mail is sent under the contractor's name

- **WHEN** the system sends a message for a contractor whose business name is set
- **THEN** the message's sender display name is that business name and its address is the product's verified sending address

#### Scenario: A reply reaches the contractor

- **WHEN** a recipient replies to a message the system sent
- **THEN** the reply is addressed to the contractor's own account email

#### Scenario: No business name set

- **WHEN** the system sends a message for a contractor who has not set a business name
- **THEN** the message still sends, using the sending address without a contractor display name

### Requirement: Provider Failure Preserves The Message

When a send is attempted and the provider call fails, the system SHALL tell the contractor the send
failed, SHALL keep the composed subject and body intact and editable, and SHALL offer the `mailto:`
route so the message can still be delivered. A failed send SHALL NOT be recorded as a send.

#### Scenario: Failure keeps the message and offers the fallback

- **WHEN** a provider call fails while sending a composed message
- **THEN** the system reports the failure, leaves the composed subject and body intact, and offers to open the message in the contractor's mail client

#### Scenario: A failed send is not recorded

- **WHEN** a send fails
- **THEN** the system records no timeline entry for it

### Requirement: A Send From An Order Is Recorded On Its Timeline

When the composer is opened from an Order surface, a successful send SHALL write a timeline entry
against that Order attributed to the contractor, recording that the message went out. Sends from
surfaces with no Order context SHALL send normally and record nothing. The timeline entry SHALL NOT be
written for the `mailto:` fallback, because the system cannot know whether such a message was sent.

#### Scenario: Sending from an order records it

- **WHEN** a contractor successfully sends an email from an Order surface
- **THEN** the system writes a timeline entry on that Order attributed to the contractor

#### Scenario: Sending without an order records nothing

- **WHEN** a contractor successfully sends an email from a surface with no Order context
- **THEN** the message is sent and no timeline entry is written

#### Scenario: The fallback records nothing

- **WHEN** a message is handed off to `mailto:` because sending is unconfigured or the provider failed
- **THEN** the system writes no timeline entry, since delivery cannot be confirmed

### Requirement: The Provider Is Replaceable

All provider-specific code SHALL sit behind a single send interface taking the recipient, reply-to
address, subject, HTML part, and text part. Calling code SHALL NOT know which provider is in use, and
replacing the provider SHALL NOT require changes outside that interface's implementation.

#### Scenario: Calling code is provider-agnostic

- **WHEN** a caller sends a composed message
- **THEN** it does so through the send interface and references no provider-specific type or client

### Requirement: Messages Are One-To-One

The send path SHALL address exactly one recipient per message. The system SHALL NOT provide a way to
send one composed message to several recipients at once.

#### Scenario: One recipient per send

- **WHEN** a contractor sends a composed message
- **THEN** it is addressed to exactly one recipient
