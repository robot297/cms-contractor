## Context

Contractors message customers through the shared `ContactComposer` (used on the
dashboard, orders list, order detail, and customer directory). Today the Email
channel opens a `mailto:` with the raw body only — no subject, greeting, or
signature. The contractor is the sender's identity; the customer record supplies
recipient + personalization (name), and orders supply project context.

Constraints:
- Delivery stays via `mailto:` (the contractor's own mail client sends it). There
  is no server-side SMTP in scope, so "branding" means text/subject formatting,
  not HTML email design.
- SvelteKit + Drizzle + Postgres, contractor-scoped auth guard already exists.
- The composer is instantiated in four places; template data must reach all of
  them without threading props through every page.

## Goals / Non-Goals

**Goals:**
- Contractor-owned templates (subject + body) with placeholder auto-fill.
- A per-contractor signature/branding block appended automatically.
- Template picker in the composer's Email mode; edits still allowed pre-send.
- Full CRUD admin surface for templates + signature.
- Sensible starter templates for new contractors and the demo.

**Non-Goals:**
- Server-sent email / SMTP / delivery tracking.
- Rich HTML email or attachments in templates.
- Templates for the Text (SMS) channel or for the in-app two-way messaging.
- Sharing templates across contractors or a global template library.

## Decisions

### Data model
- New `email_template` table: `id, contractorId (fk→user, cascade), name, subject,
  body, sortOrder (int), createdAt, updatedAt`. Scoped per contractor; ordered by
  `sortOrder` then `createdAt`.
- Signature/branding: add a `contractor_settings` table keyed by `contractorId`
  (`businessName`, `signature`), one row per contractor, lazily created.
  - *Alternative considered*: columns on `user` — rejected, `user` is owned by the
    auth library; a dedicated settings table keeps our domain data separate.
  - *Alternative considered*: signature baked into each template — rejected, it
    duplicates branding across templates and makes a rebrand an N-row edit.

### Placeholders & rendering
- Placeholder syntax: `{{customer}}`, `{{contractor}}`, `{{project}}` (curly-brace,
  matches nothing else in our copy). Unknown tokens are left as-is; missing values
  render as an empty string.
- A pure helper `renderTemplate(text, vars)` in `$lib/crm.ts` does substitution so
  it is unit-testable and shared client/server. A `composeEmail({subject, body},
  vars, signature)` helper returns the resolved subject and the body with the
  signature block appended (two newlines + signature).
- Rendering happens **client-side** in the composer at pick/send time (the vars —
  customer name, contractor name, project — are already on the page); the server
  only stores/serves the raw templates + signature.

### Getting templates to the composer everywhere
- Load templates + settings in `contractor/+layout.server.ts` and return them as
  layout data. The composer reads them from `page.data` (`$app/state`) rather than
  requiring each of the four call sites to pass a prop.
  - *Alternative considered*: per-page loads — rejected as four-fold duplication;
    templates are contractor-wide and small.
- The composer takes an optional `project` prop (order pages pass the project name
  for `{{project}}`; other surfaces omit it).

### Admin surface
- New route `/contractor/settings/templates` with form actions:
  `createTemplate`, `updateTemplate`, `deleteTemplate`, `reorderTemplate`,
  `saveSignature`. Guarded by the existing contractor guard. Linked from the nav.
- Delete is a hard delete (templates are cheap, contractor-owned config, not
  customer records) with an inline confirm.

### Seeding
- On first template load for a contractor with zero templates, seed a small set of
  starter templates (Follow-up, Quote ready, Thank you) and an empty settings row.
  Idempotent. The demo seed also inserts these so the demo shows the feature.

## Risks / Trade-offs

- [`mailto:` body length limits — long templates may be truncated by some mail
  clients] → Keep starter templates short; document the practical ~1800-char guidance
  in the admin UI; body is plain text so it degrades gracefully.
- [`mailto:` cannot guarantee the client honors subject/body on every platform] →
  Standard `?subject=&body=` is widely supported; this is the same delivery path as
  today, only richer.
- [Placeholder typos by contractors produce literal `{{foo}}` in emails] → Show the
  available placeholders in the admin editor and render a live preview with sample
  values.
- [Auto-seeding on read could race under concurrent requests] → Seed within a guard
  that no-ops if templates already exist; duplicate starter rows are harmless and
  rare, and the contractor can delete extras.

## Migration Plan

1. Add `email_template` and `contractor_settings` tables; generate + commit the
   Drizzle migration. Deploy applies it (additive, no backfill needed).
2. Ship server CRUD + layout load + composer changes + admin page together.
3. Existing contractors get starter templates seeded on their next contractor page
   load; existing sends are unaffected until they choose a template.
- Rollback: feature is additive; reverting the composer picker leaves the tables
  unused. Tables can be dropped in a follow-up down-migration if abandoned.

## Open Questions

- Should `{{project}}` fall back to something when messaging a customer outside an
  order context (dashboard/customers)? Proposed: render empty and let templates
  avoid it, or omit project-dependent templates from non-order surfaces. Deferred
  to implementation; empty-string fallback is the safe default.
