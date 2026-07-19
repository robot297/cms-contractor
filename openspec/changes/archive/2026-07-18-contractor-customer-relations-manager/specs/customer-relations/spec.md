# Customer Relations Management

## Summary

This capability supports a mobile-first contractor customer relations workflow that helps contractors manage client communication while giving customers a simple way to stay informed and request help.

## Goals

- Help contractors share invoices, order status, and updates with customers quickly.
- Let customers see the current state of their own orders and recent activity.
- Make communication lightweight, accessible, and usable on mobile devices.
- Support notifications so users are aware when important updates occur.
- Support a long-running order lifecycle from inquiry to completion or cancellation.

## User Roles

### Contractor
- Creates and manages customer relationships and orders.
- Sends invoices and order updates.
- Leaves messages and communicates with customers.
- Tracks service requests, issues, and follow-ups.
- Uses a quick-update workflow for common order changes.

### Customer
- Views the status of their own active order.
- Reviews recent activity and milestone updates.
- Sends questions and requests for service.
- Reports concerns or issues.
- Reviews prior orders in a compact history section.

## Core Experiences

1. Contractor dashboard for client communication and follow-up management
2. Customer portal for order visibility and requests
3. Notification flow for updates and milestone events

## Functional Requirements

- Contractors can create or manage customer-facing order records.
- Contractors can attach invoices and share them with customers.
- Contractors can publish order status updates.
- Contractors can send and receive messages with customers.
- Contractors can update order lifecycle states through a quick action.
- Customers can view their own active order status and recent activity.
- Customers can ask questions, request service, and report issues.
- Customers can view a history of prior orders alongside the active order.
- The system can send app-first notifications and email notifications for major milestones.
- The system supports invitation-based customer access with time-limited magic links.

## Lifecycle States

The system must support the following order states:

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

## Experience Requirements

- The interface must be clean, simple, and accessible.
- The experience must prioritize mobile-first usage.
- Core tasks should be reachable in a small number of taps.
- Communication should feel direct and low-friction.
- Customers should see human-friendly status labels rather than internal contractor workflow terms.

## Non-Goals

- Full accounting or ERP features.
- Complex project management beyond customer communication.
- Multi-tenant enterprise administration in the first release.
