import { test, expect, signIn, DEV_CUSTOMER, DEV_CONTRACTOR } from './fixtures/app';

/**
 * Two halves of the product, two themes, one browser.
 *
 * The contractor previews the portal from their own session, so both sides are
 * routinely looked at through the same profile. They keep separate preferences:
 * bare `theme` / `palette` keys for the contractor app and every signed-out
 * page, `:portal`-suffixed ones for the customer portal.
 */
test.describe('theme scope', () => {
	/** Both sides' preferences set, deliberately to different values. */
	const seedBoth = (page: import('@playwright/test').Page) =>
		page.addInitScript(() => {
			localStorage.setItem('theme', 'dark');
			localStorage.setItem('palette', 'ledger');
			localStorage.setItem('theme:portal', 'light');
			localStorage.setItem('palette:portal', 'ember');
		});

	test('the portal wears its own theme, not the contractor’s', async ({ page }) => {
		await seedBoth(page);
		await signIn(page, DEV_CUSTOMER.email, DEV_CUSTOMER.password);
		await page.waitForURL('**/customer**');

		const first = await page.evaluate(() => ({ ...document.documentElement.dataset }));
		expect(first.theme).toBe('light');
		expect(first.palette).toBe('ember');

		// A SvelteKit navigation never reloads the document, so the pre-paint script
		// in app.html cannot be what holds this — the root layout's afterNavigate is.
		await page.locator('a[href="/customer/account"]').first().click();
		await page.waitForURL('**/customer/account');
		const after = await page.evaluate(() => ({ ...document.documentElement.dataset }));
		expect(after.theme).toBe('light');
		expect(after.palette).toBe('ember');

		// Nothing the portal did wrote over the contractor's saved choice.
		const stored = await page.evaluate(() => ({
			app: localStorage.getItem('theme'),
			portal: localStorage.getItem('theme:portal')
		}));
		expect(stored).toEqual({ app: 'dark', portal: 'light' });
	});

	test('the contractor side keeps the bare keys', async ({ page }) => {
		await seedBoth(page);
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');

		const app = await page.evaluate(() => ({ ...document.documentElement.dataset }));
		expect(app.theme).toBe('dark');
		expect(app.palette).toBe('ledger');
	});

	/**
	 * The portal's chrome used to be two colours arguing: its own panels drawn in
	 * `--who-customer`, and every focus ring, selection and icon-button hover
	 * drawn in the CONTRACTOR's `--brand`, because those rules live in app.css and
	 * reach for the shared token. `.shell` repoints the whole brand family.
	 */
	test('the portal repoints the brand family at its own accent', async ({ page }) => {
		await signIn(page, DEV_CUSTOMER.email, DEV_CUSTOMER.password);
		await page.waitForURL('**/customer**');
		await page.waitForSelector('.shell');

		const seen = await page.evaluate(() => {
			const shell = getComputedStyle(document.querySelector('.shell')!);
			const root = getComputedStyle(document.documentElement);
			return {
				rootBrand: root.getPropertyValue('--brand').trim(),
				shellBrand: shell.getPropertyValue('--brand').trim(),
				shellAccent: shell.getPropertyValue('--accent').trim()
			};
		});

		expect(seen.shellBrand).toBe(seen.shellAccent);
		expect(seen.shellBrand).not.toBe(seen.rootBrand);
	});
});
