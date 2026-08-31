import {
	test,
	expect,
	createOrder,
	newOrderFields,
	signIn,
	signUpContractor,
	uid,
	DEV_CONTRACTOR,
	DEV_CUSTOMER
} from './fixtures/app';
import {
	completeOrder,
	fetchInvoiceEmail,
	invoiceBalance,
	invoiceCard,
	openTab,
	recordPayment,
	setProjectTotal,
	setStatus,
	timelineEntry
} from './fixtures/order';
import { customerPage, openPortalHistory, openPortalOrder } from './fixtures/portal';
import type { Page } from '@playwright/test';

/**
 * One job, end to end: a customer imported from a phone's address book, an order
 * opened for them, statuses walked, money taken in two parts, and an invoice
 * emailed at close-out.
 *
 * Split into two tests along the product's own seam rather than for convenience.
 * A Customer only has a Portal once they have accepted an Invite and a User has
 * bound to the record (ADR-0001), and this server cannot send the mail that
 * carries that invite. So:
 *
 *   - the FIRST test signs up its own contractor and imports its own customer,
 *     which is the honest way to cover import and the whole money arc, and ends
 *     at the invoice document. That customer is unlinked, so there is no portal
 *     to check — which is the product's real rule, not a gap in the test;
 *   - the SECOND uses the seeded contractor/customer pair, who ARE linked, to
 *     cover the half that needs two real logins: messages in both directions,
 *     and the same payments and history showing up on the customer's own portal.
 *
 * Together they are the arc. Neither is a substitute for the other.
 */

/** A .vcf export of one contact, as iOS and macOS Contacts produce it. */
function vcard(fields: { name: string; email: string }): Buffer {
	return Buffer.from(
		[
			'BEGIN:VCARD',
			'VERSION:3.0',
			`FN:${fields.name}`,
			`EMAIL;TYPE=INTERNET:${fields.email}`,
			'TEL;TYPE=CELL:(512) 555-0188',
			'ADR;TYPE=HOME:;;120 Pecan Street;Austin;TX;78701;USA',
			'END:VCARD',
			''
		].join('\r\n'),
		'utf8'
	);
}

/**
 * Import one contact from a vCard and confirm it landed in the directory.
 *
 * Drives the real path: the hidden file input the "Import a .vcf file" button
 * clicks, the review list, and the import submit — nothing is stubbed, and the
 * parse is the same one a contractor's actual export goes through.
 */
async function importCustomer(page: Page, fields: { name: string; email: string }) {
	await page.goto('/contractor/people');

	// Import lives INSIDE the add-customer dialog, not in the directory header:
	// typing one customer in and importing a batch are the same errand, so the app
	// offers both in the same place. That dialog opens by itself on an empty
	// directory — which a freshly signed-up contractor always has — so this has to
	// tolerate finding it already up.
	const addDialog = page.getByRole('dialog').filter({ hasText: 'Add someone' });
	await expect(async () => {
		if (await addDialog.isVisible()) return;
		await page.locator('button.icon-btn[aria-label="Add customer"]').click({ timeout: 2_000 });
		await expect(addDialog).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });

	const dialog = page.getByRole('dialog').filter({ hasText: 'Import contacts' });
	await expect(async () => {
		if (await dialog.isVisible()) return;
		await addDialog
			.getByRole('button', { name: 'Import from my contacts' })
			.click({ timeout: 2_000 });
		await expect(dialog).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });

	// The styled button is what a person clicks; the input behind it is what
	// actually takes the file, so that is what the test hands the vCard to.
	await dialog
		.locator('input[type="file"]')
		.setInputFiles({ name: 'contacts.vcf', mimeType: 'text/vcard', buffer: vcard(fields) });

	// Review stage. A contact WITH an email arrives already ticked, so there is
	// nothing to select — going straight to the submit is what a contractor does.
	await expect(dialog.getByText('1 contact found')).toBeVisible();
	await dialog.getByRole('button', { name: /^Import 1$/ }).click();
	await expect(dialog).toBeHidden();

	await page.goto('/contractor/people');
	await expect(page.getByText(fields.name).first()).toBeVisible();
	return fields;
}

