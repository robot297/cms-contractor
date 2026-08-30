import {
	expect,
	createOrder,
	newOrderFields,
	signIn,
	test,
	uid,
	DEV_CONTRACTOR,
	DEV_CUSTOMER
} from './fixtures/app';
import { openTab } from './fixtures/order';
import { customerPage } from './fixtures/portal';

/**
 * Opening Messages on a phone puts the newest message AND the box you answer in
 * on screen, on both sides of the conversation.
 *
 * Both surfaces used to hand the thread a fixed-height box and let the composer
 * fall wherever it fell: the contractor tapped Messages and the pane opened
 * below the fold, the customer's portal put the reply field under a 24rem
 * thread. Scrolling the thread to its newest message — which it now does — only
 * helps if the thread is somewhere you can see.
 *
 * Asserted as "in the viewport", not as a pixel geometry: what matters is that
 * neither the last message nor the composer needs the page scrolled to reach.
 *
 * Each test builds its OWN job for the seeded (portal-linked) customer and talks
 * only into that thread. The seeded "Kitchen remodel" conversation is shared
 * state whose exact contents `dev-fixtures.spec.ts` asserts on, and the fixture
 * seeds an empty order but never deletes — so messages pushed into it survive
 * the run, and a test that borrows it breaks another one tomorrow.
 */
test.use({ viewport: { width: 390, height: 840 } });

/**
 * A job for the seeded customer with a thread long enough to overflow — a
 * conversation that fits proves nothing about opening on the end of it.
 *
 * Sent by the CONTRACTOR, so the job is not left owing anybody a reply: an
 * unanswered job sorts to the top of the dashboard, which is somebody else's
 * assertion.
 */
async function seedConversation(page: import('@playwright/test').Page, lines: number) {
	await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
	await page.waitForURL('**/contractor');
	const projectName = `E2E Chat Screen ${uid()}`;
	const orderUrl = await createOrder(page, newOrderFields(DEV_CUSTOMER.name, { projectName }));

	const composer = page.locator('form[action="?/replyToCustomer"]');
	let newest = '';
	for (let i = 1; i <= lines; i++) {
		// Answering is what stops the customer being owed a reply, so the workspace
		// re-opens on History and the pane has to be asked for again each time.
		await openTab(page, 'Messages');
		newest = `Screen check ${i} — ${uid()}`;
		await composer.locator('textarea').fill(newest);
		await composer.getByRole('button', { name: 'Send message' }).click();
		await openTab(page, 'Messages');
		await expect(page.getByText(newest)).toBeVisible();
	}
	return { projectName, orderUrl, newest };
}

test.describe('messages on a phone', () => {
	test('the contractor tab opens on the conversation, composer and all', async ({ page }) => {
		const { orderUrl, newest } = await seedConversation(page, 6);

		// Land on History — the ordinary way back into an answered job — so the pane
		// mounts hidden, which is the state the thread has to recover from.
		await page.goto(orderUrl);
		const thread = page.locator('#panel-messages .thread');
		await expect(thread).toBeHidden();

		await openTab(page, 'Messages');

		// The whole point: the last thing said and the box to answer it in are both
		// on screen, with no page scrolling and no thread scrolling to reach them.
		await expect(page.getByText(newest)).toBeInViewport();
		await expect(page.locator('form[action="?/replyToCustomer"]')).toBeInViewport();
		await expect
			.poll(async () => thread.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
			.toBeLessThanOrEqual(2);
	});

	test('the portal tab opens on the conversation, composer and all', async ({ page, browser }) => {
		const { orderUrl, newest } = await seedConversation(page, 6);

		const customer = await customerPage(browser);
		// Straight to the job, by id. The portal's project rail is behind the
		// hamburger at this width, so there is no link on screen to click — and
		// the two sides address the same order by the same id.
		await customer.goto(`/customer/orders/${orderUrl.split('/').pop()}`);
		await customer.waitForSelector('#status');

		// In through the bottom tab bar, the way a customer does it.
		await customer.locator('nav.bottombar').getByRole('link', { name: 'Messages' }).click();

		const thread = customer.locator('#messages .thread');
		await expect(customer.getByText(newest)).toBeInViewport();
		await expect(customer.locator('form[action="?/send"]')).toBeInViewport();
		await expect
			.poll(async () => thread.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
			.toBeLessThanOrEqual(2);

		await customer.close();
	});
});
