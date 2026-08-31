# Design Notes

## Product Shape

The product should be built as two coordinated experiences:

- A contractor workspace optimized for fast updates and follow-up management.
- A customer-facing experience optimized for clarity, reassurance, and simple requests.

## Authentication and Access

- Contractors should use Better Auth for sign-in.
- Contractor sign-in should support email/password and GitHub as an optional provider.
- Customers should access the portal through a contractor-issued magic-link invite.
- Customer invites should expire automatically after 24 hours and be resendable or revocable by the contractor.

## Core Information Model

### Order
- Customer reference
- Current lifecycle state
- Primary active order focus
- Timeline of updates
- Invoice and payment references
- Messages and service requests
- Related issues or concerns
- History of prior orders

### Timeline Entry
- Type: status update, invoice, message, milestone, or issue
- Related order
- Timestamp
- Author
- Read state where relevant

### Notification
- Triggered by status changes, new messages, milestone events, and request updates
- App-first by default, with email for high-priority milestones
- Supports unread/read state and a combined recent-activity view

## Order Lifecycle States

The v1 workflow should use the following states:

- Inquiry
- Quote Sent
- Deposit Pending
- Parts Ordered
- Work Scheduled
- In Progress
- Final Payment Pending
- Work Complete
- Work Cancelled
- On Hold / Archived

On Hold / Archived should be applied manually or automatically after a period of inactivity, with a contractor notification before or when the transition happens.

## Interaction Model

### Contractor Flow
- Open a dashboard with a toggle between “Today’s follow-ups” and “All active orders”
- Review the active order and recent communication needs
- Use a quick-update action with a small set of status choices and an optional short note
- Post a status update, share an invoice, or send a message
- Review customer questions, service requests, and issue updates

### Customer Flow
- Open the portal for the active order
- See the current visible status and recent timeline activity
- Review past orders in a secondary history section
- Ask a question, request service, or report an issue
- Receive app-first notifications for meaningful updates and milestone events

## Experience Principles

- Keep the layout simple and scannable.
- Favor large touch targets and short forms.
- Use clear status labels and progress indicators.
- Reduce friction for sending updates and requests.
- Keep the customer view calm and focused on the active order.

## Resolved Decisions

- Notifications should be app-first with email for high-priority milestones.
- Customers should use magic-link access, not password-based accounts, in v1.
- Contractors should have a simple dashboard toggle between follow-ups and active orders.
- Customers should see the active order first, with past orders available in history.
- The contractor workflow should prioritize a quick update with optional notes.

## Open Questions

- What default inactivity threshold should trigger auto-archive for stale opportunities (for example 30 or 45 days)?
