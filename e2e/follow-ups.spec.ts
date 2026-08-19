import {
	test,
	expect,
	createOrder,
	newOrderFields,
	seedWorkspace,
	signIn,
	DEV_CONTRACTOR,
	DEV_CUSTOMER
} from './fixtures/app';
import { openFollowUp } from './fixtures/order';
import { customerPage, openPortalOrder } from './fixtures/portal';

/**
 * The dashboard's job: telling a contractor what needs them today. Two feeds
 * into it — follow-ups they set themselves, and customers waiting on a reply.
 */

/**
 * A `yyyy-mm-dd` some days from now, in LOCAL time; negative for the past.
 *
 * Built from the local parts rather than `toISOString().slice(0, 10)` — which is
 * the same UTC bug this suite exists to guard against in the app. It only bites
 * in the evening: after ~17:00 in the Americas the UTC date has already rolled
 * over, so `-2` produced yesterday's date and the badge read "1 day overdue".
 */
function isoDay(offsetDays: number): string {
	const d = new Date();
	d.setDate(d.getDate() + offsetDays);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The dashboard's today card for one project, if it has one. */
function dueCard(page: import('@playwright/test').Page, projectName: string) {
	return page.locator('.due-card').filter({ hasText: projectName });
}

/** Set this order's follow-up to a given day through the ⏰ popover. */
async function setFollowUpDate(page: import('@playwright/test').Page, day: string): Promise<void> {
	const pop = await openFollowUp(page);
	await pop.locator('input[name="date"]').fill(day);
	await pop.locator('form[action="?/setFollowUp"]').getByRole('button').click();
	await expect(pop).toBeHidden();
}

test.describe('follow-ups', () => {
	test('a follow-up in the past puts the order on the dashboard', async ({ page }) => {
		const { order, orderUrl } = await seedWorkspace(page);

		// A new order is given a follow-up a week out, so it is not due today. It
		// may well show under "Due soon" — that list exists precisely for this — so
		// the assertion is about the today list, not about the whole page.
		await page.goto('/contractor');
		await expect(dueCard(page, order.projectName)).toHaveCount(0);

		await page.goto(orderUrl);
		await setFollowUpDate(page, isoDay(-1));

		// Yesterday's follow-up is today's work.
		await page.goto('/contractor');
		await expect(page.getByText(order.projectName).first()).toBeVisible();
		await expect(page.getByText(/all caught up/)).toHaveCount(0);
	});

	test('snoozing a due follow-up clears it off the dashboard', async ({ page }) => {
		const { order, orderUrl } = await seedWorkspace(page);

		await page.goto(orderUrl);
		await setFollowUpDate(page, isoDay(-1));
		await page.goto('/contractor');
		await expect(dueCard(page, order.projectName)).toBeVisible();

		// Snoozed a week — still a follow-up, just not today's.
		await page.goto(orderUrl);
		const pop = await openFollowUp(page);
		await pop
			.getByRole('button', { name: /1 week|1w|Next week/i })
			.first()
			.click();
		await expect(pop).toBeHidden();

		await page.goto('/contractor');
		await expect(dueCard(page, order.projectName)).toHaveCount(0);
	});

	test('clearing a follow-up removes it without touching the order', async ({ page }) => {
		const { order, orderUrl } = await seedWorkspace(page);

		await page.goto(orderUrl);
		await setFollowUpDate(page, isoDay(-1));
		await page.goto('/contractor');
		await expect(dueCard(page, order.projectName)).toBeVisible();

		await page.goto(orderUrl);
		const pop = await openFollowUp(page);
		await pop.locator('form[action="?/clearFollowUp"]').getByRole('button').click();
		await expect(pop).toBeHidden();

		await page.goto('/contractor');
		// Cleared entirely, so it is neither due today nor coming up.
		await expect(dueCard(page, order.projectName)).toHaveCount(0);
		await expect(page.locator('.soon-row').filter({ hasText: order.projectName })).toHaveCount(0);

		// The order is untouched — a follow-up is a reminder, not part of the job.
		await page.goto(orderUrl);
		await expect(page.getByRole('heading', { name: order.projectName })).toBeVisible();
	});

	test('a due follow-up can be acted on straight from the dashboard', async ({ page }) => {
		const { order, orderUrl, customer } = await seedWorkspace(page);

		await page.goto(orderUrl);
		await setFollowUpDate(page, isoDay(-2));
		await page.goto('/contractor');

		// The card carries who it's about and a way into the job, so the dashboard
		// is somewhere to work from rather than only a list.
		const card = page.locator('.due-card').filter({ hasText: order.projectName });
		await expect(card).toBeVisible();
		await expect(card).toContainText(customer.name);
		// The badge names the situation rather than saying only "due". Two days back
		// is two days back — this also guards the picker's local-calendar parsing,
		// which used to store the previous evening for anyone west of UTC and made
		// this read "3 days overdue".
		await expect(card.locator('.due-flag')).toHaveText('2 days overdue');
		await expect(card).toHaveClass(/is-overdue/);
		await card.getByRole('link', { name: 'View order details' }).click();
		await page.waitForURL(/\/contractor\/orders\/[0-9a-f-]+$/);
		await expect(page.getByRole('heading', { name: order.projectName })).toBeVisible();
	});
});

test.describe('dashboard notifications', () => {
	test('a customer waiting on a reply shows up for the contractor', async ({ page, browser }) => {
		// Needs a real portal customer, so this uses the seeded pair — with its own
		// fresh order, so it can't collide with another test's.
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		const order = newOrderFields(DEV_CUSTOMER.name);
		const orderUrl = await createOrder(page, order);
		const orderId = orderUrl.split('/').pop()!;

		const customer = await customerPage(browser);
		// Waits until this job is really open. Without it the message below lands on
		// whichever order the portal happened to open on — which, now that the
		// seeded customer has several, is a real thread rather than a blank page.
		await openPortalOrder(customer, order.projectName);

		const question = `When do you start? ${order.projectName}`;
		await customer.locator('textarea').first().fill(question);

		// Waiting for Send to enable is a hydration probe, not politeness. It is
		// bound to whether the body is empty, so it only enables once Svelte's state
		// has actually seen the typing — before that, `fill` has set a DOM value the
		// component knows nothing about, and clicking would post an empty message or
		// nothing at all.
		const send = customer.getByRole('button', { name: /^Send/ });
		await expect(send).toBeEnabled();

		const posted = customer.waitForResponse(
			(r) => r.request().method() === 'POST' && r.url().includes('?/send')
		);
		await send.click();
		expect((await posted).status()).toBe(200);

		// The contractor's dashboard leads with people waiting — above follow-ups,
		// because a customer who has already reached out outranks a reminder.
		// Found by where the row GOES, since the row itself deliberately no longer
		// names the job.
		await page.goto('/contractor');
		// One feed now — the card is found by the job it points at, and it says WHY
		// it is here rather than living under a separate heading.
		const row = page.locator('.due-card').filter({ has: page.locator(`a[href$="/${orderId}"]`) });
		await expect(row).toBeVisible();
		await expect(row).toContainText(DEV_CUSTOMER.name);
		// How many are unanswered lives on the button that opens them — the card no
		// longer repeats it as a pill.
		await expect(row.locator('.btn-count')).toHaveText('1');

		// What the message SAYS is never on the dashboard, on purpose — the row is a
		// person to get back to, not a second inbox to read.
		await expect(row).not.toContainText('When do you start?');

		// The card names its job — with everything in one list, that is what tells
		// two cards for the same customer apart.
		await expect(row).toContainText(order.projectName);

		// And it goes where it says it goes.
		await row.getByRole('link', { name: 'View order details' }).click();
		await expect(page).toHaveURL(new RegExp(`/contractor/orders/${orderId}$`));

		await customer.close();
	});
});
