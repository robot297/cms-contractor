import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Billing enforcement is per-write rather than a single guard on the /contractor
 * layout, because a lapsed contractor must still be able to READ everything they
 * built (docs/adr/0005-lapsing-never-reaches-customers.md). The cost of that choice
 * is that a contractor write added later can forget the guard.
 *
 * These tests are that safety net. They read the source rather than executing it —
 * crude, but it fails loudly the moment someone adds an unguarded mutation, which
 * is precisely when a runtime test would still pass.
 */

const SRC = 'src/lib/server';
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');

/** Extract a top-level `export [async] function name(...) { ... }` body. */
function functionBody(source: string, name: string): string {
	const start = source.search(new RegExp(`^export (?:async )?function ${name}\\b`, 'm'));
	if (start === -1) throw new Error(`${name} not found — was it renamed or removed?`);
	// Top-level functions in these modules close on a column-zero brace.
	const end = source.indexOf('\n}', start);
	return source.slice(start, end === -1 ? undefined : end);
}

const guarded = (body: string) => /await assertCan(Write|Create)\(/.test(body);

describe('contractor writes are billing-guarded', () => {
	const crm = read('crm.server.ts');
	const subs = read('subcontractor.server.ts');
	const templates = read('templates.server.ts');

	it.each([
		'createCustomer',
		'editCustomer',
		'archiveCustomer',
		'setCustomerAvatar',
		'createOrder',
		'setFollowUp',
		'setOrderIcon',
		'setOrderTags',
		'updateOrderState',
		'addAttachment',
		'deleteAttachment',
		'addOrderNote',
		'deleteOrder',
		'createInvite',
		'resendInvite',
		'revokeInvite',
		'deleteInvite'
	])('crm.server.ts %s calls a billing guard', (fn) => {
		expect(guarded(functionBody(crm, fn))).toBe(true);
	});

	it.each([
		'createSubcontractor',
		'editSubcontractor',
		'archiveSubcontractor',
		'setSubcontractorTier',
		'setSubcontractorAvatar',
		'createSubcontractorInvite',
		'resendSubcontractorInvite',
		'revokeSubcontractorInvite',
		'assignSubcontractor',
		'unassignSubcontractor'
	])('subcontractor.server.ts %s calls a billing guard', (fn) => {
		expect(guarded(functionBody(subs, fn))).toBe(true);
	});

	it.each([
		'createEmailTemplate',
		'updateEmailTemplate',
		'deleteEmailTemplate',
		'reorderEmailTemplates',
		'saveContractorSettings'
	])('templates.server.ts %s calls a billing guard', (fn) => {
		expect(guarded(functionBody(templates, fn))).toBe(true);
	});

	// Creation is the only thing trial limits gate — never editing.
	it.each([
		['crm.server.ts', 'createCustomer', "'customer'"],
		['crm.server.ts', 'createOrder', "'order'"],
		['subcontractor.server.ts', 'createSubcontractor', "'subcontractor'"]
	])('%s %s enforces the trial limit for %s', (file, fn, kind) => {
		const body = functionBody(read(file), fn);
		expect(body).toContain(`assertCanCreate(contractorId, ${kind})`);
	});
});

describe('portal paths are never billing-guarded', () => {
	const crm = read('crm.server.ts');
	const subs = read('subcontractor.server.ts');

	// ADR-0005: a lapsed contractor's customers and subcontractors are unaffected.
	// A guard appearing here is a regression, not a tidy-up.
	it.each([
		'getCustomerPortal',
		'addCustomerRequest',
		'bindInviteToken',
		'bindCustomerByEmail',
		'markNotificationRead'
	])('crm.server.ts %s stays unguarded', (fn) => {
		expect(guarded(functionBody(crm, fn))).toBe(false);
	});

	it.each([
		'subcontractorOrderView',
		'addSubcontractorNote',
		'addSubcontractorAttachment',
		'bindSubcontractorInviteToken',
		'bindSubcontractorByEmail',
		'listAssignedOrdersForUser'
	])('subcontractor.server.ts %s stays unguarded', (fn) => {
		expect(guarded(functionBody(subs, fn))).toBe(false);
	});

	it('no portal route imports the billing module', () => {
		for (const dir of ['src/routes/customer', 'src/routes/subcontractor']) {
			for (const file of walk(dir)) {
				expect(readFileSync(file, 'utf8')).not.toContain('billing.server');
			}
		}
	});
});

describe('contractor form actions surface billing refusals', () => {
	// Every contractor route with form actions must wrap them, so a 402 comes back
	// as a form error rather than a 500 — and so a newly added action is covered
	// without anyone remembering to opt in.
	it('every contractor actions object is wrapped', () => {
		const offenders: string[] = [];
		for (const file of walk('src/routes/contractor')) {
			if (!file.endsWith('+page.server.ts')) continue;
			const source = readFileSync(file, 'utf8');
			if (!source.includes('export const actions')) continue;
			// Two deliberate exemptions, both because they must keep working for a
			// contractor who is currently blocked:
			//   - /support files a GitHub issue, not contractor data. Someone who has
			//     just hit the paywall may well need to reach us.
			//   - /billing is where they go to fix it. Nothing on it is guarded.
			if (file.includes('/support/') || file.includes('/billing/')) continue;
			if (!source.includes('withBillingErrors(')) offenders.push(file);
		}
		expect(offenders).toEqual([]);
	});
});

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}
