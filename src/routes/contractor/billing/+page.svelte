<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const billing = $derived(data.billing);
	const isTrial = $derived(billing.status === 'trialing' && billing.canWrite);
	const isPaid = $derived(billing.status === 'active' || billing.status === 'past_due');
	const isComped = $derived(billing.status === 'comped');
	const isLapsed = $derived(!billing.canWrite);

	// Monthly is the default; annual is the same product at a better rate. This is a
	// display choice only — the app never branches on which one they picked.
	let interval = $state<'monthly' | 'annual'>('monthly');

	const dateFmt = new Intl.DateTimeFormat('en-US', {
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	});
	const showDate = (d: string | Date | null) => (d ? dateFmt.format(new Date(d)) : null);

	const SIMULATIONS = [
		{ state: 'trial-fresh', label: 'Fresh trial (14d)' },
		{ state: 'trial-ending', label: 'Trial ending (2d)' },
		{ state: 'trial-expired', label: 'Trial expired' },
		{ state: 'active', label: 'Active' },
		{ state: 'past_due', label: 'Past due' },
		{ state: 'lapsed', label: 'Lapsed' },
		{ state: 'comped', label: 'Comped' }
	];

	const rows = $derived([
		{ label: 'Customers', entry: data.limits.customer },
		{ label: 'Orders', entry: data.limits.order },
		{ label: 'Subcontractors', entry: data.limits.subcontractor }
	]);
</script>

<svelte:head><title>Billing — Contractor CRM</title></svelte:head>

