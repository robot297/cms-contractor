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

/**
 * The contact panel on a phone.
 *
 * It used to span sideways. `.panel` is a grid, its implicit column is `auto`
 * (which sizes to MAX-CONTENT), so the panel took its width from the widest
 * thing inside it — the four-channel tab strip, ~476px — and sat in a 364px
 * popover. Everything below inherited that as the width to truncate against, so
 * a long project name had 391px to play with and never ellipsised.
 *
 * Asserted by MEASUREMENT rather than by screenshot: nothing may reach past the
 * viewport's right edge, and nothing may be sideways-scrollable. A long project
 * name is seeded first, because the fixture's own names are short enough to hide
 * the bug.
 */
test.use({ viewport: { width: 390, height: 844 } });

test.describe('contact panel on a phone', () => {
	test('nothing spans past the viewport, on any channel', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		await createOrder(
			page,
			newOrderFields(DEV_CUSTOMER.name, {
				projectName: `Full kitchen remodel and rear extension phase two ${uid()}`
			})
		);

		await page.goto('/contractor/people');
		await page.getByPlaceholder('Search').fill(DEV_CUSTOMER.name);
		await page.locator('.contact-open').first().waitFor();
		await clickUntil(page.locator('.chat-btn').first(), page.locator('dialog.contact-dialog'));

		for (const channel of ['Chat', 'Email', 'Text', 'Call']) {
			const btn = page.getByRole('button', { name: new RegExp(channel) }).first();
			if (await btn.isVisible().catch(() => false)) await btn.click();

			const offenders = await page.evaluate((label) => {
				const vw = document.documentElement.clientWidth;
				const out: string[] = [];
				for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
					const r = el.getBoundingClientRect();
					if (r.width === 0) continue;
					// Real sideways scroll only. An ellipsised span reports
					// scrollWidth > clientWidth and cannot actually be scrolled, so the
					// overflow-x check is what separates a bug from working truncation.
					const scrolls =
						el.scrollWidth > el.clientWidth + 1 &&
						['auto', 'scroll'].includes(getComputedStyle(el).overflowX);
					if (r.right > vw + 1 || scrolls)
						out.push(`${label}: ${el.tagName}.${(el.className || '').toString().slice(0, 40)}`);
				}
				return out;
			}, channel);

			expect(offenders, `${channel} channel overflows`).toEqual([]);
		}

		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
	});

	test('the job picker is one select, and opens on an open job', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		const live = `Live job ${uid()}`;
		await createOrder(page, newOrderFields(DEV_CUSTOMER.name, { projectName: live }));

		await page.goto('/contractor/people');
		await page.getByPlaceholder('Search').fill(DEV_CUSTOMER.name);
		await page.locator('.contact-open').first().waitFor();
		await clickUntil(page.locator('.chat-btn').first(), page.locator('dialog.contact-dialog'));

		// One control for every case — the ‹ › arrows and the per-job tab strip are
		// both gone, and neither may come back on a phone.
		await expect(page.locator('.proj-arrow')).toHaveCount(0);
		await expect(page.locator('.proj-tab')).toHaveCount(0);

		const select = page.locator('.proj-pick select');
		await expect(select).toBeVisible();

		// It opens on a LIVE job, not merely the newest. A reply typed without
		// looking must not land on a thread that closed last spring.
		const openedOn = await page.evaluate(() => {
			const sel = document.querySelector('.proj-pick select') as HTMLSelectElement;
			const chosen = sel.selectedOptions[0];
			const parent = chosen.parentElement;
			return {
				group: parent instanceof HTMLOptGroupElement ? parent.label : null,
				grouped: sel.querySelectorAll('optgroup').length > 0
			};
		});
		// Grouped whenever there is finished work to separate out; when everything
		// is live there is nothing to group and the flat list is correct.
		if (openedOn.grouped) expect(openedOn.group).toBe('Open');

		// And the select must fit the panel it is in, which is the whole point.
		const width = await select.evaluate((el) => el.getBoundingClientRect().width);
		const panel = await page.locator('.panel').evaluate((el) => el.clientWidth);
		expect(width).toBeLessThanOrEqual(panel + 1);
	});
});
