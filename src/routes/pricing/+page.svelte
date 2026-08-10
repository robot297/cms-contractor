<script lang="ts">
	import { resolve } from '$app/paths';
	import ThemeToggle from '$lib/ThemeToggle.svelte';
	import { TRIAL_DAYS, TRIAL_LIMITS } from '$lib/crm';

	// There is exactly one thing to buy, priced per contractor. No tiers, no feature
	// comparison, no "you'll need the higher plan for that" — see
	// docs/adr/0006-one-plan-priced-per-contractor.md. The earlier three-tier
	// placeholder was deleted rather than renamed: pricing levels aren't a concept
	// in this product, and "Tier" already means a subcontractor's access level.
	let interval = $state<'monthly' | 'annual'>('monthly');

	const included = [
		'Unlimited customers, orders and subcontractors',
		'Customer portals with magic-link invites',
		'Subcontractor access with trusted and guest levels',
		'Order timelines, attachments and follow-ups',
		'Custom email templates and branding',
		'Every feature — nothing held back for a higher plan'
	];
</script>

<svelte:head>
	<title>Pricing — Contractor CRM</title>
	<meta
		name="description"
		content="Contractor CRM pricing — one plan, $29 per contractor per month, with a 14-day free trial. No card required to start."
	/>
</svelte:head>

<ThemeToggle />