<div class="wrap">
	<header class="head">
		<h1>Billing</h1>
		<p class="sub">One subscription, priced per contractor. No tiers to compare.</p>
	</header>

	{#if form?.message}
		<p class="alert" role="alert">{form.message}</p>
	{/if}

	<!-- Current standing ------------------------------------------------- -->
	<section class="card status" class:lapsed={isLapsed}>
		{#if isComped}
			<span class="pill comped">Complimentary</span>
			<h2>You're all set, permanently</h2>
			<p>
				This account has a complimentary subscription — every feature, no limits, no payment needed.
				Nothing here will ever expire.
			</p>
		{:else if isLapsed}
			<span class="pill danger">
				{billing.reason === 'trial-ended' ? 'Trial ended' : 'Subscription ended'}
			</span>
			<h2>Everything you've added is safe</h2>
			<p>
				You can still open and read every customer, order and timeline. Making changes needs an
				active subscription — pick one below and you'll pick up exactly where you left off.
			</p>
			<p class="reassure">
				Your customers and subcontractors are unaffected. Their portals are working normally right
				now.
			</p>
		{:else if isTrial}
			<span class="pill trial">
				{billing.trialDaysRemaining}
				{billing.trialDaysRemaining === 1 ? 'day' : 'days'} left
			</span>
			<h2>Free trial</h2>
			<p>
				Every feature is unlocked.{#if showDate(billing.trialEndsAt)}
					Your trial ends {showDate(billing.trialEndsAt)}.{/if}
			</p>
		{:else if billing.status === 'past_due'}
			<span class="pill warn">Payment problem</span>
			<h2>We couldn't take your last payment</h2>
			<p>
				Nothing is blocked — you can keep working while we retry. Update your card to clear this up.
			</p>
		{:else if isPaid}
			<span class="pill active">Active</span>
			<h2>Your subscription is active</h2>
			<p>
				Unlimited customers, orders and subcontractors.{#if showDate(billing.currentPeriodEnd)}
					Renews {showDate(billing.currentPeriodEnd)}.{/if}
			</p>
		{/if}

		<!-- Usage belongs with the status it qualifies, not in a card of its own. -->
		{#if billing.limitsApply}
			<ul class="usage">
				{#each rows as row (row.label)}
					<li class:at={row.entry.atLimit}>
						<div class="usage-top">
							<span class="usage-label">{row.label}</span>
							<span class="usage-count">{row.entry.used} / {row.entry.limit}</span>
						</div>
						<div class="meter" role="presentation">
							<span
								class="meter-fill"
								style="width: {Math.min(100, (row.entry.used / row.entry.limit) * 100)}%"
							></span>
						</div>
					</li>
				{/each}
			</ul>
			<p class="note">Archiving frees a space. Subscribing removes the limits entirely.</p>
		{/if}
	</section>

	<!-- Buy / manage ------------------------------------------------------ -->
	{#if !isComped}
		<section class="card plan">
			{#if isPaid && billing.hasPaymentAccount}
				<h3>Manage your subscription</h3>
				<p class="note">
					Update your card, switch between monthly and annual, download invoices, or cancel.
				</p>
				<form method="POST" action="?/portal" use:enhance>
					<button type="submit" class="btn primary">Manage billing</button>
				</form>
			{:else}
				<h3>Subscribe</h3>
				<div class="toggle" role="group" aria-label="Billing period">
					<button
						type="button"
						class="toggle-opt"
						class:on={interval === 'monthly'}
						onclick={() => (interval = 'monthly')}
					>
						Monthly
					</button>
					<button
						type="button"
						class="toggle-opt"
						class:on={interval === 'annual'}
						onclick={() => (interval = 'annual')}
					>
						Annual <span class="save">2 months free</span>
					</button>
				</div>

				<p class="price">
					{#if interval === 'monthly'}
						<strong>$29</strong><span class="per"> / contractor / month</span>
					{:else}
						<strong>$290</strong><span class="per"> / contractor / year</span>
					{/if}
				</p>

				<ul class="points">
					<li>Unlimited customers, orders and subcontractors</li>
					<li>Every feature — nothing is held back for a higher tier</li>
					<li>Customer portals and subcontractor access included</li>
					<li>Cancel any time; your data stays readable either way</li>
				</ul>

				{#if data.checkoutAvailable}
					<form method="POST" action="?/subscribe" use:enhance>
						<input type="hidden" name="interval" value={interval} />
						<button type="submit" class="btn primary">
							{isLapsed ? 'Reactivate' : 'Subscribe'} — {interval === 'monthly'
								? '$29/month'
								: '$290/year'}
						</button>
					</form>
				{:else}
					<p class="alert" role="status">
						Checkout isn't configured in this environment yet, so subscribing is unavailable here.
					</p>
				{/if}
			{/if}
		</section>
	{/if}

	<!-- Dev-only state simulator ------------------------------------------ -->
	{#if data.devTools}
		<section class="card dev">
			<h3>Simulate a subscription state</h3>
			<p class="note">
				Development only (<code>BILLING_DEV_TOOLS</code>). Forces your own subscription so the
				paywall can be exercised without waiting out a trial or failing a real card. "Trial expired"
				leaves the row as <code>trialing</code> with a past date, so it exercises the real derivation
				rather than a hand-set status.
			</p>
			<form method="POST" action="?/simulate" use:enhance class="dev-grid">
				{#each SIMULATIONS as sim (sim.state)}
					<button type="submit" name="state" value={sim.state} class="dev-btn">{sim.label}</button>
				{/each}
			</form>
		</section>
	{/if}
</div>

<style>
	.wrap {
		max-width: 720px;
		margin: 0 auto;
		padding: clamp(1.5rem, 4vw, 2.5rem) 1rem 4rem;
		display: grid;
		gap: 1.1rem;
	}
	.head h1 {
		margin: 0;
		/* Opt out of the global chunky-yellow h1 treatment. */
		display: block;
		background: none;
		border: none;
		box-shadow: none;
		border-radius: 0;
		padding: 0;
		font-size: clamp(1.6rem, 4vw, 2.1rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		text-transform: none;
		color: var(--fg);
	}
	.sub {
		margin: 0.35rem 0 0;
		color: var(--fg-muted);
		font-size: 0.92rem;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 1.25rem;
		box-shadow: var(--card-shadow);
	}
	.status.lapsed {
		border-color: var(--danger);
	}
	.card h2 {
		margin: 0.6rem 0 0.4rem;
		font-size: 1.15rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: var(--fg);
		text-transform: none;
	}
	.card h3 {
		margin: 0 0 0.6rem;
		font-size: 1rem;
		font-weight: 800;
		color: var(--fg);
		text-transform: none;
	}
	.card p {
		margin: 0 0 0.4rem;
		color: var(--fg-muted);
		line-height: 1.55;
		font-size: 0.92rem;
	}
	.reassure {
		margin-top: 0.7rem;
		padding-top: 0.7rem;
		border-top: 1px solid var(--line);
		font-size: 0.86rem;
	}

	.pill {
		display: inline-block;
		padding: 0.22rem 0.6rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border: 1.5px solid transparent;
	}
	.pill.trial {
		background: var(--yellow);
		color: var(--on-yellow);
		border-color: #14171c;
	}
	.pill.active,
	.pill.comped {
		background: #1a7f37;
		color: #fff;
	}
	.pill.warn {
		background: #bf8700;
		color: #fff;
	}
	.pill.danger {
		background: var(--danger);
		color: #fff;
	}

	.usage {
		list-style: none;
		margin: 0.9rem 0 0.6rem;
		padding: 0;
		display: grid;
		gap: 0.7rem;
	}
	.usage-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.3rem;
	}
	.usage-label {
		font-weight: 700;
		font-size: 0.88rem;
		color: var(--fg);
	}
	.usage-count {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--fg-muted);
		font-variant-numeric: tabular-nums;
	}
	.usage li.at .usage-count {
		color: var(--danger);
	}
	.meter {
		height: 7px;
		border-radius: 999px;
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		overflow: hidden;
	}
	.meter-fill {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, var(--yellow), var(--yellow-deep));
	}
	.usage li.at .meter-fill {
		background: var(--danger);
	}
	.note {
		font-size: 0.86rem;
	}

	.toggle {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1.5px solid var(--line);
		border-radius: 999px;
		background: var(--surface-sunken);
		margin-bottom: 0.9rem;
		flex-wrap: wrap;
	}
	.toggle-opt {
		padding: 0.4rem 0.9rem;
		border: none;
		border-radius: 999px;
		background: none;
		color: var(--fg-muted);
		font-weight: 700;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.toggle-opt.on {
		background: var(--yellow);
		color: var(--on-yellow);
	}
	.save {
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.8;
	}

	.price {
		margin: 0.2rem 0 0.8rem;
		color: var(--fg);
	}
	.price strong {
		font-size: 2rem;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.per {
		color: var(--fg-muted);
		font-size: 0.9rem;
	}

	.points {
		margin: 0 0 1rem;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.35rem;
		font-size: 0.9rem;
		color: var(--fg-muted);
	}
	.points li {
		padding-left: 1.2rem;
		position: relative;
		line-height: 1.45;
	}
	.points li::before {
		content: '✓';
		position: absolute;
		left: 0;
		color: var(--yellow-deep);
		font-weight: 800;
	}

	.btn {
		padding: 0.7rem 1.2rem;
		border-radius: 10px;
		border: none;
		background: #14171c;
		color: #fff;
		font-weight: 700;
		font-size: 0.88rem;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.btn:hover {
		background: #000;
	}
	.btn:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}

	.alert {
		margin: 0;
		padding: 0.7rem 0.9rem;
		border-radius: 10px;
		border: 1.5px solid var(--danger);
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		color: var(--fg);
		font-size: 0.88rem;
	}

	/* ---- Dark theme ----
	   Scoped to `.btn.primary` rather than a bare `.btn`, so these don't outrank
	   more specific states elsewhere. */
	:global(:root[data-theme='dark']) .btn.primary {
		background: var(--fg);
		color: #14171c;
	}
	:global(:root[data-theme='dark']) .btn.primary:hover {
		background: #fff;
	}

	/* Development-only panel. Dashed and sunken so it can never be mistaken for
	   product UI in a screenshot. */
	.card.dev {
		border-style: dashed;
		border-color: var(--line-strong);
		background: var(--surface-sunken);
	}
	.dev code {
		font-size: 0.85em;
		padding: 0.05rem 0.3rem;
		border-radius: 4px;
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.dev-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.7rem;
	}
	.dev-btn {
		padding: 0.4rem 0.75rem;
		border-radius: 8px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg);
		font-size: 0.8rem;
		font-weight: 700;
		font-family: inherit;
		cursor: pointer;
	}
	.dev-btn:hover {
		border-color: var(--fg-muted);
	}
	.dev-btn:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}
</style>
