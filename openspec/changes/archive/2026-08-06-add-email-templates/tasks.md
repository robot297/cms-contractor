# Tasks

## 1. Data model & migration
- [x] 1.1 Add `email_template` table to `src/lib/server/db/schema.ts` (`id`, `contractorId` fk→user cascade, `name`, `subject`, `body`, `sortOrder`, `createdAt`, `updatedAt`) with a `contractorId` index.
- [x] 1.2 Add `contractor_settings` table (`contractorId` pk fk→user cascade, `businessName`, `signature`, timestamps).
- [x] 1.3 Generate the Drizzle migration (`db:generate`) and commit it.

## 2. Template rendering helpers (pure, shared)
- [x] 2.1 Add `renderTemplate(text, vars)` to `src/lib/crm.ts` — substitutes `{{customer}}`, `{{contractor}}`, `{{project}}`; unknown tokens left as-is; missing values → empty string.
- [x] 2.2 Add `composeEmail({ subject, body }, vars, signature)` returning `{ subject, body }` with placeholders resolved and the signature appended.
- [x] 2.3 Export the available placeholder list (for the admin editor + validation).
- [x] 2.4 Unit-test the helpers in `src/lib/crm.test.ts` (substitution, missing/unknown tokens, signature append).

## 3. Server: template CRUD, settings, seeding
- [x] 3.1 Add `listEmailTemplates(contractorId)`, `createEmailTemplate`, `updateEmailTemplate`, `deleteEmailTemplate`, `reorderEmailTemplates` (all contractor-scoped) in `src/lib/server/crm.server.ts` (or a new `templates.server.ts`).
- [x] 3.2 Add `getContractorSettings(contractorId)` (lazily create empty row) and `saveContractorSettings`.
- [x] 3.3 Add `ensureStarterTemplates(contractorId)` — idempotent seed of a small starter set (Follow-up, Quote ready, Thank you) for contractors with zero templates.
- [x] 3.4 Define the starter templates + a default signature as shared constants.

## 4. Load templates app-wide
- [x] 4.1 In `src/routes/contractor/+layout.server.ts`, call `ensureStarterTemplates`, then return `emailTemplates` + `contractorSettings` (business name + signature) in layout data.

## 5. ContactComposer integration
- [x] 5.1 In `src/lib/ContactComposer.svelte`, read templates + settings from `page.data` (`$app/state`); add optional `project` prop.
- [x] 5.2 In Email mode, add a template picker + a Subject field; selecting a template fills subject + body via `renderTemplate` with `{ customer, contractor, project }`.
- [x] 5.3 On send (email), build `mailto:${email}?subject=…&body=…` from `composeEmail(...)` (subject + body + signature); Text mode unchanged.
- [x] 5.4 Keep subject/body editable after selection; guard send on empty body.
- [x] 5.5 Pass `project` from the order-detail and orders-list composers; omit elsewhere.

## 6. Template administration page
- [x] 6.1 Add `src/routes/contractor/settings/templates/+page.server.ts` (guarded) with load + actions: `createTemplate`, `updateTemplate`, `deleteTemplate`, `reorderTemplate`, `saveSignature`.
- [x] 6.2 Add `+page.svelte`: list templates with edit/delete/reorder, a create form, a signature editor, a placeholder reference, and a live preview using sample values.
- [x] 6.3 Add a nav link to the templates/settings page in `src/routes/contractor/+layout.svelte`.

## 7. Demo & docs
- [x] 7.1 Seed the demo contractor with the starter templates + a signature in the demo fixtures/seeder.
- [x] 7.2 Note the `mailto:` length guidance in the admin UI copy.

## 8. Verification
- [x] 8.1 `pnpm check` passes (0 errors/warnings).
- [x] 8.2 `pnpm test` passes (template-helper unit tests included).
- [ ] 8.3 Manual: pick a template in the composer from each surface → subject/body/signature fill correctly and `mailto:` opens; CRUD + signature edits work from the admin page.
