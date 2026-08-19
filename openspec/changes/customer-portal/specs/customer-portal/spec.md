## ADDED Requirements

### Requirement: Customer portal shell

The Customer portal SHALL render inside a shared layout that uses the application's design tokens, honors the light and dark themes, and mounts the shared toast surface. The portal SHALL NOT rely on hardcoded color literals for surfaces, text, or borders.

#### Scenario: Portal honors the dark theme

- **WHEN** a Customer opens their portal with the dark theme active
- **THEN** every surface, text color, and border in the portal renders from the shared dark palette with no light-theme literals showing through

### Requirement: The portal is authored mobile-first

The portal's styles SHALL take the small-screen layout as their base and add to it at larger widths. Breakpoints SHALL be expressed as `min-width`; a `max-width` breakpoint that corrects a desktop baseline back down SHALL NOT be used. Interactive targets SHALL be at least 44px on their smallest axis, and text inputs SHALL render at no less than 16px so that focusing one does not zoom the page on iOS.

#### Scenario: Small screen is the base layout

- **WHEN** the portal's stylesheets are read
- **THEN** the rules outside any media query describe the phone layout, and every breakpoint they carry is a `min-width`

#### Scenario: Portal is usable on a small screen

- **WHEN** a Customer opens their portal on a mobile viewport
- **THEN** the shell, order navigation, project detail, quick actions, and message composer are all reachable and legible without horizontal scrolling

### Requirement: Portal chrome is limited to identity and navigation

The portal's header SHALL show the application name in the leading position and a badge naming the current view. On a small screen, every other control — order navigation, support, theme switching, and sign-out — SHALL be collapsed behind a single menu trigger. The signed-in person's name SHALL NOT occupy header space.

#### Scenario: Phone header carries only the essentials

- **WHEN** a Customer opens the portal on a phone
- **THEN** the header shows the app name, the view badge, and a menu trigger, and shows neither their own name nor a sign-out control

#### Scenario: Menu holds the rest

- **WHEN** a Customer opens the header menu on a phone
- **THEN** their projects, support, the theme toggle, and sign-out are all reachable from it

### Requirement: The two panes are visually distinguishable

The Customer portal and the Contractor app SHALL each carry a distinct accent color and a nav badge naming the view, so which half of the product is on screen is legible without reading the content.

#### Scenario: Portal is distinguishable from the contractor app

- **WHEN** a Contractor moves between their own app and a Customer portal
- **THEN** the accent color changes and the nav badge names the view they are now in

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

### Requirement: The order page leads with progress and the latest update

An Order's page SHALL lead with a single prominent panel carrying the Order's customer-visible status, its position on the customer-visible path, and its most recent update. That panel SHALL be visually dominant over every other panel on the page. Earlier updates SHALL be reachable from a drill-down rather than shown by default, and the drill-down SHALL state how many there are.

#### Scenario: Most recent update is what a customer lands on

- **WHEN** a Customer opens an Order with several updates
- **THEN** the most recent one appears in the leading panel and the earlier ones are collapsed behind a control naming their count

#### Scenario: Progress is shown as a path

- **WHEN** a Customer opens an Order whose status is on the customer-visible path
- **THEN** the leading panel shows the ordered steps with the current one marked, and the steps before it marked complete

#### Scenario: A cancelled or held order is not shown as progress

- **WHEN** a Customer opens an Order that is Cancelled or On Hold
- **THEN** the leading panel names that state instead of placing it on the path, because it is a departure from the path rather than a point on it

#### Scenario: Earlier updates expand in place

- **WHEN** a Customer opens the earlier-updates control
- **THEN** the remaining updates are listed newest first, without leaving the page

#### Scenario: An order with no updates says so

- **WHEN** a Customer opens an Order that has no customer-visible updates
- **THEN** the panel says none have been posted yet and offers no drill-down

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

### Requirement: Customers can send documents on their order

A Customer SHALL be able to upload a document — a photo, a permit, a receipt — against one of their own Orders, and SHALL be able to see and re-download the documents they have sent. Uploads SHALL be validated against the same type and size rules as a Contractor's attachments. Uploading SHALL notify the Order's Contractor.

#### Scenario: Customer sends a document

- **WHEN** a Customer uploads an allowed file under the size limit on one of their own Orders
- **THEN** the document is stored against that Order, appears in their list of sent documents, and the Contractor is notified

#### Scenario: Choosing a file does not send it

- **WHEN** a Customer chooses a file
- **THEN** nothing is sent until they confirm, and they are shown what they picked with an opportunity to name it

#### Scenario: Oversized or disallowed upload is refused

- **WHEN** a Customer uploads a file exceeding the size limit or of a disallowed type
- **THEN** the upload is refused with a reason and nothing is stored

#### Scenario: Customer re-downloads their own document

- **WHEN** a Customer opens a document they previously sent
- **THEN** its bytes are served to them

#### Scenario: Opening a document never strands the customer

- **WHEN** a Customer opens a document they sent
- **THEN** they can return to their project without using the browser's back control — an image opens in a closable viewer over the page, and anything not previewable opens in a separate tab

#### Scenario: Another customer's document is refused

- **WHEN** a Customer requests a document belonging to an Order that is not theirs
- **THEN** the request is refused and no bytes are returned

