## Context

`docs/adr/0007-the-app-sends-email-mailto-is-the-fallback.md` decided this; the ADR is the reasoning of
record and this document is how it gets built. Half of it already exists: `src/lib/email.ts` exports
`renderEmail(template, vars, branding) → { subject, html, text }`, written to 2003 email rules (tables,
inline styles, 600px, no web fonts), and the templates settings page renders it into a preview iframe.
Nothing calls it on a send path.

The current send path is `ContactComposer.svelte:77-93`: a `send()` function that assembles a `mailto:`
URL and assigns `window.location.href`. It is mounted at five call sites — the dashboard, orders list,
order detail, customer directory, and subcontractor roster. Two of those (orders list, order detail)
pass a `project`; the subcontractor roster passes a subcontractor into the prop named `customer`.

Two constraints come from what is already here. The app reads configuration through
`import { ENV } from 'varlock/env'` and the `.env.schema` file's `@optional` / `@sensitive` decorators;
`src/lib/server/stripe.server.ts` is the reference for a degradable integration, with its
`stripeClient()` returning `null` and `isBillingConfigured()` gating the UI. And `timeline_entry`
already has exactly the shape a send needs — `kind`, `title`, `detail`, `authorRole`, `internal` — so
recording a send is an insert, not a migration.

## Goals / Non-Goals

**Goals:**

- A composed message leaves the building as branded HTML with a plain-text alternative, from a sender a
  customer recognises, with replies landing in the contractor's inbox.
- A send from an Order becomes a durable fact on that Order's timeline.
- An install with no mail configuration behaves exactly as it does today, with no error surface.
- The provider is one file. Swapping Resend for Postmark or SES touches nothing else.
- The preview on the templates page and the mail that actually goes out cannot drift.

**Non-Goals:**

- An HTML template editor. Templates stay plain text; the shell is the design.
- Per-contractor sending domains and DKIM setup. One verified domain, `Reply-To` for the rest.
- Bulk or list mail, unsubscribe handling, inbound mail, delivery/bounce webhooks, open tracking.
- Retries, queues, or a send outbox. A failed send is reported to a contractor who is sitting right
  there and can press the button again.
- Changing `renderEmail`, `composeEmail`, or `renderTemplate`. All three are reused as-is.

## Decisions

### The provider lives behind `sendEmail` in one server module

`src/lib/server/email.server.ts` exports `sendEmail({ to, replyTo, fromName, subject, html, text })`
returning a discriminated result rather than throwing, plus `isEmailConfigured()` mirroring
`isBillingConfigured()`. It is the only file that imports `resend` or names a provider type.

_Why:_ the ADR asks for exactly this, and Stripe already proves the shape in this codebase. A result
type rather than an exception because "the provider failed" is an expected outcome the composer must
render, not an exceptional one — making callers wrap every send in `try`/`catch` invites a caller who
forgets to.

_Alternative considered:_ calling Resend's SDK directly from the server action. Rejected — it puts a
provider type in the action's signature, and the ADR's one-file-swap promise dies the moment a second
file imports the SDK.

### Configured means credential **and** sending address

`isEmailConfigured()` is `Boolean(ENV.RESEND_API_KEY && ENV.EMAIL_FROM)`. Both `@optional`, both blank
by default, matching how `STRIPE_SECRET_KEY` is left blank in development.

_Why:_ a key without a verified from-address produces a provider rejection on every send — a broken
feature that looks configured. Treating partial configuration as unconfigured turns a runtime failure
into a fallback that already works.

### The composer's Email branch becomes a form POST; Text and Call do not

Email posts to a `?/sendEmail` action via `use:enhance`, so the composed message survives a failure and
the fallback stays available client-side. Text and Call keep `window.location`.

_Why:_ only Email has a server component. Routing `sms:`/`tel:` through the server would add a
round-trip to reach a handler the browser can invoke directly.

_Alternative considered:_ a `POST /api/email/send` endpoint instead of a form action. Rejected —
progressive enhancement comes free with an action, and the composer is already inside route trees that
own their data.

### One action, in the contractor layout

The action lives at `src/routes/contractor/+layout.server.ts`'s route (or a shared `+page.server.ts`
re-export) so all five call sites reach the same handler, rather than each route growing its own copy.
The composer posts `customerEmail`, `customerName`, `subject`, `body`, and an optional `orderId`.

