## ADDED Requirements

### Requirement: Message entity

The system SHALL represent a message as a record attached to exactly one Order, storing the author's role (contractor or customer), the author's User id, the message body, and the time it was created. Every Order SHALL have exactly one thread, being the set of messages attached to it.

#### Scenario: Message records its author

- **WHEN** a message is sent on an Order
- **THEN** the stored record carries the author's role and User id alongside the body and creation time

#### Scenario: Messages are ordered oldest first

- **WHEN** a thread with several messages is read
- **THEN** the messages are returned in ascending order of creation time

#### Scenario: Empty body is refused

- **WHEN** a send is submitted with an empty or whitespace-only body
- **THEN** the send is refused and no message is stored

### Requirement: Messages carry a topic

A message SHALL record what it is about — a question, a payment matter, scheduling, a reported problem, or general. The topic SHALL be chosen by the Customer through a quick action rather than typed, SHALL default to general for a message written straight into the composer, and SHALL always be general on a Contractor's reply. An unrecognized topic SHALL be recorded as general rather than refusing the message.

#### Scenario: Quick action sets the topic

- **WHEN** a Customer sends a message through the "Ask a question" action
- **THEN** the stored message carries the question topic

#### Scenario: Plain composer files as general

- **WHEN** a Customer sends a message without choosing a quick action
- **THEN** the stored message carries the general topic

#### Scenario: A reply carries no topic of its own

- **WHEN** a Contractor replies to a message about a payment
- **THEN** the reply is stored as general, so the topic is not counted twice

#### Scenario: Unknown topic degrades to general

- **WHEN** a send arrives naming a topic the system does not recognize
- **THEN** the message is stored with the general topic and the send succeeds

### Requirement: The portal offers quick actions rather than a bare composer

The portal SHALL present a Customer with a set of labelled actions covering the common reasons to make contact, each of which opens the composer with its topic set and a prompt describing what it is for. The prompt SHALL live in the composer rather than as standing explanatory text around the actions. An action that names something the system does not do SHALL say so where the Customer will read it before writing.

#### Scenario: Contact is one control, not a panel

- **WHEN** a Customer opens one of their projects
- **THEN** the contact surface is reachable from a single persistent control rather than occupying a section of the page

#### Scenario: Actions are the entry point to the composer

- **WHEN** a Customer opens the contact control
- **THEN** labelled actions for asking a question, payment, scheduling and reporting a problem are shown above the composer, with no explanatory paragraph between the heading and the actions

#### Scenario: Choosing an action sets the prompt

- **WHEN** a Customer chooses a quick action
- **THEN** the composer's placeholder describes what to write for that topic

#### Scenario: Payment action states that the app takes no payment

- **WHEN** a Customer chooses the payment action
- **THEN** the portal states that payment is handled directly by their contractor and not through the application

### Requirement: A reported problem is raised at higher priority

A message a Customer files as a reported problem SHALL notify the Contractor at high priority; every other topic SHALL notify at standard priority.

#### Scenario: Problem outranks a question

- **WHEN** a Customer reports a problem
- **THEN** the Contractor's notification is created at high priority

### Requirement: The contractor sees what a message is about

The Contractor's view of a thread SHALL show each Customer message's topic where it is not general, so a thread can be triaged without reading every message.

#### Scenario: Topic is visible on the contractor's side

- **WHEN** a Contractor opens a thread containing a payment message
- **THEN** that message is labelled with its topic

### Requirement: Customer sends a message on their order

A Customer SHALL be able to send a message on any Order linked to their own Customer record. The message SHALL be attached to that Order with an author role of customer.

#### Scenario: Customer sends a message

- **WHEN** a Customer submits a message on one of their own Orders
- **THEN** the message is stored on that Order and appears in the thread for both the Customer and the Contractor

#### Scenario: Customer cannot message another customer's order

- **WHEN** a Customer submits a message naming an Order that is not linked to their Customer record
- **THEN** the send is refused and no message is stored