<div class="pricing">
	<header class="head">
		<a class="back" href={resolve('/')}>← Back</a>
		<h1 class="title">One plan. Priced per contractor.</h1>
		<p class="sub">
			Start with a {TRIAL_DAYS}-day free trial — no card required. After that it's one price, per
			contractor, with everything included.
		</p>
	</header>

	<div class="panel">
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
				<strong>$29</strong><span class="per">per contractor / month</span>
			{:else}
				<strong>$290</strong><span class="per">per contractor / year</span>
			{/if}
		</p>
		<p class="scale">
			Working on your own? That's one. Got a crew of five contractors? That's five. Nothing else
			changes.
		</p>

		<ul class="points">
			{#each included as point (point)}
				<li>{point}</li>
			{/each}
		</ul>

		<a class="btn" href={resolve('/login')}>Start your free trial</a>
		<p class="fine">No card required · Cancel any time</p>
	</div>

	<section class="trial">
		<h2>What the free trial covers</h2>
		<p>
			For {TRIAL_DAYS} days you get every feature, with no card and nothing switched off. The only limit
			is how much you can have on the go at once:
		</p>
		<ul class="caps">
			<li><strong>{TRIAL_LIMITS.customer}</strong> active customers</li>
			<li><strong>{TRIAL_LIMITS.order}</strong> active orders</li>
			<li><strong>{TRIAL_LIMITS.subcontractor}</strong> active subcontractors</li>
		</ul>
		<p class="note">
			Only live work counts — archive a customer you're done with and the space comes straight back,
			with nothing deleted. And if your trial runs out, you keep full access to read everything
			you've added; only changes pause until you subscribe. Your customers' portals keep working
			throughout.
		</p>
	</section>

	<p class="foot-note">
		Questions about whether this fits how you work? <a href={resolve('/login')}>Sign in</a> and reach
		out from the support page.
	</p>
</div>

<style>
	.pricing,
	.pricing *,
	.pricing *::before,
	.pricing *::after {
		box-sizing: border-box;
	}
	.pricing {
		min-height: 100dvh;
		padding: clamp(3rem, 8vw, 5rem) clamp(1rem, 5vw, 3rem) 4rem;
		background: var(--surface);
		color: var(--fg);
		font-family: 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif;
	}
	.head {
		max-width: 46rem;
		margin: 0 auto 2.5rem;
		text-align: center;
	}
	.back {
		display: inline-block;
		margin-bottom: 1.25rem;
		color: var(--fg-muted);
		text-decoration: none;
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.back:hover {
		color: var(--fg);
	}
	/* Opt out of the global chunky-yellow h1 treatment. */
	.title {
		margin: 0;
		display: block;
		background: none;
		border: none;
		border-radius: 0;
		box-shadow: none;
		padding: 0;
		font-size: clamp(2rem, 5vw, 2.8rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		text-transform: none;
		color: var(--fg);
	}
	.sub {
		margin: 0.7rem auto 0;
		max-width: 34rem;
		color: var(--fg-muted);
		line-height: 1.55;
	}

	/* One panel, centered — there is nothing to compare it against. */
	.panel {
		max-width: 30rem;
		margin: 0 auto;
		display: grid;
		gap: 0.7rem;
		justify-items: center;
		text-align: center;
		padding: 2rem 1.6rem;
		border: 1px solid var(--line);
		border-radius: 18px;
		background: var(--surface);
		box-shadow: var(--pop-shadow);
	}
	.toggle {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1.5px solid var(--line);
		border-radius: 999px;
		background: var(--surface-sunken);
		flex-wrap: wrap;
		justify-content: center;
	}
	.toggle-opt {
		padding: 0.45rem 1rem;
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
		color: #14171c;
	}
	.toggle-opt:focus-visible {
		outline: 2px solid var(--yellow-deep);
		outline-offset: 2px;
	}
	.save {
		font-size: 0.66rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.85;
	}

	.price {
		margin: 0.4rem 0 0;
		display: grid;
		gap: 0.1rem;
	}
	.price strong {
		font-size: clamp(2.6rem, 8vw, 3.4rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1;
	}
	.per {
		color: var(--fg-muted);
		font-size: 0.9rem;
		font-weight: 600;
	}
	.scale {
		margin: 0;
		max-width: 24rem;
		color: var(--fg-muted);
		font-size: 0.88rem;
		line-height: 1.5;
	}

	.points {
		margin: 0.6rem 0 0.4rem;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.45rem;
		font-size: 0.9rem;
		color: var(--fg-muted);
		text-align: left;
	}
	.points li {
		padding-left: 1.4rem;
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
		margin-top: 0.5rem;
		align-self: stretch;
		width: 100%;
		padding: 0.85rem;
		text-align: center;
		text-decoration: none;
		border: none;
		border-radius: 10px;
		background: #14171c;
		color: #fff;
		font-weight: 700;
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		box-shadow: var(--pop-shadow);
		transition:
			transform 0.12s ease,
			box-shadow 0.12s ease;
	}
	.btn:hover {
		transform: translateY(-1px);
		box-shadow: var(--pop-shadow-lg);
	}
	.btn:active {
		transform: translateY(0);
		box-shadow: none;
	}
	.fine {
		margin: 0;
		color: var(--fg-muted);
		font-size: 0.78rem;
	}

	.trial {
		max-width: 34rem;
		margin: 2.5rem auto 0;
		padding: 1.5rem 1.4rem;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--surface);
	}
	.trial h2 {
		margin: 0 0 0.5rem;
		font-size: 1.05rem;
		font-weight: 800;
		color: var(--fg);
		text-transform: none;
		letter-spacing: -0.01em;
	}
	.trial p {
		margin: 0;
		color: var(--fg-muted);
		font-size: 0.9rem;
		line-height: 1.55;
	}
	.caps {
		margin: 0.8rem 0;
		padding: 0;
		list-style: none;
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.caps li {
		flex: 1 1 8rem;
		padding: 0.7rem 0.6rem;
		border-radius: 10px;
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		text-align: center;
		font-size: 0.78rem;
		color: var(--fg-muted);
		line-height: 1.35;
	}
	.caps strong {
		display: block;
		font-size: 1.4rem;
		font-weight: 800;
		color: var(--fg);
		letter-spacing: -0.02em;
	}
	.note {
		margin-top: 0.8rem;
		padding-top: 0.8rem;
		border-top: 1px solid var(--line);
		font-size: 0.85rem;
	}

	.foot-note {
		margin: 2.5rem auto 0;
		text-align: center;
		color: var(--fg-muted);
		font-size: 0.9rem;
	}
	.foot-note a {
		color: inherit;
		text-decoration-color: var(--yellow-deep);
		text-decoration-thickness: 2px;
		text-underline-offset: 2px;
	}

	/* ---- Dark theme ---- */
	:global(:root[data-theme='dark']) .btn {
		background: var(--fg);
		border-color: var(--fg);
		color: #14171c;
	}
</style>
