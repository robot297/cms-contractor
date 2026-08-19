import {
	test,
	expect,
	clickUntil,
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
	test('a subcontractor can be staged and then assigned to the order', async ({ page }) => {
		const { subcontractor } = await seedWorkspace(page);

		await openTab(page, 'Workers');
		// Nobody on the job yet, but the roster is not empty — so the panel offers
		// the search rather than the "no subcontractors" state.
		await expect(page.getByText('No one is on this job yet')).toBeVisible();

		await assignSubcontractor(page, subcontractor.name);

		// It survives a reload, which is the difference between staged and saved.
		await page.reload();
		await openTab(page, 'Workers');
		await expect(assignedCrew(page).filter({ hasText: subcontractor.name })).toBeVisible();
	});

	test('an empty roster offers the way to build one instead of a search', async ({ page }) => {
		// A contractor who has never added anyone — the state the Workers panel has
		// to speak to before the feature is of any use to them.
		await seedWorkspace(page, { withSubcontractor: false });

		await openTab(page, 'Workers');
		await expect(page.getByText('No subcontractors found')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Add subcontractors' })).toBeVisible();
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

		await setStatus(page, 'Work Complete');
		await openTab(page, 'History');
		await expect(timeline(page).locator('li.tl-entry')).toHaveCount(before + 2);
		// Newest first: the most recent status is the entry at the top.
		await expect(timeline(page).locator('li.tl-entry').first()).toContainText('Work Complete');
	});

	test('a long history collapses to the latest few, with details foldable', async ({ page }) => {
		await seedWorkspace(page);

		// Five moves, so the list is comfortably past the preview cap.
		for (const state of [
			'Quote Sent',
			'Deposit Pending',
			'Work Scheduled',
			'In Progress',
			'Work Complete'
		]) {
			await setStatus(page, state);
		}

		await openTab(page, 'History');
		const entries = timeline(page).locator('li.tl-entry');
		const preview = await entries.count();

		// Capped, and the newest is what survives the cap — a preview that showed
		// the OLDEST few would be worse than no preview at all.
		expect(preview).toBeLessThanOrEqual(4);
		await expect(entries.first()).toContainText('Work Complete');

		// The rest is one press away.
		const showAll = page.getByRole('button', { name: /^Show all / });
		await showAll.click();
		expect(await entries.count()).toBeGreaterThan(preview);
		await expect(page.getByRole('button', { name: 'Show less' })).toBeVisible();

		// And the detail lines fold, leaving a spine of what happened and when.
		await expect(timeline(page).locator('.tl-detail').first()).toBeVisible();
		await page.getByRole('button', { name: 'Hide details' }).click();
		await expect(timeline(page).locator('.tl-detail').first()).toBeHidden();
		await expect(entries.first()).toContainText('Work Complete');
	});

	test('the portal invite says what happened and offers to resend', async ({ page }) => {
		const { customer } = await seedWorkspace(page);

		// The customer pane is where the invite lives.
		await clickUntil(
			page.getByRole('button', { name: 'Customer details' }),
			page.getByRole('button', { name: /Invite customer to portal/ })
		);

		// Nobody has been invited yet, so that is what it offers.
		await expect(page.getByText(/Invite sent/)).toHaveCount(0);
		await page.getByRole('button', { name: /Invite customer to portal/ }).click();

		// It says so — pressing this used to produce no visible change at all, and
		// the only way to find out whether it worked was to ask the customer.
		await expect(page.getByText(`Invite sent to ${customer.name}`)).toBeVisible();

		// And the control updates to reflect that one is now outstanding.
		await clickUntil(
			page.getByRole('button', { name: 'Customer details' }),
			page.getByRole('button', { name: /Resend invite/ })
		);
		await expect(page.getByText(/Invite sent .* expires/)).toBeVisible();
		await expect(page.getByRole('button', { name: /Invite customer to portal/ })).toHaveCount(0);

		// Resending reports itself as a resend, not as a first send.
		await page.getByRole('button', { name: /Resend invite/ }).click();
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

		await clickUntil(
			page.getByRole('button', { name: 'Customer details' }),
			page.getByText('Has portal access')
		);
		await expect(page.getByRole('button', { name: /Invite|Resend/ })).toHaveCount(0);
	});

	test('the contact composer offers email, text and call for the customer', async ({ page }) => {
		await seedWorkspace(page);
		const composer = await openContactComposer(page);

		// Every way to reach someone lives on one tab strip — the same control the
		// dashboard uses, since both mount the shared ContactPanel. No Chat tab
		// here: this customer has no portal to deliver a reply to.
		await expect(composer.getByRole('tab', { name: 'Chat' })).toHaveCount(0);
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