_Why:_ the composer is one component; it should have one server counterpart. Five copies of a send
action is five places for the timeline rule to drift.

### The server recomposes; it does not trust the posted rendering

The action re-runs `composeEmail` and `renderEmail` server-side from the posted subject/body plus the
contractor's own settings loaded from the database. The client posts only what the contractor typed.

_Why:_ the signature, business name, and branding are the contractor's record, not form input — posting
them would let a crafted request send mail under another contractor's name from the product's verified
domain. Recomposing server-side is also what keeps the preview and the sent mail identical, since both
call the same `renderEmail`.

### `orderId` is authorised, not believed

Before writing a timeline entry the action confirms the Order belongs to the signed-in contractor.
An `orderId` that fails the check is treated as absent: the mail still sends, no entry is written.

_Why:_ `orderId` arrives from a form field. Writing to a timeline on the strength of that is a
cross-contractor write.

### Reply-To is the contractor's account email

Read from the signed-in `user.email`. No new settings field.

_Why:_ it is already correct for every contractor and needs no migration, no UI, and no explanation. A
separate `replyToEmail` on `contractor_settings` is the additive upgrade if someone asks for an office
inbox; nobody has.

### Sending covers subcontractor messages; the timeline write does not

Every composer send goes through the provider regardless of who the recipient is. Only the
`orderId`-carrying call sites produce a timeline entry.

_Why:_ the alternative gives one button two behaviours depending on which page it is on, which is a bug
report waiting to be filed. The ADR's timeline reasoning is Order-scoped, not Customer-scoped, and the
`orderId` presence check already expresses that exactly.

### A send is `kind: 'message'`, `internal: false`

`title` names the send ("Emailed Dana"), `detail` carries the subject line. `authorRole: 'contractor'`.

_Why:_ it reuses the existing `timeline_entry` vocabulary with no migration. Not `internal` because the
customer receiving the mail already knows it was sent — hiding it from their portal would make the
portal's history disagree with their inbox.

## Risks / Trade-offs

- **Mail sent from the product's domain on a contractor's behalf can damage the sending domain's
  reputation** if a contractor mails people who mark it spam. → 1:1 transactional only, no bulk path
  exists to abuse, and `Reply-To` plus the business-name display keep the mail honest about its origin.
  Per-contractor domains remain the upgrade path for volume senders.
- **Gmail shows a "via" annotation** on the sender line because the From domain isn't the contractor's.
  → Accepted explicitly in the ADR; the alternative asks every contractor for DKIM records on a domain
  most don't control, which kills the feature for the majority.
- **The HTML must survive Outlook's Word renderer and dark-mode clients.** → `email.ts` already pins
  `color-scheme: light`, inlines every style, and uses table layout. Real-client testing before launch,
  not just the preview iframe.
- **A send can succeed at the provider and fail before the timeline write** (e.g. database blip),
  leaving mail sent with no record. → Accepted. The inverse — writing first and failing to send — is
  worse, because a false "we emailed them" is a lie the contractor acts on. Ordering is send, then
  record.
- **`window.location` on the fallback path loses the composed message** if the mail client fails to
  open. → Unchanged from today's behaviour; not a regression this change introduces.
- **A contractor with no business name sends from a bare address**, which looks less trustworthy. →
  Sends anyway rather than blocking; the getting-started guide already nudges toward setting it.

## Migration Plan

1. Ship with `RESEND_API_KEY` and `EMAIL_FROM` blank. Behaviour is identical to today — every send
   takes the `mailto:` path — so the code can land and be verified before any DNS work.
2. Verify the sending domain (SPF, DKIM, DMARC) at the provider.
3. Set both variables in production. Sending switches on with no deploy.

Rollback is blanking `RESEND_API_KEY`: the composer returns to `mailto:` on the next request, with no
code change and no data to unwind.

## Open Questions

- What the sending domain is, and whether it's a subdomain (`mail.…`) kept separate from any domain
  already sending transactional auth mail. Resolvable at step 2, not a blocker for the code.
- Whether a failed send should be visible anywhere beyond the composer's own error state. Leaving it
  composer-only for now; a persistent failure log is additive.
