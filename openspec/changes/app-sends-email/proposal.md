## Why

Every contractor message today is `window.location.href = 'mailto:…'`. That is text-only by
specification: no logo, no layout, no spacing, and a body-length ceiling low enough that
`STARTER_EMAIL_TEMPLATES` is written short to stay under it. A follow-up from a contractor selling a
$40k pavilion arrives looking like a note typed in a hurry — the opposite of the reputation the product
is meant to build.

The handoff also costs the CRM its memory. When the user's own mail client does the sending, the app
never learns the message went out; the record of the conversation lives in the contractor's personal
Sent folder rather than on the Order. `renderEmail()` already produces the branded HTML and its
plain-text twin, and the templates page already previews it — the rendering half of
`docs/adr/0007-the-app-sends-email-mailto-is-the-fallback.md` is done. Nothing sends it.

## What Changes

- The app sends contractor messages through a transactional provider (Resend) as a multipart message
  carrying both the HTML and plain-text parts produced by the existing `renderEmail()`.
- Mail is sent from one domain the product verifies once, with the display name set to the contractor's
  business name and `Reply-To` set to the contractor's own account email, so a customer hitting reply
  lands in the contractor's inbox.
- **BREAKING (behavioural):** the composer's Email branch becomes a form POST to a server action
  instead of a `window.location` assignment. Text and Call keep their client-side `sms:` / `tel:`
  handoff — neither has anything to format and neither has a server component.
- A successful send from an Order surface writes a `timelineEntry`, so "we emailed them on the 4th"
  becomes a fact the CRM holds. Sends from non-Order surfaces (dashboard, customer directory,
  subcontractor roster) send normally and write nothing.
- Sending covers every composer send, including messages to subcontractors. Only the timeline write is
  Order-scoped; there is no surface where the send button behaves differently.
- **Configured-or-degrade, exactly like Stripe.** With no provider key, the composer keeps handing off
  to `mailto:` as it does today. Development, the demo, and self-hosters who want nothing to do with a
  mail provider all keep working.
- Provider failure is surfaced to the contractor with the composed message intact and the `mailto:`
  route offered, so an outage costs a click rather than the message.
- Templates stay plain text. No HTML editor — the branded shell is the design, and it already exists.

Out of scope: bulk mail (these are 1:1 transactional messages), per-contractor domain verification,
per-template HTML bodies, inbound mail, and delivery/bounce webhooks. Each is additive later.

## Capabilities

### New Capabilities
- `email-delivery`: sending a composed message through a transactional provider — the provider
  interface and its configured-or-degrade rule, sender identity and reply routing, the multipart
  message, failure handling and the `mailto:` fallback, and the Order timeline record of a send.

### Modified Capabilities
- `email-templates`: *Template Selection in the Contact Composer* currently specifies that the
  contractor edits the subject and body "before the email client opens" — the composer's send path is
  now a server action, and the email client only opens on the fallback path. The requirement's
  substance (pick a template, placeholders resolved, still editable) is unchanged.

  Note on sequencing: `email-templates` is not in `openspec/specs/` yet — it is the delta of the still-
  active `add-email-templates` change (24/25, awaiting a manual verification task). Archive that change
  first so this delta has a main spec to modify.

## Impact

**New:** `src/lib/server/email.server.ts` (the `sendEmail` provider interface, the only file that names
Resend), a server action for composer sends, `resend` as a dependency, and `RESEND_API_KEY` /
`EMAIL_FROM` in `.env.schema` (both `@optional`, read through `ENV` from `varlock/env`).

**Modified:** `src/lib/ContactComposer.svelte` (Email branch becomes a form POST; failure state and
`mailto:` fallback UI), its five call sites (dashboard, orders list, order detail, customer directory,
subcontractor roster) which must pass enough context for the action to identify recipient and Order,
and `src/lib/server/crm.server.ts` for the timeline write.

**Unchanged:** `src/lib/email.ts` — `renderEmail()` is reused as-is by the send path, keeping the
templates-page preview and the sent mail from drifting. `src/lib/crm.ts`'s `composeEmail` /
`renderTemplate` are untouched. The `timeline_entry` table needs no migration; a send is
`kind: 'message'`, `authorRole: 'contractor'`.

**Operational:** a sending domain with SPF/DKIM becomes a prerequisite for the feature. Skipping it
does not break the app — it leaves mail in `mailto:` mode.
