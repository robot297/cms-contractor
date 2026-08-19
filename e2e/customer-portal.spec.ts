import {
	test,
	expect,
	createOrder,
	newOrderFields,
	clickUntil,
	signIn,
	uid,
	DEV_CONTRACTOR,
	DEV_CUSTOMER
} from './fixtures/app';
import { addInternalNote, openTab, setStatus, timelineEntry } from './fixtures/order';
import { customerPage, openPortalHistory, openPortalOrder } from './fixtures/portal';
import type { Page } from '@playwright/test';

/**
 * The customer's half of the product: what they see of a job, and how it changes
 * as the contractor moves it along.
 *
 * These are the one set of specs that can't sign up their own accounts. A
 * customer portal login is a User bound to a customer record, and that binding
 * is only ever made by accepting an emailed invite — which this server has no
 * way to send. So they use the seeded pair (SEED_DEV_LOGIN), and stay
 * parallel-safe by giving every test its OWN order for that customer rather than
 * sharing the seeded one.
 */

/** Sign the seeded contractor in and give the seeded customer a fresh job. */
async function contractorWithOrderForDevCustomer(page: Page) {
	await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
	await page.waitForURL('**/contractor');
	const order = newOrderFields(DEV_CUSTOMER.name);
	const orderUrl = await createOrder(page, order);
	return { order, orderUrl };
}

test.describe('customer portal', () => {
	test('a customer signs in and sees the job their contractor created', async ({
		page,
		browser
	}) => {
		const { order } = await contractorWithOrderForDevCustomer(page);

		const customer = await customerPage(browser);
		await openPortalOrder(customer, order.projectName);
		// The portal leads with where the job stands, in the customer's words.
		await expect(customer.getByText('Status')).toBeVisible();
		await customer.close();
	});

	test('a status change reaches the customer in their own language', async ({ page, browser }) => {
		const { order, orderUrl } = await contractorWithOrderForDevCustomer(page);

		const customer = await customerPage(browser);
		await openPortalOrder(customer, order.projectName);

		// The contractor's states are internal vocabulary; the portal translates.
		// "Work Scheduled" is what the contractor picks — never what the customer reads.
		await page.goto(orderUrl);
		await setStatus(page, 'Work Scheduled');

		await customer.reload();
		await expect(customer.locator('.hero-state')).not.toBeEmpty();
		await expect(customer.locator('.hero-state')).not.toContainText('Work Scheduled');
		await customer.close();
	});

	test('internal notes never reach the portal, but customer-visible updates do', async ({
		page,
		browser
	}) => {
		const { order, orderUrl } = await contractorWithOrderForDevCustomer(page);
		const secret = `Margin check ${uid()}`;
		const shared = `Materials delivered ${uid()}`;

		await page.goto(orderUrl);
		await addInternalNote(page, secret);
		await setStatus(page, 'In Progress', shared);

		// Both are on the contractor's history — one of them flagged internal.
		await openTab(page, 'History');
		await expect(timelineEntry(page, secret)).toHaveClass(/internal/);

		const customer = await customerPage(browser);
		await openPortalOrder(customer, order.projectName);
		await openPortalHistory(customer);

		// The status change is theirs to see. The internal notes are not — neither
		// the one added directly nor the "why" recorded alongside the status.
		await expect(customer.getByText('Status changed').first()).toBeVisible();
		await expect(customer.getByText(secret)).toHaveCount(0);
		await expect(customer.getByText(shared)).toHaveCount(0);
		await customer.close();
	});

	test('the history grows for the customer as the contractor works', async ({ page, browser }) => {
		const { order, orderUrl } = await contractorWithOrderForDevCustomer(page);

		// Two moves first, so there is a history to expand at all: the portal leads
		// with the newest update and files the rest under "History", so a job with a
		// single entry has no drill to open.
		await page.goto(orderUrl);
		await setStatus(page, 'Quote Sent');
		await setStatus(page, 'Work Scheduled');

		const customer = await customerPage(browser);
		await openPortalOrder(customer, order.projectName);
		await openPortalHistory(customer);

		// Asserted on CONTENT, not on a count. Counting meant snapshotting the list
		// the instant it became visible, which is the instant its first row paints —
		// so a slow second row read as a missing one.
		await expect(customer.locator('.hero-state')).toHaveText('Scheduled');
		await expect(customer.locator('ol.timeline')).toContainText('Quote Sent');

		await page.goto(orderUrl);
		await setStatus(page, 'In Progress');
		await setStatus(page, 'Final Payment Pending');

		await customer.reload();
		await openPortalHistory(customer);

		// Every action the contractor took is now a line in the customer's history,
		// in their own words, and the headline has moved on to the latest.
		await expect(customer.locator('.hero-state')).toHaveText('Final payment due');
		const history = customer.locator('ol.timeline');
		await expect(history).toContainText('Quote Sent');
		await expect(history).toContainText('Work Scheduled');
		await expect(history).toContainText('In Progress');
		await customer.close();
	});

	test('a closed-out job reads as complete to the customer', async ({ page, browser }) => {
		const { order, orderUrl } = await contractorWithOrderForDevCustomer(page);

		await page.goto(orderUrl);
		await setStatus(page, 'In Progress');
		await setStatus(page, 'Work Complete');

		const customer = await customerPage(browser);
		// A closed job leaves the live list and files itself under "Past work" —
		// still the customer's to read, just no longer something in flight.
		await clickUntil(
			customer.getByRole('button', { name: /Past work/ }),
			customer.getByRole('link', { name: order.projectName }).first()
		);
		await openPortalOrder(customer, order.projectName);

		// "Work Complete" is the contractor's word for it; the customer is told the
		// job is done, and is no longer being asked to do anything about it.
		const state = customer.locator('.hero-state');
		await expect(state).toHaveText('Completed');
		await expect(state).not.toHaveClass(/act/);
		await expect(customer.getByRole('heading', { name: order.projectName })).toBeVisible();
		await customer.close();
	});

	test('a customer cannot reach the contractor side', async ({ browser }) => {
		const customer = await customerPage(browser);
		await customer.goto('/contractor/orders');
		await expect(customer).not.toHaveURL(/\/contractor/);
		await customer.close();
	});
});
