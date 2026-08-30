import { expect } from '@playwright/test';
import { test } from './fixtures/app';
import { customerPage, openPortalOrder } from './fixtures/portal';

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

		// The SEEDED job, by name, rather than whichever one the portal lands on.
		// The invoice assertion below is what proves this job has other sections to
		// hide, and only the seeded job is guaranteed to carry one — the suite opens
		// plenty of other jobs against this customer, and any of them can be the one
		// the portal opens on by the time this runs.
		//
		// Picked at tablet width and then narrowed back: switching jobs is a rail
		// affordance, and on a phone there is deliberately no way to do it — the
		// bottom bar navigates within one job and the hamburger is retired.
		await page.setViewportSize({ width: 900, height: 840 });
		await openPortalOrder(page, 'Kitchen remodel');
		await page.setViewportSize({ width: 390, height: 840 });
		const order = page.url().split('?')[0];

		// Project first, to prove the invoice is genuinely on this job — otherwise
		// the Messages assertion below would pass on a job that has no invoice.
		expect(await visibleSections(page)).toEqual(['#status', '#invoice', '#documents']);

		await page.goto(`${order}?view=messages`);
		await page.waitForSelector('#messages');
		expect(await visibleSections(page)).toEqual(['#messages']);

		await page.close();
	});

	/*
	 * "Opening Messages lands on the newest message" lived here and has moved to
	 * `messages-screen.spec.ts`, which asserts the thing this was reaching for on
	 * BOTH sides of the conversation: the newest message and the composer are on
	 * screen, no scrolling either way.
	 *
	 * It had to move for two reasons. It required the thread to OVERFLOW, which
	 * was a fair proxy while the box was a fixed 24rem and is now false by
	 * design — the Messages tab fills the screen, so six messages fit and nothing
	 * scrolls. And it built that overflow by sending into the SEEDED thread,
	 * which `dev-fixtures.spec.ts` asserts the exact contents of and the fixture
	 * never clears: the messages outlived the run and broke four of its tests the
	 * next morning. Its replacement builds its own job to talk into.
	 */
});
