#!/usr/bin/env node
/**
 * Billing integration test.
 *
 * Drives the real HTTP surface of a running dev server — real signups, real form
 * actions, real guards — because the things most worth checking about billing are
 * exactly the things unit tests can't see: that a lapsed contractor can still READ
 * everything, that their customers and subcontractors are untouched, and that a
 * refused write leaves the database alone.
 *
 * The pure rules (who may write, what the caps are, provider-status mapping) are
 * unit-tested in src/lib/crm.test.ts, and the guard coverage in
 * src/lib/server/billing.guard.test.ts. This covers the wiring between them.
 *
 *   pnpm dev                 # in one terminal
 *   pnpm test:billing        # in another
 *
 * Creates throwaway accounts and deletes them at the end, including on failure.
 */
import postgres from 'postgres';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5173';
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const stamp = Date.now();
const PASSWORD = 'billing-test-2026';
const emails = {
	contractor: `bt-contractor-${stamp}@example.com`,
	customer: `bt-customer-${stamp}@example.com`,
	sub: `bt-sub-${stamp}@example.com`
};

let cookie = '';
const results = [];
let group = '';

function heading(name) {
	group = name;
	console.log(`\n\x1b[1m${name}\x1b[0m`);
}
function check(name, pass, detail = '') {
	results.push({ group, name, pass });
	const mark = pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
	console.log(`  ${mark} ${name}${detail ? ` \x1b[2m— ${detail}\x1b[0m` : ''}`);
}

async function req(path, { method = 'GET', body, headers = {} } = {}) {
	const res = await fetch(BASE + path, {
		method,
		headers: { ...(cookie ? { cookie } : {}), ...headers },
		body,
		redirect: 'manual'
	});
	for (const c of res.headers.getSetCookie?.() ?? []) {
		const pair = c.split(';')[0];
		if (pair.startsWith('better-auth')) cookie = pair;
	}
	return res;
}
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const post = (path, fields) =>
	req(path, { method: 'POST', headers: FORM, body: new URLSearchParams(fields).toString() });

const countActive = async (table, col, id) => {
	const dead = table === 'order' ? 'deleted_at' : 'archived_at';
	const [r] = await sql.unsafe(
		`select count(*)::int as n from "${table}" where ${col} = $1 and ${dead} is null`,
		[id]
	);
	return r.n;
};
const timelineCount = async (orderId) =>
	(await sql`select count(*)::int as n from timeline_entry where order_id = ${orderId}`)[0].n;

let contractorId, customerUserId, subUserId;

try {
	// --------------------------------------------------------------- provisioning
	heading('Provisioning');
	await post('/login?/signUp', {
		email: emails.contractor,
		password: PASSWORD,
		name: 'Billing Test'
	});
	const [c] = await sql`select id, role from "user" where email = ${emails.contractor}`;
	contractorId = c?.id;
	check('signup creates a contractor', c?.role === 'contractor');

	const [before] = await sql`select 1 from subscription where contractor_id = ${contractorId}`;
	check('no subscription until a contractor surface is loaded', before === undefined);

	const dash = await req('/contractor');
	check('dashboard loads', dash.status === 200, `status=${dash.status}`);

	let [sub] = await sql`select * from subscription where contractor_id = ${contractorId}`;
	const days = Math.round((new Date(sub.trial_ends_at) - Date.now()) / 86400000);
	check(
		'lazy provisioning starts a 14-day trial',
		sub.status === 'trialing' && days === 14,
		`status=${sub.status} days=${days}`
	);

	const dashBody = await (await req('/contractor')).text();
	check('trial welcome shows on the dashboard', /Welcome to your free trial/.test(dashBody));
	check('trial badge shows in the nav', /class="trial-badge/.test(dashBody));

	await post('/contractor?/dismissTrialNotice', {});
	const afterDismiss = await (await req('/contractor')).text();
	check('dismissing the welcome sticks', !/Welcome to your free trial/.test(afterDismiss));
	check('the nav badge survives dismissal', /class="trial-badge/.test(afterDismiss));
	// Put it back so later assertions aren't reading a dismissed dashboard.
	await sql`update contractor_settings set trial_notice_dismissed_at = null where contractor_id = ${contractorId}`;

	// -------------------------------------------------------------- trial limits
	heading('Trial limits');
	const LIMIT = 25;
	for (let i = 0; i < LIMIT - 1; i++) {
		await sql`insert into customer (id, contractor_id, name, email)
		          values (${crypto.randomUUID()}, ${contractorId}, ${`Seed ${i}`}, ${`seed${i}-${stamp}@example.com`})`;
	}
	await post('/contractor/customers?/addCustomer', {
		name: 'Number 25',
		email: `c25-${stamp}@example.com`
	});
	check(
		'creating up to the cap works',
		(await countActive('customer', 'contractor_id', contractorId)) === LIMIT
	);

	const refused = await post('/contractor/customers?/addCustomer', {
		name: 'Over',
		email: `over-${stamp}@example.com`
	});
	const refusedBody = await refused.text();
	check(
		'creating past the cap is refused',
		(await countActive('customer', 'contractor_id', contractorId)) === LIMIT
	);
	check('the refusal names the limit', /trial covers 25 customers/i.test(refusedBody));

	const [victim] =
		await sql`select id from customer where contractor_id = ${contractorId} and archived_at is null limit 1`;
	await sql`update customer set archived_at = now() where id = ${victim.id}`;
	await post('/contractor/customers?/addCustomer', {
		name: 'After archive',
		email: `after-${stamp}@example.com`
	});
	check(
		'archiving frees a slot',
		(await countActive('customer', 'contractor_id', contractorId)) === LIMIT
	);
	check(
		'the archived record still exists',
		(await sql`select count(*)::int as n from customer where id = ${victim.id}`)[0].n === 1
	);

	// Fixtures for the lapse checks.
	const orderId = crypto.randomUUID();
	const [portalCust] =
		await sql`select id, email from customer where contractor_id = ${contractorId} and archived_at is null limit 1`;
	await sql`insert into "order" (id, contractor_id, customer_id, project_name, state)
	          values (${orderId}, ${contractorId}, ${portalCust.id}, 'Billing Test Deck', 'In Progress')`;

	// ---------------------------------------------------------------- lapsing
	heading('Lapsing (trial expiry)');
	// Expire by date, not by status: an expired trial IS lapsed, derived. Setting
	// status='lapsed' here would skip the very derivation worth testing.
	await sql`update subscription set trial_ends_at = now() - interval '1 day' where contractor_id = ${contractorId}`;

	const lapsedDash = await req('/contractor');
	const lapsedBody = await lapsedDash.text();
	check('lapsed contractor can still load the dashboard', lapsedDash.status === 200);
	check('lapsed banner is shown', /free trial has ended/i.test(lapsedBody));

	const custPage = await req('/contractor/customers');
	const custBody = await custPage.text();
	check('lapsed contractor can still read customers', custPage.status === 200);
	check('their data still renders', custBody.includes('Number 25'));
	check(
		'lapsed contractor can still read an order',
		(await req(`/contractor/orders/${orderId}`)).status === 200
	);

	const writes = [
		[
			'create customer',
			'/contractor/customers?/addCustomer',
			{ name: 'No', email: `no-${stamp}@example.com` }
		],
		[
			'edit customer',
			'/contractor/customers?/editCustomer',
			{ id: portalCust.id, name: 'Renamed', email: portalCust.email }
		],
		['archive customer', '/contractor/customers?/archiveCustomer', { id: portalCust.id }],
		[
			'change order state',
			`/contractor/orders/${orderId}?/updateStatus`,
			{ state: 'Work Complete' }
		],
		['add order note', `/contractor/orders/${orderId}?/addNote`, { note: 'blocked?' }],
		['send invite', '/contractor/customers?/sendInvite', { id: portalCust.id }],
		[
			'create template',
			'/contractor/settings/templates?/createTemplate',
			{ name: 'X', subject: 's', body: 'b' }
		]
	];
	let allRefused = true;
	for (const [label, path, fields] of writes) {
		const html = await (await post(path, fields)).text();
		// SvelteKit carries fail() status in the action payload, not the HTTP status,
		// so assert on the rendered refusal rather than a 402.
		if (!/trial has ended|subscription has ended/i.test(html)) {
			allRefused = false;
			check(`refused: ${label}`, false);
		}
	}
	check('every contractor write is refused', allRefused, `${writes.length} write paths`);

	const [named] = await sql`select name, archived_at from customer where id = ${portalCust.id}`;
	const [state] = await sql`select state from "order" where id = ${orderId}`;
	check(
		'refused writes mutated nothing',
		named.name !== 'Renamed' && named.archived_at === null && state.state === 'In Progress'
	);

	// ------------------------------------------------- downstream (ADR-0005)
	heading('Downstream portals are unaffected (ADR-0005)');
	const contractorCookie = cookie;
	cookie = '';
	await post('/login?/signUp', {
		email: emails.customer,
		password: PASSWORD,
		name: 'Portal Customer'
	});
	const [cu] = await sql`select id from "user" where email = ${emails.customer}`;
	customerUserId = cu.id;
	await sql`update "user" set role = 'customer' where id = ${customerUserId}`;
	await sql`update customer set user_id = ${customerUserId} where id = ${portalCust.id}`;

	const portal = await req('/customer');
	const portalBody = await portal.text();
	check('customer portal loads', portal.status === 200);
	check('portal shows the order', /Billing Test Deck/.test(portalBody));
	check(
		'portal never mentions the billing state',
		!/trial has ended|subscription has ended/i.test(portalBody)
	);

	const beforeReq = await timelineCount(orderId);
	await post('/customer?/request', { orderId, type: 'question', detail: 'Schedule?' });
	check('customer can still send a request', (await timelineCount(orderId)) > beforeReq);

	cookie = '';
	await post('/login?/signUp', { email: emails.sub, password: PASSWORD, name: 'Trusted Sub' });
	const [su] = await sql`select id from "user" where email = ${emails.sub}`;
	subUserId = su.id;
	await sql`update "user" set role = 'subcontractor' where id = ${subUserId}`;
	const subId = crypto.randomUUID();
	await sql`insert into subcontractor (id, contractor_id, name, email, tier, user_id)
	          values (${subId}, ${contractorId}, 'Trusted Sub', ${emails.sub}, 'trusted', ${subUserId})`;
	await sql`insert into order_subcontractor (order_id, subcontractor_id) values (${orderId}, ${subId})`;

	check('subcontractor portal loads', (await req(`/subcontractor/${orderId}`)).status === 200);
	const beforeNote = await timelineCount(orderId);
	await post(`/subcontractor/${orderId}?/addNote`, { note: 'Framing done.' });
	check('trusted sub can still write back', (await timelineCount(orderId)) > beforeNote);

	// ----------------------------------------------------------- other states
	heading('Other subscription states');
	cookie = contractorCookie;

	// past_due must keep writing: Stripe retries for weeks (ADR-0005).
	await sql`update subscription set status = 'past_due', trial_ends_at = null where contractor_id = ${contractorId}`;
	const pdBefore = await timelineCount(orderId);
	await post(`/contractor/orders/${orderId}?/addNote`, { note: 'past due still writes' });
	check(
		'past_due keeps writing while the provider retries',
		(await timelineCount(orderId)) > pdBefore
	);

	await sql`update subscription set status = 'lapsed' where contractor_id = ${contractorId}`;
	const lapBefore = await timelineCount(orderId);
	await post(`/contractor/orders/${orderId}?/addNote`, { note: 'should not land' });
	check(
		'an explicitly lapsed subscription refuses writes',
		(await timelineCount(orderId)) === lapBefore
	);

	await sql`update subscription set status = 'active', trial_ends_at = null where contractor_id = ${contractorId}`;
	const actBefore = await timelineCount(orderId);
	await post(`/contractor/orders/${orderId}?/addNote`, { note: 'back in business' });
	check('active restores writing', (await timelineCount(orderId)) > actBefore);

	const cappedAt = await countActive('customer', 'contractor_id', contractorId);
	await post('/contractor/customers?/addCustomer', {
		name: 'Uncapped',
		email: `unc-${stamp}@example.com`
	});
	const nowAt = await countActive('customer', 'contractor_id', contractorId);
	check(
		'a paid subscription has no limits',
		nowAt > cappedAt && nowAt > LIMIT,
		`${cappedAt} → ${nowAt}`
	);

	await sql`update subscription set status = 'comped', trial_ends_at = null where contractor_id = ${contractorId}`;
	const compedBody = await (await req('/contractor')).text();
	check(
		'comped shows no trial or paywall chrome',
		!/Welcome to your free trial|trial has ended/i.test(compedBody)
	);

	// ------------------------------------------------------------- resilience
	heading('Resilience');
	const billing = await req('/contractor/billing');
	const billingBody = await billing.text();
	check('billing page renders without Stripe configured', billing.status === 200);

	// The simulator hands out subscriptions, so it must be inert unless explicitly
	// enabled. When it is on, the panel is expected — assert whichever applies.
	const devOn = process.env.BILLING_DEV_TOOLS === 'true';
	const panelShown = /Simulate a subscription state/.test(billingBody);
	check(
		`dev-tools panel ${devOn ? 'shown when enabled' : 'hidden when disabled'}`,
		panelShown === devOn
	);
	if (!devOn) {
		const statusBefore = (
			await sql`select status from subscription where contractor_id = ${contractorId}`
		)[0].status;
		await post('/contractor/billing?/simulate', { state: 'comped' });
		const statusAfter = (
			await sql`select status from subscription where contractor_id = ${contractorId}`
		)[0].status;
		check('the simulate action is refused when dev tools are off', statusBefore === statusAfter);
	}
} finally {
	if (contractorId || customerUserId || subUserId) {
		const ids = [contractorId, customerUserId, subUserId].filter(Boolean);
		await sql`delete from "user" where id in ${sql(ids)}`;
	}
	const failed = results.filter((r) => !r.pass);
	console.log(
		`\n${results.length - failed.length}/${results.length} checks passed` +
			(failed.length ? `\n\x1b[31mFailed:\x1b[0m ${failed.map((f) => f.name).join(', ')}` : '')
	);
	await sql.end();
	process.exit(failed.length ? 1 : 0);
}
