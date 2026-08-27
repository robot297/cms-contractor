/**
 * The contractor app and the customer portal keep SEPARATE theme preferences.
 *
 * One browser profile, two people: a contractor previews the portal from their
 * own session, and before this split whichever of them last touched a switch
 * redecorated the other's app. The rule that divides them is a path prefix, and
 * it is written down TWICE — here in `scopeForPath`, and again as plain ES5 in
 * the pre-paint script in src/app.html, which cannot import anything because it
 * has to run before the bundle does.
 *
 * Two copies of one rule is exactly the thing that drifts, so this file pins
 * both: the function's answers, and the fact that app.html still agrees with it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { scopeForPath } from './theme.svelte';

describe('scopeForPath', () => {
	it('claims the portal and its descendants', () => {
		expect(scopeForPath('/customer')).toBe('portal');
		expect(scopeForPath('/customer/account')).toBe('portal');
		expect(scopeForPath('/customer/orders/abc123')).toBe('portal');
	});

	it('leaves the contractor side and the signed-out pages to the app scope', () => {
		expect(scopeForPath('/')).toBe('app');
		expect(scopeForPath('/login')).toBe('app');
		expect(scopeForPath('/pricing')).toBe('app');
		expect(scopeForPath('/contractor')).toBe('app');
		expect(scopeForPath('/contractor/orders/abc123')).toBe('app');
	});

	it('does not hand the portal a route that merely starts with the same letters', () => {
		// `/customers` is not `/customer` — a plain `startsWith('/customer')` would
		// have said it was, and any future route named that way would silently take
		// the portal's saved theme with it.
		expect(scopeForPath('/customers')).toBe('app');
		expect(scopeForPath('/customer-portal-signup')).toBe('app');
	});
});

describe('the pre-paint script in app.html', () => {
	const html = readFileSync('src/app.html', 'utf8');

	it('applies the same prefix rule', () => {
		expect(html).toContain("path === '/customer' || path.indexOf('/customer/') === 0");
	});

	it('reads the scoped keys, so first paint agrees with the store', () => {
		expect(html).toContain("var suffix = portal ? ':portal' : '';");
		expect(html).toContain("localStorage.getItem('theme' + suffix)");
		expect(html).toContain("localStorage.getItem('palette' + suffix)");
	});
});
