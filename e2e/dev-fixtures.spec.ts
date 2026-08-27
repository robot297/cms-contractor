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
/**
 * Point the chat at one of a customer's jobs.
 *
 * Two shapes to satisfy, and the spec must not care which is up: two or three
 * jobs get a tab each, more than that steps through with arrows. What is
 * invariant — and what this relies on — is that the job being replied to is
 * always NAMED on screen, so a reply is never sent into an unlabelled thread.
 * How many jobs the dev customer has is not this spec's to control: other specs
 * open their own orders for them.
 */
async function pickProject(panel: import('@playwright/test').Locator, name: string) {
	const tab = panel.getByRole('tab', { name });
	if ((await tab.count()) > 0) {
		await tab.click();
		return;
	}
	const title = panel.locator('.proj-title');
	const next = panel.getByRole('button', { name: 'Next project' });
	const read = async () => ((await title.textContent()) ?? '').trim();

	// Walk forward exactly one cycle. Bounded by the wrap rather than by a
	// number, because this customer's job count is not fixed: the stepper's list
	// is every order anybody has opened against them, and the suite adds to it.
	// A plain loop rather than a retried assertion — stepping is local state, so
	// each press is instant and a `toPass` would spend its budget on backoff.
	const start = await read();
	if (start === name) return;
	for (;;) {
		await next.click();
		const now = await read();
		if (now === name) return;
		if (now === start) throw new Error(`"${name}" is not among this customer's jobs`);
	}
}

test.describe('dev workspace fixture', () => {
	test.beforeEach(async ({ page }) => {
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
	});

	/** The card for one seeded project. */
	const card = (page: import('@playwright/test').Page, project: string) =>
		page.locator('.order-card').filter({ hasText: project });

	test('an overdue follow-up takes the danger edge', async ({ page }) => {
		// The "4 days overdue" badge these cards used to carry is gone. The edge is
		// what is left, and it is the better half of the pair anyway: a row of
		// cards differing only by a small pill is a row you have to read, where an
		// edge is something you can scan.
		await expect(card(page, 'Kitchen remodel')).toHaveClass(/is-overdue/);
		await expect(card(page, 'Garage conversion')).toHaveClass(/is-overdue/);
	});

	test('a follow-up due today is marked differently, not merely less late', async ({ page }) => {
		// Three states, three edges. Due today gets the amber "waiting" tone: it had
		// no edge at all, which beside two red cards read as one that had got into
		// the list by mistake rather than as the third state it is.
		//
		// Amber, not danger: being due is the work, being late is the fault, and
		// only one of them is alarming.
		const porch = card(page, 'Front porch railing');
		await expect(porch).toHaveClass(/is-due/);
		await expect(porch).not.toHaveClass(/is-overdue/);
	});

	test('overdue outranks due-today on a card that is both', async ({ page }) => {
		// All three states are single classes on one element, so the edge is decided
		// by rule order in the stylesheet rather than by anything in the markup.
		// Late is the older problem, so it takes the edge.
		const kitchen = card(page, 'Kitchen remodel');
		await expect(kitchen).toHaveClass(/is-overdue/);
		await expect(kitchen).not.toHaveClass(/is-due/);
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
		await expect(kitchen).toHaveClass(/is-overdue/);
		// How many are unanswered lives on the button that opens them, and nowhere
		// else — the card used to carry a pill saying the same thing.
		await expect(kitchen.locator('.btn-count')).toHaveText('2');
		await expect(kitchen).not.toContainText('messages waiting');
	});

	test('an answered conversation is a follow-up, not something owed', async ({ page }) => {
		// The deck job has a thread too — but the contractor replied last, so no
		// count on its button. Owed is who spoke last, not what is unread.
		const deck = card(page, 'Backyard deck rebuild');
		await expect(deck).not.toHaveClass(/is-overdue/);
		await expect(deck.locator('.btn-count')).toHaveCount(0);
	});

	test('the card is the link, and Message is the only button on it', async ({ page }) => {
		const kitchen = card(page, 'Kitchen remodel');

		// One control, not three. The "View order" button that used to sit beside
		// Message is gone — the card itself opens the order, so it was a second
		// control for what pressing anywhere already does — and the "how far away"
		// distance estimate above the list went with its button.
		await expect(kitchen.locator('a.stretch-link')).toHaveCount(1);
		await expect(kitchen.getByRole('link', { name: /View order/ })).toHaveCount(0);
		await expect(kitchen.getByRole('button', { name: /^Message/ })).toBeVisible();
		await expect(page.getByRole('button', { name: 'How far away?' })).toHaveCount(0);

		// Message opens the conversation and does NOT navigate. It sits above the
		// card's stretched link precisely so this press lands on the button and not
		// on the link underneath it.
		const url = page.url();
		await clickUntil(
			kitchen.getByRole('button', { name: /^Message / }),
			page.locator('.contact-pop .chat')
		);
		expect(page.url()).toBe(url);
	});

	test('someone waiting sorts above a note you left yourself', async ({ page }) => {
		// The old ordering between the two sections, kept as a tiebreak rather than
		// as a heading: the kitchen is unanswered AND the most overdue.
		const first = page.locator('.order-card').first();
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
		await page.goto('/contractor/people');
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

		// And a picker, because this customer has more than one job. The thread
		// follows the picked job rather than merging every job into one stream —
		// which is the whole difficulty of chatting from a directory, where the
		// row is a PERSON and a thread belongs to an ORDER.
		await pickProject(panel, 'Kitchen remodel');
		await expect(panel.locator('.chat')).toContainText('when the cabinets land');
		await pickProject(panel, 'Backyard deck rebuild');
		await expect(panel.locator('.chat')).toContainText('side gate');
		await expect(panel.locator('.chat')).not.toContainText('when the cabinets land');
	});
});
