import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { viewAsDecision } from './view-as.server';

/**
 * The impersonation guard, which is the only part of this feature that has to be
 * right. Its decision tree is lifted into `viewAsDecision` so it can be executed
 * without a database — this project has no DB test harness, and the tree above
 * the ownership query is where a mistake would hand one contractor another's
 * customer.
 *
 * The rule, in one line: refuse unless the flag is on AND the caller is a
 * contractor AND they still own the named customer — and every refusal CLEARS
 * the cookie rather than merely ignoring it.
 */

const CONTRACTOR = { id: 'contractor-1', role: 'contractor' };
const CUSTOMER = { id: 'user-2', role: 'customer' };

describe('viewAsDecision', () => {
	it('leaves a request with no selection alone', () => {
		expect(viewAsDecision(undefined, true, CONTRACTOR)).toBe('none');
	});

	it('clears a stale selection once the flag is off', () => {
		// The load-bearing case: a build shipping with the flag off must behave as
		// if the feature never existed, even for a browser holding a selection.
		expect(viewAsDecision('customer-9', false, CONTRACTOR)).toBe('clear');
	});

	it('clears for a signed-out visitor', () => {
		expect(viewAsDecision('customer-9', true, undefined)).toBe('clear');
	});

	it('clears for a real customer holding the cookie', () => {
		expect(viewAsDecision('customer-9', true, CUSTOMER)).toBe('clear');
	});

	it('clears for a subcontractor holding the cookie', () => {
		expect(viewAsDecision('customer-9', true, { id: 'u3', role: 'subcontractor' })).toBe('clear');
	});

	it('proceeds to the ownership check for a contractor with the flag on', () => {
		expect(viewAsDecision('customer-9', true, CONTRACTOR)).toBe('check');
	});

	it('never reaches the ownership check without the flag, whoever is asking', () => {
		for (const user of [CONTRACTOR, CUSTOMER, undefined]) {
			expect(viewAsDecision('customer-9', false, user)).toBe('clear');
		}
	});
});

const source = readFileSync('src/lib/server/view-as.server.ts', 'utf8');

describe('resolveViewAs wires the decision to the database', () => {
	const body = source.slice(source.indexOf('export async function resolveViewAs'));

	it('clears the cookie on a clear decision', () => {
		expect(body).toMatch(/if \(decision === 'clear'\) \{\s*clearViewAsCookie\(cookies\);/);
	});

	it('clears the cookie when ownership fails', () => {
		// A refusal that left the cookie in place would retry the lookup on every
		// request forever, and would keep a revoked selection looking live.
		expect(body).toMatch(/if \(!owned\) \{\s*clearViewAsCookie\(cookies\);/);
	});

	it('reads ownership from the database rather than from the cookie', () => {
		expect(body).toMatch(/await ownsCustomer\(/);
	});

	it('scopes the ownership query to the asking contractor', () => {
		const owns = source.slice(source.indexOf('export async function ownsCustomer'));
		expect(owns).toMatch(/eq\(customer\.contractorId, contractorId\)/);
		expect(owns).toMatch(/eq\(customer\.id, customerId\)/);
	});
});

describe('the flag is read the same way as the other dev tools', () => {
	it('compares against exactly "true" through varlock ENV', () => {
		// Anything looser turns the feature on for CUSTOMER_PORTAL_DEV_TOOLS=false.
		expect(source).toMatch(/String\(ENV\.CUSTOMER_PORTAL_DEV_TOOLS\) === 'true'/);
	});

	it('accepts the value however varlock typed it', () => {
		// Varlock coerces an unquoted `FLAG=true` to a boolean and keeps `FLAG="true"`
		// a string. Comparing the raw value against 'true' silently ignores the first
		// form, which reads as "the feature is broken" rather than "quote your value".
		const enabled = (raw: unknown) => String(raw) === 'true';
		expect(enabled('true')).toBe(true);
		expect(enabled(true)).toBe(true);
	});

	it('stays off for every other value', () => {
		const enabled = (raw: unknown) => String(raw) === 'true';
		for (const off of ['', 'false', false, 'TRUE', '1', 1, 'yes', undefined, null]) {
			expect(enabled(off)).toBe(false);
		}
	});
});

describe('the entry endpoint is guarded the same way', () => {
	const endpoint = readFileSync('src/routes/dev/view-as/+server.ts', 'utf8');

	it('refuses when the flag is off', () => {
		expect(endpoint).toMatch(/if \(!isViewAsEnabled\(\)\)/);
	});

	it('clears the cookie even on the refusal path', () => {
		const guard = endpoint.slice(endpoint.indexOf('if (!isViewAsEnabled())'));
		expect(guard.slice(0, 200)).toMatch(/clearViewAsCookie\(cookies\)/);
	});

	it('refuses a non-contractor', () => {
		expect(endpoint).toMatch(/locals\.user\?\.role !== 'contractor'/);
	});

	it('checks ownership before setting the cookie', () => {
		const owned = endpoint.indexOf('ownsCustomer(');
		const set = endpoint.indexOf('setViewAsCookie(');
		expect(owned).toBeGreaterThan(-1);
		expect(set).toBeGreaterThan(owned);
	});

	it('answers 404 rather than 403 so the route looks undeployed', () => {
		// A 403 confirms the feature exists on this deployment; a 404 does not.
		expect(endpoint).not.toMatch(/error\(403/);
		expect(endpoint).toMatch(/error\(404/);
	});
});