### Requirement: Contractor replies from the order workspace

A Contractor SHALL be able to read and reply to the thread on any Order they own, from that Order's workspace. The reply SHALL be attached to the Order with an author role of contractor.

#### Scenario: Contractor replies to a customer

- **WHEN** a Contractor submits a reply on an Order they own
- **THEN** the reply is stored on that Order and the linked Customer sees it in their portal thread

#### Scenario: Contractor cannot reply on an order they do not own

- **WHEN** a Contractor submits a reply naming an Order owned by a different Contractor
- **THEN** the reply is refused and no message is stored

### Requirement: Thread access is authorized from the viewer

Every read and write of a thread SHALL be authorized from the identity of the viewer performing it: a contractor viewer SHALL own the Order, and a customer viewer SHALL be linked to the Order's Customer. Authorization SHALL NOT be inferred from the calling surface.

#### Scenario: Unrelated user is refused

- **WHEN** a signed-in User who neither owns the Order nor is linked to its Customer requests the thread
- **THEN** the request is refused and no messages are returned

### Requirement: Each side tracks its own unread messages

The system SHALL track read state separately for the contractor side and the customer side of a thread. A message SHALL count as unread only for the side that did not write it. Opening a thread SHALL mark the other side's messages as read for the viewer who opened it.

#### Scenario: Own message is never unread to its author

- **WHEN** a Customer sends a message
- **THEN** that message counts as unread for the Contractor and never counts as unread for the Customer

#### Scenario: Opening the thread clears unread state

- **WHEN** a Contractor opens the thread on an Order with two unread customer messages
- **THEN** those messages are marked read for the contractor side and the Order's unread count becomes zero

#### Scenario: Reading one side does not clear the other

- **WHEN** a Contractor opens a thread and marks it read
- **THEN** any messages the Customer has not yet read remain unread for the customer side

### Requirement: Unread messages are surfaced on the order list

The Contractor's Order list SHALL show, per Order, a count of messages from the Customer that the contractor side has not yet read.

#### Scenario: Unread badge appears

- **WHEN** a Customer sends a message on an Order and the Contractor views their Order list
- **THEN** that Order shows an unread count of one

### Requirement: Both sides are notified of new messages

Sending a message SHALL create an in-app notification for the recipient side: a Customer's message SHALL notify the Order's Contractor, and a Contractor's reply SHALL notify the linked Customer's User. When the Order's Customer is not linked to a User, the notification SHALL be skipped without failing the send.

#### Scenario: Customer message notifies the contractor

- **WHEN** a Customer sends a message on an Order
- **THEN** a notification naming that Customer is created for the Order's Contractor

#### Scenario: Contractor reply notifies the customer

- **WHEN** a Contractor replies on an Order whose Customer is linked to a User
- **THEN** a notification is created for that User

#### Scenario: Unlinked customer does not break the send

- **WHEN** a Contractor replies on an Order whose Customer has no linked User
- **THEN** the message is stored and no notification is created, and the send reports success

### Requirement: A lapsed contractor never blocks their customer's message

A Customer's ability to send a message SHALL NOT depend on their Contractor's subscription standing. The billing write guard SHALL apply to a contractor's reply only.

#### Scenario: Customer of a lapsed contractor can still write

- **WHEN** a Customer whose Contractor's subscription has lapsed sends a message
- **THEN** the message is stored and the Contractor is notified

#### Scenario: Lapsed contractor's reply is refused

- **WHEN** a Contractor whose subscription has lapsed submits a reply
- **THEN** the reply is refused behind the upgrade prompt and no message is stored

### Requirement: Messages are distinct from timeline entries

A message SHALL NOT be written as a timeline entry, and the Order timeline SHALL remain a record of what happened to the job rather than what was said about it.

#### Scenario: Sending a message leaves the timeline unchanged

- **WHEN** a Customer sends a message on an Order
- **THEN** no timeline entry is created for that Order
