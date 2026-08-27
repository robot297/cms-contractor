import { expect } from '@playwright/test';
import {
	test,
	signIn,
	clickUntil,
	createOrder,
	newOrderFields,
	DEV_CONTRACTOR,
	DEV_CUSTOMER,
	uid
} from './fixtures/app';
import { openTab } from './fixtures/order';

/**
 * What the job is waiting on the customer for, above the history.
 *
 * It used to be the first of the workspace's tabs, "Waiting on them", wearing a
 * count — on every job whether or not anything was waiting, so most of the time
 * it was a permanent label over an empty list, with a panel behind it whose only
 * content was "Nothing is waiting on Dana".
 *
 * It is a blurb above the history now, and the whole point is that it is absent
 * when there is nothing to say. Both halves are asserted here: the quiet state
 * is as much the feature as the loud one.
 */
test.describe('asks above the history', () => {
	test('silent when nothing is waiting, and the ask control still reachable', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		await page.goto(await createOrder(page, newOrderFields(DEV_CUSTOMER.name)));

		// The tab is gone. Named explicitly, because the bug this replaces was a
		// tab that was always there.
		await expect(page.getByRole('tab', { name: /Waiting on them/ })).toHaveCount(0);

		await openTab(page, 'History');
		await expect(page.locator('.ask-banner')).toHaveCount(0);
		// Asking has to survive the blurb being hidden — it is the only way to
		// create the state that shows it.
		await expect(
			page.getByRole('button', { name: 'Ask the customer for something' })
		).toBeVisible();
	});

	test('a blurb in the customer’s own words, above the history', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		await page.goto(await createOrder(page, newOrderFields(DEV_CUSTOMER.name)));
		await openTab(page, 'History');

		const ask = `Gate code ${uid()}`;
		// clickUntil, not click: a control whose handler has not hydrated yet is
		// visible, enabled and completely inert.
		await clickUntil(
			page.getByRole('button', { name: 'Ask the customer for something' }),
			page.locator('#panel-history form[action="?/addTask"]')
		);
		const form = page.locator('#panel-history form[action="?/addTask"]');
		await form.getByLabel('What you need').fill(ask);
		await clickUntil(
			form.getByRole('button', { name: 'Ask them' }),
			page.locator('#panel-history .ask-list').getByText(ask)
		);

		const banner = page.locator('.ask-banner');
		await expect(banner).toBeVisible();
		// Tagged, because the sentence is addressed to the CUSTOMER — "this one's
		// with you". Untagged on this screen it is a pronoun pointing at the wrong
		// person, which is what the panel it replaced used the same tag to avoid.
		await expect(banner).toContainText('They see');
		await expect(banner).toContainText('with you');

		// Above the history, not under it — the whole placement of the feature.
		const placement = await page.evaluate(() => {
			const b = document.querySelector('.ask-banner');
			const h = [...document.querySelectorAll('#panel-history h2')].find(
				(e) => e.textContent?.trim() === 'History'
			);
			if (!b || !h) return 'missing';
			return b.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before' : 'after';
		});
		expect(placement).toBe('before');
	});
});
