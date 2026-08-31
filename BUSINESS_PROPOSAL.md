# Business Proposal: Contractor CRM

## Work Tracking + Client Portal for Independent Contractors

**Document Date:** July 19, 2026
**Status:** Active Development
**Version:** 2.0

---

## Executive Summary

The **Contractor CRM** helps independent contractors track their work and keep clients confidently informed. It centralizes a contractor's customers, orders, and communication in one place, and gives each customer a private portal to see their project's progress.

Version 1.0 of this proposal scoped an ultra-minimal, login-free status tracker. As we built and dogfooded it, the product evolved into a lightweight **CRM with a client portal**: contractors manage a real customer directory, invite customers into a portal via magic links, and share status updates and (soon) documents. This document reflects that actual direction.

**Target Customer:** Independent contractors and small contractor teams (construction, trades, consulting, freelance services)
**Primary Value:** Reputation protection and client retention through effortless, professional communication
**Secondary Value:** Operational efficiency — one home for customers, work, and client comms

---

## Problem Statement

Contractors lose business due to poor communication, not poor work quality. Today they juggle scattered email, memory, and spreadsheets, which leads to missed follow-ups, time wasted reconstructing "what do I owe this client?", and clients left anxious and chasing updates. The core need: a **low-friction** way to track work _and_ keep clients informed without adding administrative overhead.

---

## Solution Overview

A focused CRM built around three surfaces:

1. **Contractor dashboard** — follow-ups and active orders, one-tap status updates, and notifications.
2. **Customer directory** — a first-class, contractor-owned list of customers (name, email, phone, address, tags, project notes). Contractors add customers and reuse them across orders.
3. **Customer portal** — customers accept a magic-link invite and see their order status, timeline, and updates; they can send questions/requests back.

The bet is unchanged from v1: **communication is the product.** What changed is that delivering trustworthy communication requires real customer records, authenticated client access, and shared artifacts — not just an anonymous status link.

### How it works

```
Contractor:
1. Log in
2. Add a customer (or reuse an existing one) in the directory
3. Create an order for that customer
4. Send a magic-link invite so the customer can follow along
5. Tap status updates as work progresses — customer is notified

Customer:
1. Accept the magic-link invite (becomes a linked account)
2. Open the portal: current status, timeline, latest update
3. Ask a question or request service — contractor is notified
```

---

## Business Case

### Customer Segments

**Primary:** Individual contractors and small teams — plumbers, electricians, HVAC, general construction, consultants, and freelancers managing 5–20 concurrent projects who are skilled at their trade but stretched thin on administration.

### Value Proposition

| Stakeholder    | Value                         | Outcome                                    |
| -------------- | ----------------------------- | ------------------------------------------ |
| **Contractor** | One home for customers + work | Never lose track of a client or obligation |
| **Contractor** | One-tap status updates        | Save hours/week on client communication    |
| **Contractor** | Professional client portal    | Improved reputation and repeat business    |
| **Customer**   | Real-time project visibility  | Reduced anxiety, increased trust           |
| **Customer**   | A place to ask and be heard   | Better experience, more referrals          |

### Success Metrics

1. **Adoption:** contractors log 5+ status updates/week
2. **Engagement:** invited customers accept and open the portal
3. **Impact:** contractors report improved client satisfaction
4. **Retention/Referrals:** more repeat business and client recommendations

---

## Product Scope

### Built / In Progress

- **Authentication & roles** — contractors and customers are distinct roles (better-auth).
- **Customer directory** — contractor-scoped customer records with name, email (identity), phone, address, tags, and project notes; add-new and reuse-existing.
- **Orders** — lifecycle states, per-order timeline, one-tap quick updates; orders link to a customer record (single source of truth).
- **Customer portal** — magic-link invites bind a login to a customer record (by invite token); customers view status/timeline and send requests.
- **Notifications** — in-app notifications to customers on updates and to contractors on customer requests, with milestone escalation.

### Next Up

- **Documents** — contractors upload documents, tag them, share them with a client, and request a response/acknowledgement (see the `customer-documents` change).
- **Order/update templates** — reusable templates to set up orders and post updates faster.

- **Subscription billing** — a 14-day free trial on signup (every feature, capped at 25 active customers, 25 active orders and 3 subcontractors), then one plan at $29 per contractor per month or $290 per year, unlimited. Payment runs through Stripe's hosted checkout and billing portal.

### Deliberately Deferred

- Full accounting/invoicing and time tracking, and any handling of the money that moves between a **contractor and their own customer** — the `Deposit Pending` and `Final Payment Pending` order states remain status labels the contractor sets by hand. (Subscription billing, above, is the only money this product moves.)
- Heavyweight project management (dependencies, Gantt, resource planning).
- Multi-tenant enterprise administration, including multi-seat companies: pricing is already expressed per contractor, so a firm buying several logins under one bill is a later change rather than a repricing.
- Pricing tiers. There is one plan by design — see [ADR-0006](docs/adr/0006-one-plan-priced-per-contractor.md).

The guiding constraint remains **ruthless simplicity at the point of use**: every feature must reduce, not add, friction for a busy contractor. Richer data is fine as long as the day-to-day flows stay fast.

---

## Technical Stack

| Component      | Technology                                             |
| -------------- | ------------------------------------------------------ |
| **Framework**  | SvelteKit (Svelte 5)                                   |
| **Auth**       | better-auth (email/password + GitHub OAuth)            |
| **Database**   | PostgreSQL via Drizzle ORM                             |
| **Validation** | Zod (shared client/server schemas)                     |
| **Deployment** | Node adapter (`@sveltejs/adapter-node`), containerized |

**Why:** SvelteKit's form actions keep the server/client boundary simple; Drizzle + Postgres give us a real relational model for customers, orders, and documents; Zod shares one validation contract across client and server.

---

## Risks & Mitigations

| Risk                                                      | Impact | Mitigation                                                                                |
| --------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| Feature growth erodes the simplicity that drives adoption | High   | Hold the line on point-of-use simplicity; measure per-flow friction with real contractors |
| Customers don't accept portal invites                     | Medium | Frictionless magic-link onboarding; contractor controls the invite                        |
| Document storage/security complexity                      | Medium | Start with local disk + DB metadata; scoped access; migrate to object storage as needed   |
| Contractor forgets to update status                       | Medium | Dashboard surfaces follow-ups and "needs attention"                                       |

---

## Go-to-Market

- **Dogfood** with 2–3 contractors; collect friction feedback per flow.
- **Validate** that the portal meaningfully reduces status-chasing email over a 2+ week run.
- **Expand** features (documents, templates) driven by observed need, not speculation.

---

## Conclusion

The Contractor CRM addresses a real, persistent problem — contractors lose business to poor communication. By pairing lightweight work tracking with a genuine customer directory and client portal, we make trustworthy communication effortless. The scope has grown from v1's anonymous status link into a focused CRM, but the thesis is the same: **make the contractor look professional with almost no effort, and clients will stay and refer.**

---

**Document Approved By:** Daniel Obot
**Last Updated:** July 19, 2026
**Supersedes:** v1.0 (July 18, 2026) — anonymous, login-free status-tracker MVP
