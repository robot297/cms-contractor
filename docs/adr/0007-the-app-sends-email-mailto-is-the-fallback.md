# The App Sends Email; `mailto:` Is the Fallback

Contractor messages to a **Customer** are sent by the app through a transactional provider, as a
multipart message carrying both an HTML part and a plain-text part. The `mailto:` handoff stays, demoted
to the path taken when sending is not configured or the provider call fails. Text and Call are unchanged
— `sms:` and `tel:` are the only ways to reach those apps, and neither has anything to format.

## Context / trade-off

Every message today is `window.location.href = 'mailto:…'`. That is text-only by specification, so there
is no formatting to improve: no logo, no layout, no button, and a body length ceiling low enough that
`STARTER_EMAIL_TEMPLATES` is written short to stay under it. A contractor's follow-up looks like a note
typed in a hurry, which is the opposite of the reputation the product sells.

Sending from the app costs a provider account, DNS records on a sending domain, and a failure mode that
never existed before — mail that leaves the building can bounce, be marked spam, or silently vanish,
none of which can happen when the user's own mail client does the sending. We accept that because the
alternative caps the product below "looks professional", and because sending unlocks something `mailto:`
structurally cannot: the app knows the message went out, so it can be **written to the Order timeline**.
Today a contractor who follows up leaves no trace in the CRM; the record of the conversation lives in
their personal Sent folder.

Three decisions inside that, each of which could reasonably have gone the other way:

**Sent from our verified domain, reply-to the contractor.** Sending as `dana@daniels-decks.com` would be
truer, but it requires every contractor to add DKIM records to a domain many of them do not control —
the feature would be dead on arrival for most of the roster. We send from one domain we verify once, set
the display name to the contractor's business name and `Reply-To` to their own address, so a customer
hitting reply lands in the contractor's inbox. The cost is Gmail's "via" annotation on the sender line.
Per-contractor domain verification is the upgrade path for anyone who wants it, not the starting point.

**Templates stay plain text; the shell supplies the design.** The obvious reading of "send a nice HTML
template" is an HTML editor, and we are deliberately not building one. A contractor writing HTML is a
contractor breaking a layout, pasting Word markup, or tanking their own deliverability — and none of them
asked for that job. The stored `subject`/`body` remain plain text, and one branded shell (business name,
type, spacing, signature block, footer) wraps them at send time. That yields the plain-text alternative
part for free rather than as a second thing to maintain. The escape hatch — a per-template HTML body for
contractors who genuinely want one — is a later, additive change.

**Configured-or-degrade, like Stripe.** `STRIPE_SECRET_KEY` blank means billing quietly reduces to trial
state and every surface still works. Mail follows the same rule: with no provider key, the composer keeps
handing off to `mailto:` exactly as it does now. Development, the demo, and self-hosters who want nothing
to do with a mail provider all keep working, and there is one less reason for a first-run app to look
broken.

## Consequences

- The composer's email branch becomes a form POST to a server action instead of a `window.location`
  assignment. Its Text and Call branches keep the client-side handoff — they have no server component.
- **A send is a domain event.** When the composer is opened from an Order surface, a successful send
  writes a `timelineEntry`; a failed one does not. "We emailed them on the 4th" becomes a fact the CRM
  holds rather than one the contractor remembers.
- Rendering is one pure function shared by the send path and the templates page preview, the way
  `composeEmail` is shared today. If the preview and the sent mail can drift, they will.
- The HTML part is written to 2003 email rules — tables, inline styles, ~600px, no web fonts, no external
  CSS — and must survive a dark-mode client. This is a real constraint on the design, not a style choice.
- Provider failure is surfaced to the contractor with the composed message intact and the `mailto:` route
  offered, so a provider outage costs a click rather than the message.
- The provider sits behind a small interface (`sendEmail({to, replyTo, subject, html, text})`). Swapping
  Resend for Postmark or SES should be one file, and no calling code should know which one is in use.
- A sending domain with SPF/DKIM is now an operational prerequisite for the feature. Skipping it does not
  break the app — it leaves mail in `mailto:` mode.
- Bulk mail is out of scope. These are 1:1 transactional messages to a contractor's own customers; if
  anything ever fans out to a list, it needs unsubscribe handling and a fresh look at compliance.