### Requirement: Attachments open in a dismissible viewer, never by navigation

Opening an attachment SHALL render it over the current page and SHALL NOT navigate to its bytes. This applies to every surface that lists attachments — the Customer portal and the Contractor's order workspace alike. The viewer SHALL offer an explicit close control, close on the backdrop, close on Escape, and offer a download. A file the viewer cannot render inline SHALL additionally offer to open it in a separate tab, so a failed preview is never a dead end.

#### Scenario: Viewer closes every way it is asked to

- **WHEN** someone opens an attachment and then presses Escape, clicks the backdrop, or activates the close control
- **THEN** the viewer closes and the page underneath is exactly as they left it

#### Scenario: Opening an attachment never navigates

- **WHEN** someone opens an attachment from any list in the application
- **THEN** the page is not replaced, and returning does not require the browser's back control

#### Scenario: A non-previewable file still has an exit

- **WHEN** someone opens a file the viewer cannot render inline
- **THEN** the viewer offers both a download and an open-in-new-tab alongside its close control

#### Scenario: Download is offered from the viewer

- **WHEN** someone uses the viewer's download control
- **THEN** the file is saved rather than rendered

### Requirement: A customer may name a document before sending it

A Customer SHALL be able to set a document's name on the confirm step. Only the name SHALL be theirs to set — the file's extension SHALL be taken from the uploaded file, never from the input, so a renamed document always still opens. The supplied name SHALL be stripped of path separators and control characters, capped in length, and replaced with a fallback when it is empty.

#### Scenario: Renaming keeps the extension

- **WHEN** a Customer renames "IMG_4821.jpg" to "Kitchen before" and sends it
- **THEN** the stored document is named "Kitchen before.jpg"

#### Scenario: A name cannot escape its filename

- **WHEN** a supplied name contains path separators or control characters
- **THEN** they are removed before the document is stored

#### Scenario: An empty name still produces a file

- **WHEN** a Customer clears the name entirely and sends
- **THEN** the document is stored under a fallback name with its original extension

### Requirement: A document records who sent it

Every stored document SHALL record whether a Contractor, a Customer, or a Subcontractor uploaded it. The Contractor's file list SHALL show that origin for anything they did not upload themselves.

#### Scenario: Contractor sees a customer's document as theirs

- **WHEN** a Customer sends a document and the Contractor opens that Order's files
- **THEN** the document is listed and marked as having come from that Customer

#### Scenario: A contractor's own uploads are not labelled

- **WHEN** a Contractor views a file they uploaded themselves
- **THEN** no origin marker is shown, because it is the default

### Requirement: The portal does not show the contractor's own attachments

The portal SHALL show a Customer only the documents that Customer sent. Files a Contractor attached to the Order SHALL NOT appear in the portal unless a separate sharing decision has been made.

#### Scenario: Contractor's attachment stays private

- **WHEN** a Contractor attaches a file to an Order and the linked Customer opens their portal
- **THEN** that file does not appear in the Customer's documents and its bytes are not served to them

### Requirement: Customers can reach support from the portal

The portal SHALL offer a support form that files feedback about the application itself, using the same mechanism as the Contractor's. The two forms SHALL present the same structure, controls and wording, differing only in accent color and in what is returned on success — a Customer SHALL NOT be shown the issue tracker's identifiers.

#### Scenario: Customer files a bug about the portal

- **WHEN** a Customer submits the portal's support form
- **THEN** the feedback is filed by the same mechanism as a Contractor's

#### Scenario: The two support forms match

- **WHEN** the Contractor's and the Customer's support pages are compared
- **THEN** they present the same fields, the same controls and the same wording, differing only in accent color

#### Scenario: The tracker stays internal

- **WHEN** a Customer's report is filed successfully
- **THEN** they are thanked without being given the issue's number or a link to it

### Requirement: Feedback records which pane it was filed from

Every piece of feedback SHALL record the surface it was submitted from — the Contractor app or the Customer portal — and that value SHALL be determined by the route handling the submission, never read from the request body. The recorded surface SHALL be carried into the filed report so the two audiences can be told apart.

#### Scenario: Customer feedback is marked as such

- **WHEN** a Customer submits the portal's support form
- **THEN** the filed report identifies the Customer portal as its source

#### Scenario: Contractor feedback is marked as such

- **WHEN** a Contractor submits the support form in their app
- **THEN** the filed report identifies the Contractor app as its source

#### Scenario: A submitted surface value is ignored

- **WHEN** a submission carries a surface value in its body claiming to be from another pane
- **THEN** the recorded surface is the one belonging to the route that handled it

### Requirement: Writes from the impersonated view are refused across the portal

The refusal of writes while a view-as selection is active SHALL apply to every write the portal offers, not only to sending a message.

#### Scenario: Support submission is refused while impersonating

- **WHEN** a Contractor viewing a Customer's portal submits the support form
- **THEN** the submission is refused and nothing is filed

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

While a Contractor is viewing a Customer's portal, the system SHALL display a persistent indicator naming the impersonated Customer and offering a single action that returns the Contractor to their own view. The indicator SHALL occupy the navigation chrome rather than a band across the page: it must be unmissable in context without displacing or dominating the surface being reviewed.

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
