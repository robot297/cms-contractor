import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { customer, order, subcontractor } from './db/schema';
import { assertCanWrite } from './billing.server';

/**
 * A contractor's tag vocabulary.
 *
 * There is no tag table. The list of tags a contractor can pick from is *derived*
 * from the tags actually in use across their customers, orders and subcontractors
 * — the same rule the Guide follows (see
 * docs/adr/0004-derive-guide-progress-from-domain-data.md). A registry would let
 * the two disagree: a tag could exist in the list while no record carries it, or a
 * record could carry a tag the list has never heard of.
 *
 * The consequence is that "delete a tag" means removing it from every record that
 * holds it — there is nowhere else for it to live. That is why the UI confirms.
 *
 * Archived customers/subcontractors and deleted orders still contribute. Their
 * tags are part of the contractor's vocabulary, and dropping a tag out of the
 * suggestions just because the last record using it was archived would be
 * surprising.
 */

/** Every distinct tag this contractor uses, case-sensitive, alphabetical. */
export async function listContractorTags(contractorId: string): Promise<string[]> {
	const [customers, orders, subs] = await Promise.all([
		db
			.select({ tags: customer.tags })
			.from(customer)
			.where(eq(customer.contractorId, contractorId)),
		db.select({ tags: order.tags }).from(order).where(eq(order.contractorId, contractorId)),
		db
			.select({ tags: subcontractor.tags })
			.from(subcontractor)
			.where(eq(subcontractor.contractorId, contractorId))
	]);

	const seen = new Set<string>();
	for (const row of [...customers, ...orders, ...subs]) {
		for (const tag of row.tags) seen.add(tag);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Remove a tag from every record this contractor owns — the only way to retire a
 * tag, since the vocabulary is derived from usage. Scoped by `contractorId`, so
 * one contractor can never affect another's records.
 *
 * Reached from the settings page, not from the inline tag picker: it is global and
 * irreversible, which is the wrong shape for a control sitting in every form.
 */
export async function deleteContractorTag(contractorId: string, tag: string): Promise<void> {
	await assertCanWrite(contractorId);
	const trimmed = tag.trim();
	if (!trimmed) return;

	await Promise.all([
		db
			.update(customer)
			.set({ tags: sql`array_remove(${customer.tags}, ${trimmed})` })
			.where(eq(customer.contractorId, contractorId)),
		db
			.update(order)
			.set({ tags: sql`array_remove(${order.tags}, ${trimmed})` })
			.where(eq(order.contractorId, contractorId)),
		db
			.update(subcontractor)
			.set({ tags: sql`array_remove(${subcontractor.tags}, ${trimmed})` })
			.where(eq(subcontractor.contractorId, contractorId))
	]);
}
