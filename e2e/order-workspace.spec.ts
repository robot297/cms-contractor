import {
	test,
	expect,
	openOrder,
	seedWorkspace,
	signIn,
	uid,
	DEV_CONTRACTOR
} from './fixtures/app';
import {
	addInternalNote,
	assignSubcontractor,
	assignedCrew,
	openContactComposer,
	openTab,
	setStatus,
	timeline,
	timelineEntry
} from './fixtures/order';

/**
 * The order workspace: putting people on a job, moving it along, and reaching
 * the customer — plus the history that has to record all of it.
 */
test.describe('order workspace', () => {
	test('a subcontractor can be put on the order', async ({ page }) => {
		const { subcontractor } = await seedWorkspace(page);

		await openTab(page, 'People');
		// Nobody on the job yet, but the books are not empty — so the panel offers
		// the picker rather than the "add your people" state.
		await expect(page.getByText('Nobody is on this job yet')).toBeVisible();

		await assignSubcontractor(page, subcontractor.name);

		// It survives a reload, which is what says it actually reached the database.
		await page.reload();
		await openTab(page, 'People');
		await expect(assignedCrew(page).filter({ hasText: subcontractor.name })).toBeVisible();
	});

	test('somebody new can be added to a job without leaving it', async ({ page }) => {
		// A contractor who has never added anyone — the state the People panel has
		// to speak to before the feature is of any use to them.
		await seedWorkspace(page, { withSubcontractor: false });

		await openTab(page, 'People');
		await expect(page.getByText('Nobody is on this job yet')).toBeVisible();
		// No standing link off the page. It used to sit in the panel heading on
		// every job, offered to somebody who had come here to staff one.
		await expect(page.getByRole('link', { name: 'Manage people →' })).toHaveCount(0);

		await page.getByRole('button', { name: 'Put someone on this job' }).click();

		// Nothing on the books, so there is nothing to search — the picker opens on
		// the form, and this is the ONE state where the people page is worth
		// pointing at (subcontractors, and importing a list you already have).
		await expect(page.getByText('Nobody on your books yet')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Manage people →' })).toBeVisible();

		const add = page.locator('form.crew-new');
		await add.getByPlaceholder('Dave Ellis').fill('Dave Ellis');
		await add.getByPlaceholder('Framer, helper, operator…').fill('Framer');
		await add.getByRole('button', { name: 'Add to this job' }).click();

		// One press: the record is created AND they are on the job, dated today.
		await expect(assignedCrew(page).filter({ hasText: 'Dave Ellis' })).toBeVisible();
		await expect(assignedCrew(page).filter({ hasText: 'Framer' })).toBeVisible();

		// And it reached the database, not just the screen.
		await page.reload();
		await openTab(page, 'People');
		await expect(assignedCrew(page).filter({ hasText: 'Dave Ellis' })).toBeVisible();
	});

	test('a search that finds nobody offers to create them', async ({ page }) => {
		await seedWorkspace(page, { withSubcontractor: true });

		await openTab(page, 'People');
		await page.getByRole('button', { name: 'Put someone on this job' }).click();
		await page.getByRole('searchbox', { name: 'Search your people' }).fill('Nobody Here');

		await expect(page.getByText('Nobody matches “Nobody Here”')).toBeVisible();
		// What was typed rides into the form rather than being typed twice.
		await page.getByRole('button', { name: 'Add “Nobody Here” as someone new' }).click();
		await expect(page.locator('form.crew-new').getByPlaceholder('Dave Ellis')).toHaveValue(
			'Nobody Here'
		);
	});

	test('the Messages panel offers the invite when there is no portal to talk through', async ({
		page
	}) => {
		const { customer } = await seedWorkspace(page);

		await openTab(page, 'Messages');

		// One thing, not three: this used to be an empty thread box, a disabled
		// composer AND a sentence explaining the disabled composer.
		await expect(page.getByText(`${customer.name} isn’t on their portal yet`)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Send invite' })).toBeVisible();
		await expect(page.getByPlaceholder(/^Reply to /)).toHaveCount(0);

		// Sending it turns the panel into the standing invite, in place.
		await page.getByRole('button', { name: 'Send invite' }).click();
		await expect(page.getByText(`Invite sent to ${customer.name}`)).toBeVisible();
		await expect(page.getByText(/Invite sent · expires/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Resend invite' })).toBeVisible();
	});

	test('a status change and a note both land on the history', async ({ page }) => {
		await seedWorkspace(page);
		const why = `Permit cleared ${uid()}`;

		await setStatus(page, 'In Progress', why);

		await openTab(page, 'History');
		// Two entries, not one: the state moved, and the reason was recorded beside
		// it as its own internal note.
		await expect(timelineEntry(page, 'Status changed')).toBeVisible();
		await expect(timeline(page)).toContainText('In Progress');
		await expect(timeline(page)).toContainText(why);

		const note = `Checked the joists ${uid()}`;
		await addInternalNote(page, note);
		const entry = timelineEntry(page, note);
		await expect(entry).toBeVisible();
		// An internal note is marked as such — this is the thing the portal must
		// never show.
		await expect(entry).toHaveClass(/internal/);
	});

	test('the history grows one entry per action, newest first', async ({ page }) => {
		await seedWorkspace(page);

		await openTab(page, 'History');
		const before = await timeline(page).locator('li.tl-entry').count();

		await setStatus(page, 'In Progress');
		await openTab(page, 'History');
		await expect(timeline(page).locator('li.tl-entry')).toHaveCount(before + 1);

		// Two interim moves, not a close-out: completing a job settles the invoice
		// too, so it writes more than one entry and would make "one per action"
		// mean something else. What is under test here is the counting.
		await setStatus(page, 'Final Payment Pending');
		await openTab(page, 'History');
		await expect(timeline(page).locator('li.tl-entry')).toHaveCount(before + 2);
		// Newest first: the most recent status is the entry at the top.
		await expect(timeline(page).locator('li.tl-entry').first()).toContainText(
			'Final Payment Pending'
		);
	});

	test('a long history collapses to the latest few, with details foldable', async ({ page }) => {
		await seedWorkspace(page);

		// Five moves, so the list is comfortably past the preview cap.
		for (const state of [
			'Quote Sent',
			'Deposit Pending',
			'Work Scheduled',
			'In Progress',
			// Interim states only — closing the job out is its own flow, and this
			// test is about the SHAPE of a long history, not about finishing.
			'Final Payment Pending'
		]) {
			await setStatus(page, state);
		}

		await openTab(page, 'History');
		const entries = timeline(page).locator('li.tl-entry');
		const preview = await entries.count();

		// Capped, and the newest is what survives the cap — a preview that showed
		// the OLDEST few would be worse than no preview at all.
		expect(preview).toBeLessThanOrEqual(4);
		await expect(entries.first()).toContainText('Final Payment Pending');

		// The rest is one press away.
		const showAll = page.getByRole('button', { name: /^Show all / });
		await showAll.click();
		expect(await entries.count()).toBeGreaterThan(preview);
		await expect(page.getByRole('button', { name: 'Show less' })).toBeVisible();

		// And the detail lines fold. Folded FIRST: the history reads as a scannable
		// spine of what happened and when, and the sentence explaining any one
		// entry is a press away rather than four lines of prose you scroll past.
		await expect(timeline(page).locator('.tl-detail').first()).toBeHidden();
		await page.getByRole('button', { name: 'Show details' }).click();
		await expect(timeline(page).locator('.tl-detail').first()).toBeVisible();
		await page.getByRole('button', { name: 'Hide details' }).click();
		await expect(timeline(page).locator('.tl-detail').first()).toBeHidden();
		await expect(entries.first()).toContainText('Final Payment Pending');
	});

	test('the portal invite says what happened and offers to resend', async ({ page }) => {
		const { customer } = await seedWorkspace(page);

		// The invite lives on the Chat channel, not on a button of its own. Chat is
		// the conversation once they are on the portal and the invitation to it
		// before then — which is the same errand described twice if it is two
		// controls, and the reason a customer with no portal still gets the tab.
		const composer = await openContactComposer(page);
		await composer.getByRole('tab', { name: 'Chat' }).click();

		// Nobody has been invited yet, so that is what it offers.
		await expect(composer.getByText(/isn't on the portal yet/)).toBeVisible();
		await expect(composer.getByText(/Invite sent/)).toHaveCount(0);
		await composer.getByRole('button', { name: 'Send app invite' }).click();

		// It says so — pressing this used to produce no visible change at all, and
		// the only way to find out whether it worked was to ask the customer.
		await expect(page.getByText(`Invite sent to ${customer.name}`)).toBeVisible();

		// And the panel updates to reflect that one is now outstanding, with the
		// two things you can do to a live invite.
		await expect(composer.getByText('Invite sent')).toBeVisible();
		await expect(composer.getByText(/Expires/)).toBeVisible();
		await expect(composer.getByRole('button', { name: 'Send app invite' })).toHaveCount(0);
		await expect(composer.getByRole('button', { name: 'Withdraw' })).toBeVisible();

		// Resending reports itself as a resend, not as a first send.
		await composer.getByRole('button', { name: 'Resend' }).click();
		await expect(page.getByText(`Invite re-sent to ${customer.name}`)).toBeVisible();
	});

	test('a linked customer is not offered an invite at all', async ({ page }) => {
		// The seeded pair: this customer already has portal access, so there is
		// nothing to press. Pressing it would send a second link to somebody who
		// already has an account.
		await signIn(page, DEV_CONTRACTOR.email, DEV_CONTRACTOR.password);
		await page.waitForURL('**/contractor');
		await page.goto('/contractor/orders');
		await openOrder(page, 'Kitchen remodel');

		const composer = await openContactComposer(page);
		await composer.getByRole('tab', { name: 'Chat' }).click();

		// Chat is a conversation for this one, not an invitation: the invite panel
		// is not rendered at all, so there is no way to send a second link to
		// somebody who already has an account.
		await expect(composer.locator('.invite')).toHaveCount(0);
		await expect(composer.getByRole('button', { name: 'Send app invite' })).toHaveCount(0);
		await expect(composer.getByRole('button', { name: 'Resend' })).toHaveCount(0);
	});

	test('the contact composer offers email, text and call for the customer', async ({ page }) => {
		await seedWorkspace(page);
		const composer = await openContactComposer(page);

		// Every way to reach someone lives on one tab strip — the same control the
		// dashboard uses, since both mount the shared ContactPanel. Chat is there
		// even though this customer has no portal yet: the tab is the conversation
		// once they have one and the invitation to it before then.
		await expect(composer.getByRole('tab', { name: 'Chat' })).toBeVisible();
		await expect(composer.getByRole('tab', { name: 'Email' })).toBeVisible();
		await expect(composer.getByRole('tab', { name: 'Text' })).toBeVisible();
		await expect(composer.getByRole('tab', { name: 'Call' })).toBeVisible();

		// Call is a direct hand-off to the phone app — there is nothing to compose,
		// so the assertion is that the link is the right `tel:` for this customer.
		await composer.getByRole('tab', { name: 'Call' }).click();
		const call = composer.getByRole('link', { name: /Call now/ });
		await expect(call).toHaveAttribute('href', 'tel:5125550134');
	});

	test('a text opens the messaging app with the composed body', async ({ page }) => {
		await seedWorkspace(page);
		const composer = await openContactComposer(page);

		await composer.getByRole('tab', { name: 'Text' }).click();
		const body = `Running 20 minutes late ${uid()}`;
		await composer.locator('textarea').fill(body);

		// The handoff is a navigation to an `sms:` URL, which a browser cannot
		// follow — so it is caught at the network layer and inspected instead.
		const handoff = await captureExternalHandoff(page, async () => {
			await composer.getByRole('button', { name: 'Send text' }).click();
		});
		expect(handoff).toContain('sms:5125550134');
		expect(decodeURIComponent(handoff)).toContain(body);
	});

	test('a simulated email send is recorded on the history', async ({ page }) => {
		const { customer } = await seedWorkspace(page);
		const composer = await openContactComposer(page);

		await composer.getByRole('tab', { name: 'Email' }).click();
		const subject = `Schedule update ${uid()}`;
		await composer.locator('input[name="subject"]').fill(subject);
		await composer.locator('textarea[name="body"]').fill('We start Monday at 8.');

		// EMAIL_DEV_TOOLS is on for the e2e server, so the real Send is replaced by
		// a simulated pair. The provider call is the only thing skipped — the
		// ownership check, the billing gate and the timeline write all still run,
		// which is exactly what this test is here to prove.
		// Waited for explicitly: the composer closes itself the moment the send
		// resolves, so without this the reload below races the POST and can cancel
		// the very request under test.
		const posted = page.waitForResponse(
			(r) => r.request().method() === 'POST' && r.url().includes('sendEmail')
		);
		await composer.getByRole('button', { name: /mock success/ }).click();
		expect((await posted).status()).toBe(200);
		await expect(page.getByText(`Email sent to ${customer.name}`)).toBeVisible();

		// A send is recorded on the History, not in the Messages thread — the thread
		// is the portal conversation, and an email is something that happened to the
		// job. Customer-visible, unlike an internal note.
		await page.reload();
		await openTab(page, 'History');
		const entry = timelineEntry(page, `Emailed ${customer.name}`);
		await expect(entry).toBeVisible();
		await expect(entry).toContainText(subject);
		await expect(entry).not.toHaveClass(/internal/);
	});
});

/**
 * Run `action` and return the external URL it tried to navigate to.
 *
 * `sms:`, `tel:` and `mailto:` handoffs are real navigations to schemes Chromium
 * has no handler for under test. Routing them lets the assertion be about the
 * URL the app built — which is the whole of what the app controls — without the
 * navigation failing the test.
 */
async function captureExternalHandoff(
	page: import('@playwright/test').Page,
	action: () => Promise<void>
): Promise<string> {
	// Aborted rather than allowed through: Chromium has no handler for `sms:`, and
	// letting the navigation proceed logs an unhandled-scheme error on every run.
	await page.route('sms:**', (route) => route.abort());
	const seen = page.waitForRequest((r) => r.url().startsWith('sms:'), { timeout: 10_000 });
	await action();
	return (await seen).url();
}
