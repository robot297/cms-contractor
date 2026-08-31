## ADDED Requirements

### Requirement: One Paid Subscription, Priced Per Contractor

The public pricing surface SHALL present exactly one paid Subscription, priced per Contractor, offered monthly or annually. It SHALL NOT present pricing levels, plans, or feature comparisons, because none exist. The paid Subscription SHALL be unlimited in every dimension.

#### Scenario: Pricing page sells one thing

- **WHEN** a visitor opens the pricing page
- **THEN** the system presents a single paid Subscription with a monthly and an annual price, and no tier comparison

#### Scenario: Trial is described honestly

- **WHEN** a visitor reads the pricing page
- **THEN** the system states that the 14-day Trial needs no payment card and that its only restrictions are on how many Customers, Orders, and Subcontractors may be held

#### Scenario: Prices are not hard-coded in the app

- **WHEN** the price of the Subscription changes
- **THEN** the system reflects the new price without a code change

### Requirement: Subscribe Through Hosted Checkout

A Contractor SHALL be able to start a paid Subscription by being redirected to the payment provider's hosted checkout. The system SHALL NOT collect, transmit, or store payment card details itself. On successful payment the Contractor's Subscription SHALL become `active` and all restrictions SHALL lift.

#### Scenario: Contractor subscribes

- **WHEN** a Contractor chooses the monthly or annual Subscription from their billing surface
- **THEN** the system redirects them to hosted checkout for the price they chose and returns them to their billing surface afterwards

#### Scenario: Payment activates the subscription

- **WHEN** checkout completes successfully
- **THEN** the system records the Subscription as `active`, removes all Trial Limits, and restores writing for a previously Lapsed Contractor

#### Scenario: A lapsed contractor can always reach checkout

- **WHEN** a Lapsed Contractor, for whom every other write is refused, opens their billing surface
- **THEN** the system allows them to start checkout

#### Scenario: Abandoned checkout changes nothing

- **WHEN** a Contractor opens checkout and abandons it
- **THEN** the system leaves their Subscription exactly as it was

#### Scenario: No payment record before payment

- **WHEN** a Contractor completes their entire Trial without subscribing
- **THEN** the system has created no customer record with the payment provider for them

### Requirement: Manage Billing Through The Hosted Portal

A Contractor with a paid Subscription SHALL be able to update their card, view invoices, switch between monthly and annual, and cancel, via the payment provider's hosted portal. The system SHALL NOT build its own card form, invoice list, or cancellation flow.

#### Scenario: Contractor manages billing

- **WHEN** a Contractor with a paid Subscription chooses to manage billing
- **THEN** the system redirects them to the provider's hosted portal and returns them to their billing surface afterwards

#### Scenario: Cancellation lapses the contractor at period end

- **WHEN** a Contractor cancels and their paid period ends
- **THEN** the system treats them as Lapsed — full read access, writes refused — and retains all of their data

### Requirement: Local Subscription State Is Kept In Step By Provider Events

The system SHALL make every access decision from its own stored Subscription state and SHALL NOT call the payment provider while serving a contractor surface. Provider webhook events SHALL be the authority for paid state, SHALL be verified as authentic before being acted on, and SHALL be safe to receive more than once or out of order.

#### Scenario: Gating survives a provider outage

- **WHEN** the payment provider is unreachable
- **THEN** the system continues to serve every contractor surface and grants access according to its stored Subscription state

#### Scenario: Failed payment is reflected

- **WHEN** the provider reports a failed payment
- **THEN** the system records the Subscription as `past_due` and continues to allow writes while the provider retries

#### Scenario: Ended subscription lapses the contractor

- **WHEN** the provider reports a subscription as ended or the payment finally abandoned
- **THEN** the system records the Subscription as `lapsed` and refuses further contractor writes

#### Scenario: Unverified events are rejected

- **WHEN** a request arrives at the webhook endpoint without a valid provider signature
- **THEN** the system rejects it and changes no Subscription

#### Scenario: Repeated delivery is harmless

- **WHEN** the provider delivers the same event more than once, or delivers events out of order
- **THEN** the system arrives at the same Subscription state as if each had been delivered once, in order

#### Scenario: Drift is repaired where it is visible

- **WHEN** a Contractor opens their billing surface
- **THEN** the system reconciles the stored Subscription against the provider so a missed event cannot leave it permanently stale
