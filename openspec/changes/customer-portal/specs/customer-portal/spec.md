## ADDED Requirements

### Requirement: Customer portal shell

The Customer portal SHALL render inside a shared layout that uses the application's design tokens, honors the light and dark themes, and mounts the shared toast surface. The portal SHALL NOT rely on hardcoded color literals for surfaces, text, or borders.

#### Scenario: Portal honors the dark theme

- **WHEN** a Customer opens their portal with the dark theme active
- **THEN** every surface, text color, and border in the portal renders from the shared dark palette with no light-theme literals showing through

#### Scenario: Portal is usable on a small screen

- **WHEN** a Customer opens their portal on a mobile viewport
- **THEN** the shell, order navigation, project detail, and message composer are all reachable and legible without horizontal scrolling

### Requirement: Customer navigates their own orders

The portal SHALL list every Order belonging to the Customer records linked to the signed-in User, and SHALL let the Customer open any of them. Each Order SHALL have its own addressable route. Orders SHALL be presented with active work separated from completed and cancelled work.

#### Scenario: Customer with several orders moves between them

- **WHEN** a Customer whose User is linked to three Orders opens their portal
- **THEN** all three Orders are listed and selecting any one of them opens that Order's detail at its own URL

#### Scenario: Order detail is addressable

- **WHEN** a Customer opens the URL of one of their own Orders directly
- **THEN** that Order's detail is shown without first passing through a list

#### Scenario: Customer with no orders

- **WHEN** a Customer whose User is linked to no Orders opens their portal
- **THEN** the portal shows an empty state explaining that their contractor has not started an order yet, and shows no navigation rail

### Requirement: Order detail leads with the project

An Order's page in the portal SHALL lead with the Order's project name as its heading and present the Order's status as secondary information.

#### Scenario: Project name is the heading

- **WHEN** a Customer opens an Order that has a project name
- **THEN** the project name is the page heading and the status is rendered subordinate to it

### Requirement: Portal shows customer-facing status only

The portal SHALL display an Order's state using the customer-visible status labels — Pending, Scheduled, In Progress, Completed, Cancelled, On Hold — and SHALL NOT display the contractor's internal lifecycle state names.

#### Scenario: Internal state is translated

- **WHEN** a Customer views an Order whose contractor-facing state is "Deposit Pending"
- **THEN** the portal shows "Pending" and does not show "Deposit Pending"

### Requirement: Portal timeline excludes internal entries

The portal SHALL show an Order's timeline entries in reverse chronological order, and SHALL exclude entries marked internal. Internal entries SHALL be excluded by the query that reads them, not by the rendering layer.

#### Scenario: Internal note stays hidden

- **WHEN** a contractor writes an internal note on an Order and the linked Customer opens that Order in the portal
- **THEN** the note does not appear in the timeline and is not present in the data sent to the browser

### Requirement: Portal shows a customer's order history

The portal SHALL show a Customer the Orders that are no longer active alongside those that are, so that completed and cancelled work remains readable. History SHALL be presented distinctly from active work rather than mixed into it.

#### Scenario: Completed order stays readable

- **WHEN** a Customer whose Order has been completed opens their portal
- **THEN** that Order is listed under past work and its detail, status, and timeline remain readable

### Requirement: The contractor's billing state is invisible in the portal

A Customer's portal SHALL be unaffected by their Contractor's subscription standing. A Customer of a Lapsed Contractor SHALL see exactly what they saw before, and the portal SHALL give no indication of the Contractor's billing state.

#### Scenario: Lapsing changes nothing for the customer

- **WHEN** a Contractor lapses and their linked Customer opens the portal
- **THEN** every Order, status, and timeline entry renders in full, and nothing in the portal refers to the Contractor's billing state

### Requirement: Customer portal access is scoped to the signed-in user

The portal SHALL serve only Orders whose Customer record is linked to the signed-in User. A request for an Order that is not linked to the signed-in User SHALL be refused.

#### Scenario: Another customer's order is refused

- **WHEN** a signed-in Customer requests the URL of an Order belonging to a different Customer
- **THEN** the request is refused with a not-found response and no Order data is returned

#### Scenario: Signed-out visitor is sent to sign in

- **WHEN** a visitor with no session requests a portal URL
- **THEN** they are redirected to the sign-in page

### Requirement: Development-only view-as customer

The system SHALL provide a development-only affordance that lets a signed-in Contractor view one of their own Customers' portals as that Customer would see it. The affordance SHALL be disabled unless an explicit environment flag is set, and SHALL be absent from every surface when the flag is unset.

#### Scenario: Affordance is absent by default

- **WHEN** the view-as flag is unset and a Contractor loads any page
- **THEN** no view-as control is rendered and no view-as state is available to any loader

#### Scenario: Contractor opens a customer's portal

- **WHEN** the flag is set and a Contractor selects one of their own Customers from the view-as control
- **THEN** the portal is rendered with that Customer as its subject, exactly as that Customer would see it

### Requirement: View-as never changes the signed-in identity

The view-as affordance SHALL NOT modify the signed-in User's role, session, or stored record. The Contractor's own session SHALL remain a contractor session throughout.

#### Scenario: Role is unchanged while viewing as a customer

- **WHEN** a Contractor is viewing a Customer's portal through the view-as affordance
- **THEN** their session's role is still contractor and their own contractor pages remain reachable

### Requirement: View-as is re-authorized on every request

The system SHALL verify on every request that the impersonated Customer is owned by the signed-in Contractor. A view-as selection SHALL be rejected when the flag is unset, when the signed-in User is not a Contractor, or when the named Customer does not belong to them. When the flag is unset, any stored view-as selection SHALL be cleared rather than merely ignored.

#### Scenario: Stale selection is cleared once the flag is off

- **WHEN** a browser holds a view-as selection from an earlier session and the flag is now unset
- **THEN** the selection is cleared and the request proceeds as the Contractor's own

#### Scenario: Another contractor's customer is refused

- **WHEN** a Contractor's view-as selection names a Customer owned by a different Contractor
- **THEN** the selection is rejected and no portal data for that Customer is returned

### Requirement: View-as is visibly marked and reversible

While a Contractor is viewing a Customer's portal, the system SHALL display a persistent indicator naming the impersonated Customer and offering a single action that returns the Contractor to their own view.

#### Scenario: Contractor exits the impersonated view

- **WHEN** a Contractor viewing a Customer's portal uses the exit action
- **THEN** the view-as selection is cleared and they are returned to their own contractor surface

### Requirement: Writes are refused while viewing as a customer

The system SHALL refuse every write performed while a view-as selection is active, so that no record can be created that falsely attributes an action to a Customer. The refused affordance SHALL remain visible and disabled with the reason stated, rather than being hidden.

#### Scenario: Sending a message while impersonating is refused

- **WHEN** a Contractor viewing a Customer's portal submits the message composer
- **THEN** the send is refused, no message is stored, and the reason is shown

#### Scenario: Composer states why it is disabled

- **WHEN** a Contractor is viewing a Customer's portal
- **THEN** the message composer is rendered in a disabled state with an explanation that writes are refused in the impersonated view
