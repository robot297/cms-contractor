import { test, expect, signIn, signOut, signUpContractor, DEV_CONTRACTOR } from './fixtures/app';

/**
 * Getting in. The gate on everything else, so it is checked on its own rather
 * than only implied by the specs that sign in on their way somewhere.
 */
test.describe('authentication', () => {
	test('a new contractor can sign up and lands on their dashboard', async ({ page }) => {
		const who = await signUpContractor(page);

		await expect(page).toHaveURL(/\/contractor$/);
		// The nav is the proof they are in as a contractor, not merely signed in.
		await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();
		// ONE entry for everyone they know — the people they work for and the people
		// they work with. It was three lists (Customers, Crew, Subcontractors), which
		// meant deciding what somebody was to you before you could look them up.
		await expect(page.getByRole('link', { name: 'People' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Customers' })).toHaveCount(0);
		expect(who.email).toContain('@example.test');
	});

	test('a contractor can sign out and back in', async ({ page }) => {
		const who = await signUpContractor(page);
		await signOut(page);

		// Signed out, the contractor area is off limits.
		await page.goto('/contractor');
		await expect(page).toHaveURL(/\/login/);

		await signIn(page, who.email, who.password);
		await page.waitForURL('**/contractor');
		await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();
	});

	test('the wrong password is refused', async ({ page }) => {
		const who = await signUpContractor(page);
		await signOut(page);

		await signIn(page, who.email, 'not-the-password');
		await expect(page).toHaveURL(/\/login/);
		await expect(page.locator('.error')).toBeVisible();
	});

	test('the seeded dev contractor can sign in', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();
	});
});
