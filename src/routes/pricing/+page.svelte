<script lang="ts">
	import { resolve } from '$app/paths';
	import ThemeToggle from '$lib/ThemeToggle.svelte';

	// Placeholder tiers — names, prices and limits are all still to be decided. The
	// page exists so the landing CTA has somewhere real to land; fill in the numbers
	// when the packaging is settled.
	const tiers = [
		{
			name: 'Solo',
			blurb: 'One contractor, running their own jobs.',
			price: 'TBD',
			featured: false,
			points: ['Customers and orders', 'Job scheduling', 'Email follow-ups']
		},
		{
			name: 'Crew',
			blurb: 'A working crew with subcontractors on the books.',
			price: 'TBD',
			featured: true,
			points: [
				'Everything in Solo',
				'Subcontractor access',
				'Role-based permissions',
				'Order attachments'
			]
		},
		{
			name: 'Contractor Pro',
			blurb: 'Multiple crews and a back office to keep in sync.',
			price: 'TBD',
			featured: false,
			points: ['Everything in Crew', 'Custom email templates', 'Priority support']
		}
	];
</script>

<svelte:head>
	<title>Pricing — Contractor CRM</title>
	<meta
		name="description"
		content="Contractor CRM pricing — plans for solo contractors, working crews, and multi-crew operations."
	/>
</svelte:head>

<ThemeToggle />

<div class="pricing">
	<header class="head">
		<a class="back" href={resolve('/')}>← Back</a>
		<h1 class="title">Pricing</h1>
		<p class="sub">
			Straightforward plans for however you work. We're still finalising the numbers — the shape of
			the tiers is below.
		</p>
	</header>

	<div class="tiers">
		{#each tiers as tier (tier.name)}
			<section class="tier" class:featured={tier.featured}>
				{#if tier.featured}<span class="badge">Most popular</span>{/if}
				<h2 class="tier-name">{tier.name}</h2>
				<p class="tier-blurb">{tier.blurb}</p>
				<p class="price">{tier.price}</p>
				<ul>
					{#each tier.points as point (point)}
						<li>{point}</li>
					{/each}
				</ul>
				<a class="btn" href={resolve('/login')}>Get started</a>
			</section>
		{/each}
	</div>

	<p class="foot-note">
		Questions about which plan fits? <a href={resolve('/login')}>Sign in</a> and reach out from the support
		page.
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
	.tiers {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
		gap: 1.1rem;
		max-width: 1000px;
		margin: 0 auto;
		align-items: start;
	}
	.tier {
		display: grid;
		gap: 0.6rem;
		padding: 1.6rem 1.4rem;
		border: 2px solid var(--line);
		border-radius: 16px;
		background: var(--surface);
		box-shadow: var(--card-shadow);
	}
	/* The recommended tier gets the pop-art sticker treatment so it reads as the
	   default choice without needing a different colour scheme. */
	.tier.featured {
		border: 2.5px solid var(--pop-line);
		box-shadow: var(--pop-shadow);
	}
	.badge {
		justify-self: start;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: var(--yellow);
		color: #14171c;
		border: 1.5px solid #14171c;
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.tier-name {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		text-transform: none;
		color: var(--fg);
	}
	.tier-blurb {
		margin: 0;
		color: var(--fg-muted);
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.price {
		margin: 0.2rem 0 0;
		font-size: 1.8rem;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.4rem;
		font-size: 0.9rem;
		color: var(--fg-muted);
	}
	li {
		padding-left: 1.2rem;
		position: relative;
		line-height: 1.45;
	}
	li::before {
		content: '✓';
		position: absolute;
		left: 0;
		color: var(--yellow-deep);
		font-weight: 800;
	}
	.btn {
		margin-top: 0.5rem;
		padding: 0.7rem;
		text-align: center;
		text-decoration: none;
		border: 2.5px solid #14171c;
		border-radius: 10px;
		background: #14171c;
		color: #fff;
		font-weight: 800;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		box-shadow: 4px 4px 0 var(--yellow);
		transition:
			transform 0.06s ease,
			box-shadow 0.06s ease;
	}
	.btn:hover {
		transform: translate(-1px, -1px);
		box-shadow: 6px 6px 0 var(--yellow);
	}
	.btn:active {
		transform: translate(2px, 2px);
		box-shadow: none;
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
