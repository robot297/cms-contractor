<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const path = $derived(page.url.pathname);
	const onDashboard = $derived(path === '/contractor');
	const onOrders = $derived(path.startsWith('/contractor/orders'));
	const onCustomers = $derived(path.startsWith('/contractor/customers'));
	const onSubcontractors = $derived(path.startsWith('/contractor/subcontractors'));
	const onSupport = $derived(path.startsWith('/contractor/support'));

	const year = new Date().getFullYear();

	// Mobile nav: links + user/sign-out collapse behind a hamburger.
	let menuOpen = $state(false);
	// Close the menu whenever the route changes (a link was followed).
	$effect(() => {
		path;
		menuOpen = false;
	});
</script>

<div style="min-height: 100dvh; display: flex; flex-direction: column;">
	<div style="background: #111;">
		<nav class="nav">
			<span class="brand">🛠 Contractor&nbsp;CRM</span>

			<button
				type="button"
				class="hamburger"
				aria-label={menuOpen ? 'Close menu' : 'Open menu'}
				aria-expanded={menuOpen}
				onclick={() => (menuOpen = !menuOpen)}
			>
				{#if menuOpen}
					<svg
						width="22"
						height="22"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.4"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<line x1="6" y1="6" x2="18" y2="18" />
						<line x1="18" y1="6" x2="6" y2="18" />
					</svg>
				{:else}
					<svg
						width="22"
						height="22"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.4"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<line x1="4" y1="7" x2="20" y2="7" />
						<line x1="4" y1="12" x2="20" y2="12" />
						<line x1="4" y1="17" x2="20" y2="17" />
					</svg>
				{/if}
			</button>

			<div class="nav-collapse" class:open={menuOpen}>
				<div class="nav-links">
					<a href={resolve('/contractor')} class="navlink" class:is-active={onDashboard}
						>Dashboard</a
					>
					<a href={resolve('/contractor/orders')} class="navlink" class:is-active={onOrders}
						>Orders</a
					>
					<a href={resolve('/contractor/customers')} class="navlink" class:is-active={onCustomers}
						>Customers</a
					>
					<a
						href={resolve('/contractor/subcontractors')}
						class="navlink"
						class:is-active={onSubcontractors}>Subcontractors</a
					>
					<a href={resolve('/contractor/support')} class="navlink" class:is-active={onSupport}
						>Support</a
					>
				</div>
				<div class="nav-right">
					<span class="username">{data.userName}</span>
					<form method="POST" action="/logout">
						<button type="submit" class="signout">Sign out</button>
					</form>
				</div>
			</div>
		</nav>
	</div>
	<div class="hazard"></div>

	<main style="flex: 1;">
		{@render children()}
	</main>

	<footer>
		<div class="hazard"></div>
		<div style="background: #111;">
			<div
				style="max-width: 860px; margin: 0 auto; padding: 1.25rem 1rem; display: flex; align-items: center; justify-content: center; gap: 1rem; flex-wrap: wrap;"
			>
				<span
					style="font-size: 0.75rem; color: #fff; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;"
					>© {year} · Built for those who do</span
				>
			</div>
		</div>
	</footer>
</div>

<style>
	.nav {
		position: relative;
		/* Full-width bar: brand hugs the left, user/sign-out the right, so the
		   whole desktop width is used instead of a centered 860px column. The
		   <nav> already fills its parent, so no explicit width — and border-box
		   keeps the side padding inside the bar instead of overflowing it. */
		box-sizing: border-box;
		padding: 0.7rem 1.5rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.brand {
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: #ffcc00;
		text-shadow: 2px 2px 0 #000;
		flex-shrink: 0;
	}
	/* Desktop: links sit next to the brand, user/sign-out pushed to the right. */
	.nav-collapse {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.nav-links {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.nav-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.navlink {
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		text-decoration: none;
		font-size: 0.85rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		border: 2px solid #fff;
		background: transparent;
		color: #fff;
	}
	.navlink.is-active {
		background: #ffcc00;
		color: #111;
		border-color: #111;
		box-shadow: 2px 2px 0 #fff;
	}

	.username {
		font-size: 0.8rem;
		color: #fff;
		font-weight: 700;
	}
	.signout {
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		border: 2px solid #fff;
		background: transparent;
		color: #fff;
		cursor: pointer;
		font-weight: 800;
		text-transform: uppercase;
		font-size: 0.8rem;
	}

	.hamburger {
		display: none;
		margin-left: auto;
		width: 2.6rem;
		height: 2.6rem;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 2px solid #fff;
		background: transparent;
		color: #fff;
		border-radius: 10px;
		cursor: pointer;
	}
	.hamburger svg {
		display: block;
	}

	/* Tablet + mobile: collapse behind the hamburger as an animated overlay. */
	@media (max-width: 820px) {
		.hamburger {
			display: inline-flex;
		}
		/* Overlay panel: absolutely positioned so it floats over the page
		   content instead of pushing it down, and tweens on open/close. */
		.nav-collapse {
			position: absolute;
			top: 100%;
			left: 0;
			right: 0;
			z-index: 50;
			flex-direction: column;
			align-items: stretch;
			gap: 0.4rem;
			padding: 0.75rem 1rem 1rem;
			background: #111;
			box-shadow: 0 14px 28px rgba(0, 0, 0, 0.4);
			opacity: 0;
			visibility: hidden;
			transform: translateY(-10px);
			transition:
				opacity 0.18s ease,
				transform 0.18s ease,
				visibility 0s linear 0.18s;
		}
		.nav-collapse.open {
			opacity: 1;
			visibility: visible;
			transform: translateY(0);
			transition:
				opacity 0.18s ease,
				transform 0.18s ease,
				visibility 0s;
		}
		.nav-links {
			flex-direction: column;
			gap: 0.4rem;
		}
		.navlink {
			text-transform: none;
			letter-spacing: 0;
			font-size: 0.95rem;
			font-weight: 700;
			border-radius: 10px;
			border-color: transparent;
			background: rgba(255, 255, 255, 0.06);
			padding: 0.7rem 0.9rem;
		}
		.navlink.is-active {
			background: #ffcc00;
			color: #111;
			border-color: #111;
			box-shadow: none;
		}
		.nav-right {
			flex-direction: column;
			align-items: stretch;
			gap: 0.5rem;
			margin-top: 0.35rem;
			padding-top: 0.7rem;
			border-top: 1px solid #2a2a2a;
		}
		.username {
			padding: 0 0.2rem;
		}
		.signout {
			width: 100%;
			text-transform: none;
			font-size: 0.95rem;
			border-radius: 10px;
			padding: 0.7rem 0.9rem;
		}
	}
</style>