test.describe('a job from import to paid invoice', () => {
	test('the contractor imports a customer, works the job, and closes it out paid', async ({
		page
	}) => {
		await signUpContractor(page);

		// ---------------------------------------------------------------- import
		const tag = uid();
		const customer = await importCustomer(page, {
			name: `Rowan Ellis ${tag}`,
			email: `e2e-import-${tag}@example.test`
		});

		// ----------------------------------------------------------------- order
		const order = newOrderFields(customer.name, { projectName: `E2E Back Deck ${tag}` });
		const orderUrl = await createOrder(page, order);

		// ------------------------------------------------------------- the money
		// Nothing is owed until a total exists — an empty card must not read as a
		// job that costs nothing.
		await expect(invoiceCard(page).getByText('Not set')).toBeVisible();
		expect(await invoiceBalance(page)).toContain('Nothing recorded yet');

		await setProjectTotal(page, '4800');
		expect(await invoiceBalance(page)).toContain('$4,800.00');

		// The deposit: half up front, which is the move the card prefills for.
		await setStatus(page, 'Quote Sent');
		await setStatus(page, 'Deposit Pending');
		await recordPayment(page, {
			amount: '2400',
			kind: 'Deposit',
			method: 'Check',
			note: 'check #1041'
		});

		// The subtraction is the whole feature: half in, half still owed.
		const afterDeposit = await invoiceBalance(page);
		expect(afterDeposit).toContain('Balance due');
		expect(afterDeposit).toContain('$2,400.00');
		await expect(invoiceCard(page).getByText('Deposit · Check · check #1041')).toBeVisible();

		// The customer's history is told about it, in figures.
		await openTab(page, 'History');
		await expect(timelineEntry(page, 'Deposit received')).toContainText('$2,400.00');
		await expect(timelineEntry(page, 'Project total set')).toContainText('$4,800.00');

		// ---------------------------------------------------------- doing the work
		await setStatus(page, 'Work Scheduled');
		await setStatus(page, 'In Progress');
		await openTab(page, 'History');
		await expect(timelineEntry(page, /In Progress/)).toBeVisible();

		// -------------------------------------------------- the invoice, mid-job
		// Inspectable before anything is sent, which is the point of the route.
		const midJob = await fetchInvoiceEmail(page, orderUrl, 'text');
		expect(midJob).toContain('Subject: Invoice for');
		expect(midJob).toContain('Total: $4,800.00');
		expect(midJob).toContain('Balance due: $2,400.00');

		// ------------------------------------------------------------- close-out
		// `markPaid` records what is OUTSTANDING, not the total — so a job with a
		// deposit must not end up counted twice.
		await completeOrder(page, {
			total: '4800',
			notes: 'Cedar, 16x20, railing included.',
			markPaid: true,
			sendInvoice: true
		});

		const settled = await invoiceBalance(page);
		expect(settled).toContain('Paid in full');
		expect(settled).toContain('$4,800.00');
		// Two payments, summing to the total — not one payment of the whole thing.
		await expect(invoiceCard(page).locator('li.inv-line')).toHaveCount(2);

		// ------------------------------------------------------ the sent document
		const html = await fetchInvoiceEmail(page, orderUrl);
		// Once square it is a receipt, and says so.
		expect(html).toContain('Receipt for');
		expect(html).toContain('Paid in full');
		expect(html).toContain('$4,800.00'); // the total
		expect(html).toContain('$2,400.00'); // each half
		expect(html).toContain('check #1041');
		expect(html).toContain('Cedar, 16x20, railing included.');

		const text = await fetchInvoiceEmail(page, orderUrl, 'text');
		// The two parts of one email must not disagree about the money.
		expect(text).toContain('Total: $4,800.00');
		expect(text).toContain('paid in full');

		// The send is recorded on the history both sides read. EMAIL_DEV_TOOLS is on
		// for this server, so nothing left the building — the record is what makes
		// the flow observable, exactly as it is for the composer's simulated send.
		await openTab(page, 'History');
		await expect(timelineEntry(page, /Emailed/)).toContainText('Receipt for');
	});

	test('the customer sees the same job, the same history and the same balance', async ({
		page,
		browser
	}) => {
		// The seeded pair: the only accounts on this server where a Customer really
		// has a login bound to their record.
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		const order = newOrderFields(DEV_CUSTOMER.name, { projectName: `E2E Portal Job ${uid()}` });
		const orderUrl = await createOrder(page, order);

		// ------------------------------------------------- the contractor's side
		await setProjectTotal(page, '3200');
		await setStatus(page, 'Deposit Pending');
		await recordPayment(page, { amount: '1600', kind: 'Deposit', method: 'Card' });
		// An internal note, which must NEVER cross to the portal. Seeded here rather
		// than assumed: the filter lives in the query, and this is what proves it.
		await setStatus(page, 'Work Scheduled', 'Internal: check the gate width before the 14th.');

		// ------------------------------------------------------ the customer's side
		const customer = await customerPage(browser);
		await openPortalOrder(customer, order.projectName);

		// The state, in the customer's words rather than the contractor's. Addressed
		// at the hero rather than by text: "Scheduled" is also a step label on the
		// progress rail and a state chip in the order list, and the loose lookup
		// found one of those instead — off screen at this width, and hidden.
		await expect(customer.locator('.hero-state')).toHaveText('Scheduled');

		// The invoice: same three figures, computed once on the server.
		const portalInvoice = customer.locator('section.card.invoice');
		await expect(portalInvoice).toBeVisible();
		await expect(portalInvoice).toContainText('$3,200.00'); // total
		await expect(portalInvoice).toContainText('$1,600.00'); // deposit, and the balance
		await expect(portalInvoice.locator('.inv-balance')).toContainText('Balance due');
		// ADR-0010: this records money, it never moves any. Nothing here may look
		// like a way to pay.
		await expect(portalInvoice.getByRole('button', { name: /pay/i })).toHaveCount(0);

		// The history matches — and stops exactly where it should.
		await openPortalHistory(customer);
		await expect(customer.getByText('Deposit received')).toBeVisible();
		await expect(customer.getByText('$1,600.00').first()).toBeVisible();
		await expect(customer.getByText('check the gate width')).toHaveCount(0);

		// ------------------------------------------------------- back and forth
		// Both composers are addressed by their form action, not by "the first
		// textarea on the page": each of these screens has several — a close-out
		// notes field, a document caption — and whichever one comes first in the DOM
		// is presentation, not a contract.
		const question = `Is the deposit through? ${uid()}`;
		const portalComposer = customer.locator('form[action="?/send"]');
		await portalComposer.locator('textarea').fill(question);
		await portalComposer.getByRole('button', { name: 'Send message' }).click();
		await expect(customer.getByText(question)).toBeVisible();

		// It arrives on the contractor's side of the same thread.
		await page.goto(orderUrl);
		await openTab(page, 'Messages');
		await expect(page.getByText(question)).toBeVisible();

		const answer = `Yes — received and applied. ${uid()}`;
		const replyComposer = page.locator('form[action="?/replyToCustomer"]');
		await replyComposer.locator('textarea').fill(answer);
		await replyComposer.getByRole('button', { name: 'Send message' }).click();
		// Re-opened deliberately. Which panel this workspace shows is a question
		// about the ORDER — it opens on the conversation only while the customer is
		// owed an answer — and replying is precisely what stops them being owed one,
		// so the page drops back to History under the test's feet. That is the
		// behaviour, not a race: the assertion goes where the thread now is.
		await openTab(page, 'Messages');
		await expect(page.getByText(answer)).toBeVisible();

		// And back again, in the customer's own thread.
		await customer.reload();
		await expect(customer.getByText(answer)).toBeVisible();

		// ------------------------------------------- paying the rest, and closing
		await page.goto(orderUrl);
		await completeOrder(page, { total: '3200', markPaid: true });
		expect(await invoiceBalance(page)).toContain('Paid in full');

		// The customer is shown the same conclusion, not merely a balance of zero.
		await customer.reload();
		await expect(portalInvoice.locator('.inv-balance')).toContainText('Paid in full');
		await expect(portalInvoice.locator('.inv-badge.paid')).toBeVisible();
		await expect(customer.locator('.hero-state')).toHaveText('Completed');

		await customer.close();
	});
});
