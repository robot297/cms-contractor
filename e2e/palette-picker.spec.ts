import { expect, type Page } from '@playwright/test';
import { test, signIn, clickUntil, DEV_CONTRACTOR } from './fixtures/app';

/**
 * The palette picker's phone sheet.
 *
 * Thirteen palettes one-per-line is a list you scroll past rather than compare,
 * and comparing is the whole job. Two columns puts most of the set on screen at
 * once — but only holds if nothing in a ~150px cell can widen its column, which
 * is what these assertions are really about.
 */

/** Open the sheet from the settings card's switcher, not the bar's hidden one. */
async function openSheet(page: Page) {
	await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
	await page.waitForURL('**/contractor');
	await page.goto('/contractor/settings?tab=workspace');
	// Two switchers exist; below the desktop breakpoint the bar's is hidden.
	const trigger = page.locator('.trigger').filter({ visible: true }).first();
	await clickUntil(trigger, page.locator('.sheet-list'));
}

/** Cell width, plus anything ellipsised or past the viewport. */
async function measure(page: Page) {
	return page.evaluate(() => {
		const list = document.querySelector('.sheet-list') as HTMLElement;
		const opts = [...list.querySelectorAll<HTMLElement>('.opt')];
		const vw = document.documentElement.clientWidth;
		const clipped: string[] = [];
		let past = 0;
		for (const o of opts) {
			for (const el of Array.from(o.querySelectorAll<HTMLElement>('.name, .blurb'))) {
				// display:none reports 0/0, which is not clipping — it is the blurb
				// deliberately absent on the narrowest phones.
				if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
					clipped.push(`${el.textContent?.trim()}`);
			}
			if (o.getBoundingClientRect().right > vw + 1) past++;
		}
		return {
			columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
			options: opts.length,
			rows: new Set(opts.map((o) => Math.round(o.getBoundingClientRect().top))).size,
			past,
			clipped,
			docScrollW: document.documentElement.scrollWidth,
			vw
		};
	});
}

for (const width of [320, 375, 390, 414]) {
	test(`two-up and unclipped at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 800 });
		await openSheet(page);
		const m = await measure(page);

		expect(m.columns, 'two columns').toBe(2);
		// 13 palettes over 2 columns — the halved scroll is the point of the change.
		expect(m.rows).toBe(Math.ceil(m.options / 2));
		expect(m.past, 'cells past the viewport').toBe(0);
		expect(m.docScrollW, 'page scrolls sideways').toBe(m.vw);
		// Nothing renders as an ellipsis. Below 360px the blurb is hidden outright
		// rather than truncated, which is why this holds at 320 too.
		expect(m.clipped).toEqual([]);
	});
}

test.describe('desktop is unchanged', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('still an anchored menu, one palette per line', async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		await page.goto('/contractor/settings?tab=workspace');
		const trigger = page.locator('.trigger').filter({ visible: true }).first();
		await clickUntil(trigger, page.locator('.menu'));

		// The sheet is a phone presentation; a desktop gets the menu it always had,
		// because judging a palette against the app behind it needs no backdrop.
		await expect(page.locator('.sheet-list')).toHaveCount(0);
		const rows = await page.evaluate(() => {
			const opts = [...document.querySelectorAll<HTMLElement>('.menu .opt')];
			return {
				count: opts.length,
				rows: new Set(opts.map((o) => Math.round(o.getBoundingClientRect().top))).size
			};
		});
		expect(rows.rows).toBe(rows.count);
	});
});
