import {
	test,
	expect,
	addCustomer,
	addSubcontractor,
	clickUntil,
	createOrder,
	newCustomerFields,
	newOrderFields,
	newSubcontractorFields,
	signUpContractor
} from './fixtures/app';

/**
 * The three records a contractor has to be able to create before the product
 * does anything at all: a customer, a subcontractor, and an order joining a
 * customer to some work.
 */
test.describe('contractor core records', () => {
	test('a new contractor can add a customer, a subcontractor and an order', async ({ page }) => {
		await signUpContractor(page);

		const customer = await addCustomer(page, newCustomerFields());

		const subcontractor = await addSubcontractor(page, newSubcontractorFields());
		await expect(page.getByText(subcontractor.name).first()).toBeVisible();

		const order = newOrderFields(customer.name);
		await createOrder(page, order);

		// The workspace is the proof the order exists and knows who it is for.
		await expect(page.getByRole('heading', { name: order.projectName })).toBeVisible();
		await expect(page.getByText(customer.name).first()).toBeVisible();
	});

	test('the ZIP fills in city and state on the customer form', async ({ page }) => {
		await signUpContractor(page);
		await page.goto('/contractor/customers');

		const dialog = page.getByRole('dialog').filter({ hasText: 'Add a customer' });
		await expect(dialog).toBeVisible(); // opens itself on an empty directory

		// Before the ZIP, the strip states what is about to happen rather than
		// showing a value.
		await expect(dialog.getByText('City and state fill in from the ZIP')).toBeVisible();

		await dialog.locator('input[name="postalCode"]').fill('78701');

		// Filled from the lookup, and submitted even though neither is a visible
		// field at this point — they ride along as hidden inputs.
		await expect(dialog.getByText('Austin, TX')).toBeVisible();
		await expect(dialog.locator('input[name="city"]')).toHaveValue('Austin');
		await expect(dialog.locator('input[name="state"]')).toHaveValue('TX');

		const fields = newCustomerFields();
		await dialog.locator('input[name="name"]').fill(fields.name);
		await dialog.locator('input[name="email"]').fill(fields.email);
		await dialog.getByRole('button', { name: 'Add customer', exact: true }).click();
		await expect(dialog).toBeHidden();

		// And it stuck. Adding the first customer hands the contractor back to the
		// dashboard, so the directory has to be revisited — and the location lives
		// in the card's profile pane, which opens on click.
		await page.goto('/contractor/customers');
		const row = page.getByText(fields.name).first();
		await clickUntil(row, page.getByText('Austin, TX').first());
	});

	test('a customer can be added and an order created for them in one pass', async ({ page }) => {
		await signUpContractor(page);
		await page.goto('/contractor/customers');

		const dialog = page.getByRole('dialog').filter({ hasText: 'Add a customer' });
		await expect(dialog).toBeVisible();

		const fields = newCustomerFields();
		await dialog.locator('input[name="name"]').fill(fields.name);
		await dialog.locator('input[name="email"]').fill(fields.email);
		// The checkbox that replaced the old split "Add & create order" button.
		await dialog.getByRole('checkbox').check();
		await dialog.getByRole('button', { name: 'Add customer', exact: true }).click();

		// Ticking it hands them straight to the order form with the customer chosen.
		await page.waitForURL(/\/contractor\/orders\?customer=/);
		const orderDialog = page.locator('dialog.neworder');
		await expect(orderDialog).toBeVisible();
		await expect(orderDialog.locator('select[name="customerId"]')).not.toHaveValue('');
	});

	test('a customer is required before an order can be created', async ({ page }) => {
		await signUpContractor(page);
		await page.goto('/contractor/orders');

		const dialog = page.locator('dialog.neworder');
		await clickUntil(page.getByRole('button', { name: 'New order' }).first(), dialog);

		// With an empty directory the order form has nothing to pick from, so it
		// offers the missing step instead of a picker.
		await expect(dialog.getByText('You have no customers yet.')).toBeVisible();
		await expect(dialog.locator('select[name="customerId"]')).toHaveCount(0);
		await expect(dialog.getByRole('link', { name: 'Add a customer' })).toBeVisible();
	});
});
