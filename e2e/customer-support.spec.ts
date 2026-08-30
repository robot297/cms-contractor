import { expect } from '@playwright/test';
import { test } from './fixtures/app';
import { customerPage } from './fixtures/portal';

/**
 * Support, in the portal, on a tab of Account.
 *
 * It used to be `/customer/support`, a top-level entry in a nav whose every
 * other item is the customer's own job. It moved for the same reason the
 * contractor's did — see `/contractor/settings?tab=support` — and the two now
 * render the SAME form component, so this spec is as much about the move not
 * having stranded anything as it is about the pane itself.
 */
test.describe('customer support', () => {
	test('the old route still lands on the pane', async ({ browser }) => {
		const page = await customerPage(browser);

		// 308, because the portal carried this URL for the whole of its life: it is
		// bookmarked, and it is what the emailed footer points at.
		await page.goto('/customer/support');
		await expect(page).toHaveURL(/\/customer\/account\?tab=support$/);
		await expect(
			page.getByRole('navigation', { name: 'Account sections' }).getByRole('link', {
				name: 'Support'
			})
		).toHaveAttribute('aria-current', 'page');

		await page.close();
	});

	test('the tabs swap the pane and nothing else', async ({ browser }) => {
		const page = await customerPage(browser);
		await page.goto('/customer/account');

		const tabs = page.getByRole('navigation', { name: 'Account sections' });
		// Account is the default pane, and Appearance is the thing that proves it —
		// it is the portal's only theme control at any width.
		await expect(page.getByText('Appearance')).toBeVisible();

		await tabs.getByRole('link', { name: 'Support' }).click();
		await expect(page).toHaveURL(/tab=support/);
		// The form, or the "not set up yet" notice that stands in for it without
		// GitHub credentials. Asserted on the control rather than on prose: the
		// blurb this used to look for was removed as fluff, and a test pinned to
		// copy fails on a wording change that broke nothing.
		await expect(page.locator('form[action="?/submitSupport"], .notice')).toBeVisible();
		// The panes are alternatives, not sections stacked on one page.
		await expect(page.getByText('Appearance')).toHaveCount(0);

		await tabs.getByRole('link', { name: 'Account' }).click();
		await expect(page.getByText('Appearance')).toBeVisible();

		await page.close();
	});

	test('the account menu deep-links to the pane', async ({ browser }) => {
		const page = await customerPage(browser);
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/customer/account');

		// The menu behind the avatar is the desktop's only route to either pane, so
		// it points at the tab rather than dropping you on Account to go find it.
		await page.getByRole('button', { name: 'Account menu' }).click();
		await page.getByRole('menuitem', { name: 'Support' }).click();

		await expect(page).toHaveURL(/\/customer\/account\?tab=support/);
		await expect(page.locator('form[action="?/submitSupport"], .notice')).toBeVisible();

		await page.close();
	});
});
