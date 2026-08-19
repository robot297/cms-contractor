import { test, expect, clickUntil, signIn, DEV_CONTRACTOR } from './fixtures/app';

/**
 * The seeded dev workspace, and the dashboard states it exists to put on screen.
 *
 * This is a test of the FIXTURE as much as of the UI: its whole job is to make
 * every state visible at once for a local look, and a fixture that quietly
 * drifts out of that shape is worse than none — you would be checking the
 * styling of a case that no longer occurs.
 *
 * Asserts per named order rather than on totals, because other specs create
 * their own orders for this same contractor.
 */
test.describe('dev workspace fixture', () => {
	test.beforeEach(async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
	});

	/** The card for one seeded project. */
	const card = (page: import('@playwright/test').Page, project: string) =>
		page.locator('.due-card').filter({ hasText: project });

	test('an overdue follow-up counts the days and takes the danger edge', async ({ page }) => {
		const kitchen = card(page, 'Kitchen remodel');
		await expect(kitchen.locator('.due-flag.overdue')).toHaveText('4 days overdue');
		await expect(kitchen).toHaveClass(/is-overdue/);

		// The singular, one day out — a different string, not just a smaller number.
		const garage = card(page, 'Garage conversion');
		await expect(garage.locator('.due-flag.overdue')).toHaveText('1 day overdue');
		await expect(garage).toHaveClass(/is-overdue/);
	});

	test('a follow-up due today is marked differently, not merely less late', async ({ page }) => {
		const porch = card(page, 'Front porch railing');
		await expect(porch.locator('.due-flag')).toHaveText('Due today');
		// The distinction that matters: today is the brand accent, overdue is
		// danger. Same badge, different signal — and no danger edge on the card.
		await expect(porch).not.toHaveClass(/is-overdue/);
	});

	test('a follow-up still ahead is "due soon", not "due today"', async ({ page }) => {
		// Seeded four days out. It must not be a card in the today list — mixing in
		// things that are not due is how a to-do list stops being believed — but it
		// should still be visible ahead of time, one disclosure away.
		await expect(card(page, 'Pole barn')).toHaveCount(0);

		await page.getByRole('group').filter({ hasText: 'Due soon' }).locator('summary').click();
		const row = page.locator('.soon-row').filter({ hasText: 'Pole barn' });
		await expect(row).toBeVisible();
		await expect(row).toContainText('Due in');
	});

	test('the panel opens on the conversation, with the other channels as tabs', async ({ page }) => {
		const kitchen = card(page, 'Kitchen remodel');
		await clickUntil(
			kitchen.getByRole('button', { name: /^Message / }),
			page.locator('.contact-pop .chat')
		);
		const pop = page.locator('.contact-pop');

		// Opens on Chat, with the reply box right there.
		await expect(pop.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByPlaceholder('Reply')).toBeVisible();

		// One row, one question. Switching swaps the pane rather than growing the
		// panel downward, and the composer does NOT then ask which channel again.
		await pop.getByRole('tab', { name: 'Email' }).click();
		await expect(pop.locator('.pop-thread')).toHaveCount(0);
		await expect(pop.locator('input[name="subject"]')).toBeVisible();
		await expect(pop.locator('.methods')).toHaveCount(0);

		// Call is a hand-off, not something to compose.
		await pop.getByRole('tab', { name: 'Call' }).click();
		await expect(pop.getByRole('link', { name: /Call now/ })).toBeVisible();
	});

	test('a job that is both late and unanswered says both, on one card', async ({ page }) => {
		// The case that gave the old two-section dashboard away: this order used to
		// appear twice, once per list, in two different visual languages.
		const kitchen = card(page, 'Kitchen remodel');
		await expect(kitchen).toHaveCount(1);
		await expect(kitchen.locator('.due-flag.overdue')).toHaveText('4 days overdue');
		// How many are unanswered lives on the button that opens them, and nowhere
		// else — the card used to carry a pill saying the same thing.
		await expect(kitchen.locator('.btn-count')).toHaveText('2');
		await expect(kitchen).not.toContainText('messages waiting');
	});

	test('an answered conversation is a follow-up, not something owed', async ({ page }) => {
		// The deck job has a thread too — but the contractor replied last, so no
		// count on its button. Owed is who spoke last, not what is unread.
		const deck = card(page, 'Backyard deck rebuild');
		await expect(deck.locator('.due-flag')).toHaveText('Due today');
		await expect(deck.locator('.btn-count')).toHaveCount(0);
	});

	test('someone waiting sorts above a note you left yourself', async ({ page }) => {
		// The old ordering between the two sections, kept as a tiebreak rather than
		// as a heading: the kitchen is unanswered AND the most overdue.
		const first = page.locator('.due-card').first();
		await expect(first).toContainText('Kitchen remodel');
	});

	test('the conversation is woven into the card it belongs to', async ({ page }) => {
		const kitchen = card(page, 'Kitchen remodel');
		await clickUntil(
			kitchen.getByRole('button', { name: /^Message / }),
			page.locator('.contact-pop .chat')
		);
		// What the customer actually asked, without a trip to the order page —
		// which is the point of putting the thread behind this button at all.
		await expect(page.locator('.contact-pop .chat')).toContainText('when the cabinets land');
		// And somewhere to answer it.
		await expect(page.locator('.contact-pop textarea').first()).toBeVisible();

		// Opened on the NEWEST message, not the oldest. The thread scrolls itself;
		// wrapping it in a second scroll container silently broke that, and the
		// popover opened at the top of the conversation every time.
		// Asserted on VISIBILITY, not on any element's scrollTop. The thread scrolls
		// itself to the bottom regardless; what broke was a second scroll container
		// wrapped around it, which left that inner scroll working perfectly inside a
		// box the contractor could only see the top of. Only "is the newest message
		// actually on screen" catches that — `toBeInViewport` fails on content
		// clipped by an ancestor, which is exactly the failure.
		const newest = page.locator('.contact-pop .chat .body').last();
		await expect(newest).toContainText('is the old sink something');
		await expect(newest).toBeInViewport();
	});

	test('the directory offers all four channels, and asks which job', async ({ page }) => {
		// The seeded customer is linked and has TWO jobs, which is the case that
		// makes chat-from-the-directory non-trivial: a thread belongs to an order,
		// so replying without saying which one would answer on the wrong job.
		await page.goto('/contractor/customers');
		const row = page.getByText('Dev Customer').first();
		await clickUntil(row, page.getByRole('button', { name: /Contact|Message/ }).first());
		await clickUntil(
			page.getByRole('button', { name: /Contact|Message/ }).first(),
			page.getByRole('tablist', { name: 'How to reach them' })
		);

		const panel = page.locator('.contact-pop');
		// All four, not the three the directory used to manage.
		for (const name of ['Chat', 'Email', 'Text', 'Call']) {
			await expect(panel.getByRole('tab', { name })).toBeVisible();
		}

		// And a picker, because this customer has more than one job. Asserted as
		// "both seeded jobs are offered" rather than as a count — other specs create
		// their own orders for this same customer, so the total is not ours to know.
		const picker = panel.getByLabel('Which job to talk about');
		await expect(picker).toBeVisible();
		await expect(picker.locator('option', { hasText: 'Kitchen remodel' })).toHaveCount(1);
		await expect(picker.locator('option', { hasText: 'Backyard deck rebuild' })).toHaveCount(1);

		// The thread follows the picked job rather than merging both.
		await picker.selectOption({ label: 'Kitchen remodel' });
		await expect(panel.locator('.chat')).toContainText('when the cabinets land');
		await picker.selectOption({ label: 'Backyard deck rebuild' });
		await expect(panel.locator('.chat')).toContainText('side gate');
		await expect(panel.locator('.chat')).not.toContainText('when the cabinets land');
	});
});
