## ADDED Requirements

### Requirement: Every Contractor Has Exactly One Subscription

The system SHALL hold exactly one Subscription per Contractor, provisioned no later than the Contractor's first visit to a contractor surface, so that no code path can observe a Contractor without one. A Subscription's status SHALL be one of `trialing`, `active`, `past_due`, `lapsed`, or `comped`. Customers and Subcontractors SHALL never have a Subscription and SHALL never be billed.

#### Scenario: New contractor is provisioned on sign-up

- **WHEN** a new Contractor signs up with email and password
- **THEN** the system creates one Subscription with status `trialing` and a trial end 14 days ahead

#### Scenario: OAuth sign-up is provisioned too

- **WHEN** a new Contractor signs up via GitHub OAuth, bypassing the email sign-up path
- **THEN** the system still creates exactly one `trialing` Subscription before any contractor surface renders

#### Scenario: Provisioning is idempotent

- **WHEN** a Contractor who already has a Subscription loads a contractor surface
- **THEN** the system reuses the existing Subscription and never creates a second one

#### Scenario: Customers and subcontractors get none

- **WHEN** a User binds to a Customer or Subcontractor record by accepting an Invite
- **THEN** the system creates no Subscription for that User and never presents them with billing

### Requirement: The Trial Grants Every Feature For 14 Days

A new Contractor's Subscription SHALL begin as a Trial lasting 14 days from sign-up, requiring no payment card to start. The Trial SHALL grant access to every feature of the product without exception; it SHALL restrict only the number of records held, as defined by Trial Limits.

#### Scenario: Trial starts without a card

- **WHEN** a Contractor completes sign-up
- **THEN** the system starts their Trial immediately and requests no payment details

#### Scenario: No feature is withheld during the trial

- **WHEN** a Contractor within their Trial uses Subcontractors, Assignments, email templates, attachments, or Invites
- **THEN** the system grants access to each of them exactly as it would for a paid Subscription

#### Scenario: Remaining trial time is visible

- **WHEN** a Contractor within their Trial loads a contractor surface
- **THEN** the system shows how many days remain

### Requirement: Trial Limits Cap Active Records Only

During a Trial the system SHALL refuse to create a new Customer, Order, or Subcontractor once the Contractor holds 25 active Customers, 25 active Orders, or 3 active Subcontractors respectively. Usage SHALL be counted from live records at the moment of the check — never from a stored counter — and SHALL exclude archived Customers, archived Subcontractors, and deleted Orders. A paid or comped Subscription SHALL impose no limits.

#### Scenario: Creation is refused at the limit

- **WHEN** a Contractor within their Trial holding 25 active Customers attempts to create another
- **THEN** the system refuses the creation and explains the Trial Limit and how to lift it

#### Scenario: Archiving frees capacity

- **WHEN** a Contractor at their Customer limit archives an existing Customer
- **THEN** the system allows them to create a new Customer, and the archived Customer and its Orders remain intact and unarchivable at will

#### Scenario: Limits never restrict editing

- **WHEN** a Contractor is at or above a Trial Limit
- **THEN** the system still allows them to edit, archive, and act on every record they already hold

#### Scenario: Paid subscriptions are uncapped

- **WHEN** a Contractor with an `active` or `comped` Subscription creates records
- **THEN** the system applies no limit to Customers, Orders, or Subcontractors

#### Scenario: Usage cannot disagree with reality

- **WHEN** the system reports a Contractor's usage against a Trial Limit
- **THEN** the figure equals a live count of that Contractor's non-archived, non-deleted records

### Requirement: A Lapsed Contractor Keeps Full Read Access And Loses Writes

When a Contractor's Trial end passes without payment, or their Subscription is ended by the payment provider, the system SHALL treat them as Lapsed. A Lapsed Contractor SHALL retain sign-in and full read access to every Customer, Order, timeline, attachment, and Subcontractor they hold. The system SHALL refuse every contractor-initiated write and explain how to restore access. Lapsing SHALL NOT delete, hide, archive, or downgrade any record.

#### Scenario: Trial elapses without payment

- **WHEN** a Contractor's trial end passes and no payment has been made
- **THEN** the system treats them as Lapsed from that moment, with no scheduled job required to make it so

#### Scenario: Lapsed contractor can still read everything

- **WHEN** a Lapsed Contractor signs in and opens their dashboard, customer directory, or an Order
- **THEN** the system renders all of their data in full

#### Scenario: Every contractor write is refused

- **WHEN** a Lapsed Contractor attempts to create or edit a Customer, create an Order, change an Order's state, post an update, upload an attachment, send an Invite, or edit a template
- **THEN** the system refuses the write and presents an upgrade prompt

#### Scenario: Nothing is taken away

- **WHEN** a Contractor lapses
- **THEN** the system leaves every record exactly as it was, and restoring payment restores writing with no data recovery step

#### Scenario: Payment retries do not lapse a paying contractor

- **WHEN** a Contractor's payment fails and the provider is still retrying (`past_due`)
- **THEN** the system continues to allow writes until the provider ends the subscription

### Requirement: Lapsing Never Reaches Customers Or Subcontractors

The system SHALL scope subscription enforcement strictly to writes performed by the Contractor. A Lapsed Contractor's Customers and assigned Subcontractors SHALL retain unchanged portal access, including their own writes. Customer and Subcontractor surfaces SHALL NOT consult a Subscription at all.

#### Scenario: Customer portal is unaffected

- **WHEN** a Customer of a Lapsed Contractor opens their portal
- **THEN** the system shows their Order status, timeline, and history exactly as before, with no notice of the Contractor's billing state

#### Scenario: Customer can still send a request

- **WHEN** a Customer of a Lapsed Contractor asks a question or requests service
- **THEN** the system records it on the Order's timeline and notifies the Contractor

#### Scenario: Trusted subcontractor can still write back

- **WHEN** a Trusted Subcontractor assigned to a Lapsed Contractor's Order adds a timeline note or uploads a job photo
- **THEN** the system records it exactly as it would for a paying Contractor

#### Scenario: New invites stop because they are contractor writes

- **WHEN** a Lapsed Contractor attempts to send a Customer Invite or Subcontractor Invite
- **THEN** the system refuses it, while every previously accepted portal continues to work

### Requirement: Comped Subscriptions Never Lapse

The system SHALL support a `comped` Subscription that is permanently free, holds no payment-provider record, and never expires. Contractors created before billing launched, and the Demo Mode contractor, SHALL hold one.

#### Scenario: Pre-existing contractors are comped

- **WHEN** the billing change is deployed
- **THEN** every Contractor that existed beforehand holds a `comped` Subscription and is never shown a paywall

#### Scenario: Comped contractors are uncapped

- **WHEN** a comped Contractor creates Customers, Orders, or Subcontractors
- **THEN** the system applies no limits and never prompts for payment

#### Scenario: Demo mode never expires

- **WHEN** a visitor enters Demo Mode, including after the demo data is re-seeded
- **THEN** the demo Contractor holds a `comped` Subscription and the demo is never blocked by billing
