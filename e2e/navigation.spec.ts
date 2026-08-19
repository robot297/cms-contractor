import { test, expect, clickUntil, signUpContractor } from './fixtures/app';

/**
 * The nav chrome. Small surface, but it is on every screen — a menu that will
 * not close is a menu that blocks the whole app.
 */
test.describe('mobile navigation', () => {
	// The width at which the links collapse behind the hamburger.
	test.use({ viewport: { width: 480, height: 900 } });

	test('the menu opens, and closes again when you tap off it', async ({ page }) => {
		await signUpContractor(page);

		const menu = page.locator('.nav-collapse.open');
		await clickUntil(page.getByRole('button', { name: 'Open menu' }), menu);
		await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();

		// Tapping the page behind it closes it. It used to do nothing at all, which
		// reads as a stuck menu rather than as a deliberate modal — the account
		// menu beside it had had a click-away since it was built.
		await page.getByRole('button', { name: 'Close menu' }).nth(1).click({ force: true });
		await expect(menu).toHaveCount(0);
	});

	test('the X still closes it', async ({ page }) => {
		await signUpContractor(page);

		const menu = page.locator('.nav-collapse.open');
		await clickUntil(page.getByRole('button', { name: 'Open menu' }), menu);
		await page.getByRole('button', { name: 'Close menu' }).first().click();
		await expect(menu).toHaveCount(0);
	});

	test('following a link closes it too', async ({ page }) => {
		await signUpContractor(page);

		const menu = page.locator('.nav-collapse.open');
		await clickUntil(page.getByRole('button', { name: 'Open menu' }), menu);
		await page.getByRole('link', { name: 'Customers' }).click();
		await page.waitForURL('**/contractor/customers');
		await expect(menu).toHaveCount(0);
	});
});
