import { expect } from '@playwright/test';
import { test } from './fixtures/app';
import { uid } from './fixtures/app';
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

	/**
	 * Opening Messages puts you on the newest message.
	 *
	 * The thread is mounted the whole time on this layout — Project and Messages
	 * are one page with the other half hidden — so the scroll-to-bottom used to
	 * run against a `display: none` box, where `scrollHeight` is 0 and setting
	 * `scrollTop` does nothing. The tab then opened on the OLDEST message.
	 *
	 * Reached by the bottom bar rather than `goto`, because that is the path with
	 * the bug in it: a full load remounts the thread with the section already
	 * visible and passes either way.
	 */
	test('opening Messages lands on the newest message', async ({ browser }) => {
		const page = await customerPage(browser);
		await page.waitForSelector('#status');

		const messagesTab = page.locator('nav.bottombar').getByRole('link', { name: 'Messages' });
		const thread = page.locator('#messages .thread');

		await messagesTab.click();
		await expect(thread).toBeVisible();

		// The seeded thread is short enough to fit, and a thread that fits cannot
		// prove anything about scrolling. Say enough to overflow the box first.
		const composer = page.locator('form[action="?/send"]');
		for (let i = 1; i <= 6; i++) {
			const line = `Scroll check ${i} — ${uid()}`;
			await composer.locator('textarea').fill(line);
			await composer.getByRole('button', { name: 'Send message' }).click();
			await expect(page.getByText(line)).toBeVisible();
		}
		const overflows = await thread.evaluate((el) => el.scrollHeight > el.clientHeight + 8);
		expect(overflows, 'thread should overflow after six messages').toBe(true);

		// Land on Project, so the thread mounts while it is `display: none` — this
		// is the state the bug lived in. Coming BACK from Messages is not the same
		// thing: the box keeps the scroll position it was already given.
		await page.goto(page.url().split('?')[0]);
		await expect(page.locator('#messages')).toBeHidden();
		await messagesTab.click();
		await expect(thread).toBeVisible();

		await expect
			.poll(async () => thread.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
			.toBeLessThanOrEqual(2);

		await page.close();
	});
});
