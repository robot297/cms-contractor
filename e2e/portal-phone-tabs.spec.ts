import { expect } from '@playwright/test';
import { test } from './fixtures/app';
import { customerPage } from './fixtures/portal';

/**
 * The portal's phone tabs, and what each one is allowed to show.
 *
 * Below the tablet breakpoint the bottom bar owns navigation and the order page
 * shows one group at a time. Messages is for the thread and nothing else — the
 * invoice card used to appear under both tabs, so a customer read their balance
 * on the messages screen.
 *
 * Asserted as "these and only these", not "the invoice is hidden". The bug was a
 * hide-list that a newly added section was simply not on; a test that names one
 * section would have the same blind spot the CSS did.
 */
test.use({ viewport: { width: 390, height: 840 } });

const SECTIONS = ['#status', '#invoice', '#documents', '#messages'] as const;

/** Which of the order page's sections are actually on screen. */
async function visibleSections(page: import('@playwright/test').Page): Promise<string[]> {
	return page.evaluate(
		(ids) =>
			ids.filter((id) => {
				const el = document.querySelector(id);
				return el !== null && getComputedStyle(el).display !== 'none';
			}),
		SECTIONS as unknown as string[]
	);
}

test.describe('portal phone tabs', () => {
	test('Messages shows the thread and nothing else', async ({ browser }) => {
		const page = await customerPage(browser);
		await page.waitForSelector('#status');
		const order = page.url().split('?')[0];

		// Project first, to prove the invoice is genuinely on this job — otherwise
		// the Messages assertion below would pass on a job that has no invoice.
		expect(await visibleSections(page)).toEqual(['#status', '#invoice', '#documents']);

		await page.goto(`${order}?view=messages`);
		await page.waitForSelector('#messages');
		expect(await visibleSections(page)).toEqual(['#messages']);

		await page.close();
	});
});
