## Why

When a contractor emails a customer from the contact composer, they currently
send a raw body with no subject, signature, or branding — it looks unprofessional
and forces them to retype the same boilerplate every time. Contractors should be
able to pick a ready-made template that fills in a proper subject, personalized
greeting, and a branded signature automatically, and manage those templates
themselves.

## What Changes

- Add contractor-owned **email templates** (name, subject, body) that support
  placeholders which auto-fill at send time (customer name, contractor/business
  name, project name).
- Each contractor gets a **branded signature block** (business name + optional
  sign-off) that is appended to every templated email automatically, so it never
  has to live inside individual templates.
- The **contact composer** gains, for the Email channel, a template picker: choosing
  a template fills the subject + body (placeholders resolved); the contractor can
  still edit before the `mailto:` opens. The Text channel is unaffected.
- New contractors are seeded with a few **starter templates** (e.g. Follow-up,
  Quote ready, Thank you) so the feature is useful immediately.
- Add a **template administration** page where the contractor can create, edit,
  reorder, and delete templates and edit their signature. Reachable from the
  contractor nav.
- Templates + signature are loaded once in the contractor layout so the composer
  has them everywhere it appears (dashboard, orders list, order detail, customers).

## Capabilities

### New Capabilities
- `email-templates`: Contractor-owned, reusable email templates with placeholder
  substitution and a branded signature, selectable in the contact composer and
  managed through a dedicated admin surface.

### Modified Capabilities
<!-- No spec-level requirement changes to existing capabilities; the composer's
     email behavior is new surface covered by the email-templates capability. -->

## Impact

- **Schema/DB**: new `email_template` table (per contractor) + a per-contractor
  signature/business-name setting; a new migration.
- **Server**: template CRUD + list, default-seeding for new contractors, demo seed
  data; a pure template-render helper (placeholder substitution + signature).
- **UI**: `ContactComposer` (email template picker + subject); a new
  `/contractor/settings/templates` admin page; a contractor nav link; contractor
  `+layout.server.ts` loads templates + signature.
- **Reuse**: builds on the existing `ContactComposer` and contractor auth guard;
  no changes to the customer portal or subcontractor surfaces.
