import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { contractorSettings, emailTemplate } from './db/schema';
import { DEFAULT_SIGNATURE, isFollowUpDays, STARTER_EMAIL_TEMPLATES } from '$lib/crm';
// Billing gate. Applied to the contractor's own edits only — `ensureStarterTemplates`
// and `getContractorSettings` below are provisioning, not contractor writes, and
// must keep working for a lapsed contractor so their surfaces still render.
import { assertCanWrite } from './billing.server';

export type EmailTemplateRow = typeof emailTemplate.$inferSelect;
export type ContractorSettingsRow = typeof contractorSettings.$inferSelect;

/** A template's editable fields (what create/update accept). */
export type TemplateInput = { name: string; subject: string; body: string };

// ------------------------------------------------------------ Templates: read

/** All of a contractor's templates in their configured order. Contractor-scoped. */
export async function listEmailTemplates(contractorId: string): Promise<EmailTemplateRow[]> {
	return db
		.select()
		.from(emailTemplate)
		.where(eq(emailTemplate.contractorId, contractorId))
		.orderBy(asc(emailTemplate.sortOrder), asc(emailTemplate.createdAt));
}

// ------------------------------------------------------------ Templates: write

/** Create a template, appended after the contractor's existing ones. */
export async function createEmailTemplate(
	contractorId: string,
	input: TemplateInput
): Promise<EmailTemplateRow> {
	await assertCanWrite(contractorId);
	const existing = await listEmailTemplates(contractorId);
	const nextOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder + 1), 0);
	const [row] = await db
		.insert(emailTemplate)
		.values({ contractorId, sortOrder: nextOrder, ...input })
		.returning();
	return row;
}

/** Update a template's name/subject/body. No-op if it isn't the contractor's. */
export async function updateEmailTemplate(
	id: string,
	contractorId: string,
	input: TemplateInput
): Promise<void> {
	await assertCanWrite(contractorId);
	await db
		.update(emailTemplate)
		.set(input)
		.where(and(eq(emailTemplate.id, id), eq(emailTemplate.contractorId, contractorId)));
}

/** Hard-delete a template. Scoped so a contractor can only delete their own. */
export async function deleteEmailTemplate(id: string, contractorId: string): Promise<void> {
	await assertCanWrite(contractorId);
	await db
		.delete(emailTemplate)
		.where(and(eq(emailTemplate.id, id), eq(emailTemplate.contractorId, contractorId)));
}

/**
 * Persist a new ordering for the contractor's templates: each id is assigned a
 * `sortOrder` equal to its index in `orderedIds`. Ids not owned by the contractor
 * are ignored (the scoped WHERE no-ops them).
 */
export async function reorderEmailTemplates(
	contractorId: string,
	orderedIds: string[]
): Promise<void> {
	await assertCanWrite(contractorId);
	await db.transaction(async (tx) => {
		for (let i = 0; i < orderedIds.length; i++) {
			await tx
				.update(emailTemplate)
				.set({ sortOrder: i })
				.where(
					and(eq(emailTemplate.id, orderedIds[i]), eq(emailTemplate.contractorId, contractorId))
				);
		}
	});
}

// ------------------------------------------------------------ Settings

/** The contractor's branding settings, lazily creating an empty row on first read. */
export async function getContractorSettings(contractorId: string): Promise<ContractorSettingsRow> {
	const existing = await db.query.contractorSettings.findFirst({
		where: eq(contractorSettings.contractorId, contractorId)
	});
	if (existing) return existing;
	const [row] = await db
		.insert(contractorSettings)
		.values({ contractorId })
		.onConflictDoNothing()
		.returning();
	// A concurrent request may have created it first; re-read to be safe.
	return (
		row ??
		(await db.query.contractorSettings.findFirst({
			where: eq(contractorSettings.contractorId, contractorId)
		}))!
	);
}

/** Save the contractor's business name + signature, creating the row if needed. */
export async function saveContractorSettings(
	contractorId: string,
	input: { businessName: string; signature: string }
): Promise<void> {
	await assertCanWrite(contractorId);
	await db
		.insert(contractorSettings)
		.values({ contractorId, ...input })
		.onConflictDoUpdate({ target: contractorSettings.contractorId, set: input });
}

/**
 * Set how far out new orders schedule their first follow-up. Only affects orders
 * created from here on — follow-ups already on the board are dates the
 * contractor may have moved by hand, and rewriting those would undo real work.
 */
export async function saveFollowUpDays(contractorId: string, days: number): Promise<void> {
	await assertCanWrite(contractorId);
	if (!isFollowUpDays(days)) throw new Error('Unsupported follow-up interval');
	await db
		.insert(contractorSettings)
		.values({ contractorId, followUpDays: days })
		.onConflictDoUpdate({
			target: contractorSettings.contractorId,
			set: { followUpDays: days }
		});
}

/**
 * Put the trial welcome away. Deliberately not billing-guarded, like the Guide's
 * dismiss: it is a UI preference, not domain data.
 */
export async function dismissTrialNotice(contractorId: string): Promise<void> {
	await db
		.insert(contractorSettings)
		.values({ contractorId, trialNoticeDismissedAt: new Date() })
		.onConflictDoUpdate({
			target: contractorSettings.contractorId,
			set: { trialNoticeDismissedAt: new Date() }
		});
}

// ------------------------------------------------------------ Seeding

/**
 * Ensure a contractor with no templates starts with the starter set and a settings
 * row carrying the default signature. Idempotent: a no-op once any template exists,
 * so it is safe to call on every contractor page load.
 */
export async function ensureStarterTemplates(contractorId: string): Promise<void> {
	const existing = await db.query.emailTemplate.findFirst({
		where: eq(emailTemplate.contractorId, contractorId),
		columns: { id: true }
	});
	if (existing) return;
	await db.insert(emailTemplate).values(
		STARTER_EMAIL_TEMPLATES.map((t, i) => ({
			contractorId,
			name: t.name,
			subject: t.subject,
			body: t.body,
			sortOrder: i
		}))
	);
	await db
		.insert(contractorSettings)
		.values({ contractorId, signature: DEFAULT_SIGNATURE })
		.onConflictDoNothing();
}
