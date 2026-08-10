<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { theme } from '$lib/theme.svelte';
	import Toaster from '$lib/Toaster.svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Light / dark theme lives in a shared store, since the signed-out pages carry
	// their own toggle too. The nav keeps its own chrome for the button — it sits on
	// the dark bar, not on the page surface — but the state and persistence are shared.
	onMount(() => {
		theme.sync();
	});

	const path = $derived(page.url.pathname);
	const onDashboard = $derived(path === '/contractor');
	const onOrders = $derived(path.startsWith('/contractor/orders'));
	const onCustomers = $derived(path.startsWith('/contractor/customers'));
	const onSubcontractors = $derived(path.startsWith('/contractor/subcontractors'));
	// One entry now: email templates live on the account page rather than at their
	// own route, which still exists only to redirect.
	const onAccount = $derived(path.startsWith('/contractor/settings'));
	const onSupport = $derived(path.startsWith('/contractor/support'));
	const onBilling = $derived(path.startsWith('/contractor/billing'));

	// Billing chrome. The banner is the only signal a lapsed contractor gets in the
	// app itself — every page still loads and reads normally, by design, so without
	// this the refusal would only appear when they tried to save something.
	const billing = $derived(data.billing);
	const showLapsed = $derived(!billing.canWrite);
	// A refused write, surfaced once for the whole section. Individual pages gate
	// their error text on their own action names (`form?.action === 'create'` and
	// friends), so a billing refusal would otherwise render nowhere at all. Reading
	// it from page.form here means every action on every contractor page is covered,
	// including any added later.
	const blocked = $derived(
		page.form && typeof page.form === 'object' && 'blocked' in page.form
			? (page.form as { blocked?: boolean; message?: string })
			: null
	);

	// Trial state feeds the account menu's sub-line; the full detail (end date,
	// days left, capacity) lives on the settings page's Account tab. The old bar
	// badge is gone — its slot now holds the settings gear.
	const onTrial = $derived(billing.canWrite && billing.status === 'trialing');
	const trialDays = $derived(billing.trialDaysRemaining);

	const year = new Date().getFullYear();

	// Mobile nav: links + user/sign-out collapse behind a hamburger.
	let menuOpen = $state(false);
	// The account menu behind the avatar: billing and sign-out. The name and a red
	// SIGN OUT button sitting in the bar was the widest thing in it, and the first
	// to collide with the trial badge once the rail tightened up on a tablet.
	let userMenuOpen = $state(false);
	// Two letters at most — "Jo Bloggs" → JB, "testerooni" → T.
	const initials = $derived(
		(data.userName ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
	function closeMenus() {
		menuOpen = false;
		userMenuOpen = false;
	}
	// Close both menus whenever the route changes (a link was followed).
	$effect(() => {
		void path; // track route changes so the mobile menu closes on navigation
		closeMenus();
	});
	// …and on the click itself, because tapping the link for the page you're already
	// on is not a navigation: the effect above never re-runs, so the menu just sat
	// there looking broken.

	// The gliding rail indicator. Rather than six links each painting their own
	// active state, one pill slides to whichever link is current. Its position is
	// measured from the DOM so it tracks the real label widths (which shift with
	// the webfont and the viewport) instead of hardcoded geometry.
	let railEl = $state<HTMLElement | null>(null);
	let railX = $state(0);
	let railW = $state(0);
	// Until we've measured, `.ready` is off and CSS falls back to painting the
	// active link directly — so the nav is correct with JS disabled or still loading.
	let railReady = $state(false);

	function measureRail() {
		const active = railEl?.querySelector<HTMLElement>('.navlink.is-active');
		if (!active?.offsetWidth) {
			railReady = false;
			return;
		}
		railX = active.offsetLeft;
		railW = active.offsetWidth;
		railReady = true;
	}

	// Runs after Svelte flushes the DOM, so `.is-active` is already up to date.
	$effect(() => {
		void path;
		measureRail();
	});

	onMount(() => {
		// Label widths settle late: the webfont swaps in, and the bar reflows.
		document.fonts?.ready.then(measureRail);
		const ro = new ResizeObserver(measureRail);
		if (railEl) ro.observe(railEl);
		return () => ro.disconnect();
	});
</script>

<div class="shell" style="min-height: 100dvh; display: flex; flex-direction: column;">
	<div class="bar">
		<nav class="nav">
			<a href={resolve('/')} class="brand">
				<span class="brand-mark" aria-hidden="true">🛠</span>
				<span class="brand-word">Contractor&nbsp;CRM</span>
			</a>

			<button
				type="button"
				class="theme-toggle"
				title={theme.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
				aria-label={theme.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
				onclick={() => theme.toggle()}
			>
				{#if theme.current === 'dark'}
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="4.5" />
						<path
							d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
						/>
					</svg>
				{:else}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
					</svg>
				{/if}
			</button>

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
				<div class="nav-links" class:ready={railReady} bind:this={railEl}>
					<span class="rail-glide" style="--x: {railX}px; --w: {railW}px;" aria-hidden="true"
					></span>
					<a
						href={resolve('/contractor')}
						class="navlink"
						class:is-active={onDashboard}
						onclick={closeMenus}>Dashboard</a
					>
					<a
						href={resolve('/contractor/orders')}
						class="navlink"
						class:is-active={onOrders}
						onclick={closeMenus}>Orders</a
					>
					<a
						href={resolve('/contractor/customers')}
						class="navlink"
						class:is-active={onCustomers}
						onclick={closeMenus}>Customers</a
					>
					<a
						href={resolve('/contractor/subcontractors')}
						class="navlink"
						class:is-active={onSubcontractors}
						onclick={closeMenus}>Subcontractors</a
					>
					<a
						href={resolve('/contractor/support')}
						class="navlink"
						class:is-active={onSupport}
						onclick={closeMenus}>Support</a
					>
				</div>
				<div class="nav-right">
					<!-- Settings, in the slot the trial badge used to hold: it's admin,
					     not a work surface, so it sits with the account cluster. In the
					     collapsed menu the same control drops to the bottom-left of the
					     utility row (also the badge's old seat) and gains its label. -->
					<a
						class="settings-gear"
						class:on={onAccount}
						href={resolve('/contractor/settings')}
						title="Settings"
						aria-label="Settings"
						onclick={closeMenus}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="3.2" />
							<path
								d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
							/>
						</svg>
						<span class="gear-label">Settings</span>
					</a>
					<!-- Mobile/tablet home for the theme toggle: the bar's icon button is
					     hidden at this width. Icon-only, with the label carried by aria so it
					     costs a square instead of a row. Same shared store as the bar's. -->
					<button
						type="button"
						class="theme-row"
						title={theme.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
						aria-label={theme.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
						onclick={() => theme.toggle()}
					>
						{#if theme.current === 'dark'}
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<circle cx="12" cy="12" r="4.5" />
								<path
									d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
								/>
							</svg>
						{:else}
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
							</svg>
						{/if}
					</button>
					<!-- Account: avatar in the bar, everything else behind it. -->
					<div class="user">
						<button
							type="button"
							class="avatar"
							class:on={userMenuOpen}
							aria-haspopup="menu"
							aria-expanded={userMenuOpen}
							title={data.userName}
							aria-label="Account menu"
							onclick={() => (userMenuOpen = !userMenuOpen)}>{initials}</button
						>
						{#if userMenuOpen}
							<button
								type="button"
								class="user-scrim"
								aria-label="Close account menu"
								onclick={() => (userMenuOpen = false)}
							></button>
							<div class="user-menu" role="menu">
								<div class="user-menu-head">
									<span class="user-menu-name">{data.userName}</span>
									{#if onTrial && trialDays !== null}
										<span class="user-menu-sub"
											>Trial · {trialDays}
											{trialDays === 1 ? 'day' : 'days'} left</span
										>
									{/if}
								</div>
								<a
									class="user-menu-item"
									class:is-active={onAccount}
									role="menuitem"
									href={resolve('/contractor/settings')}
									onclick={closeMenus}>Account</a
								>
								<a
									class="user-menu-item"
									class:is-active={onBilling}
									role="menuitem"
									href={resolve('/contractor/billing')}
									onclick={closeMenus}>Billing</a
								>
								<form method="POST" action="/logout">
									<button type="submit" class="user-menu-item danger" role="menuitem"
										>Sign out</button
									>
								</form>
							</div>
						{/if}
					</div>
					<!-- The collapsed menu's sign-out. It has no avatar to hide things
					     behind, so this is a plain row alongside the links. -->
					<form method="POST" action="/logout" class="signout-form">
						<button type="submit" class="signout">Sign out</button>
					</form>
				</div>
			</div>
		</nav>
	</div>
	<div class="hazard"></div>

	{#if showLapsed}
		<div class="billing-banner lapsed" role="status">
			<span>
				<strong
					>{billing.reason === 'trial-ended'
						? 'Your free trial has ended.'
						: 'Your subscription has ended.'}</strong
				>
				Everything is still here and still readable — you just can't make changes until you subscribe.
			</span>
			<a class="banner-cta" href={resolve('/contractor/billing')}>Choose a plan</a>
		</div>
	{/if}

	{#if blocked?.blocked}
		<div class="billing-banner blocked" role="alert">
			<span>{blocked.message}</span>
			<a class="banner-cta" href={resolve('/contractor/billing')}>Choose a plan</a>
		</div>
	{/if}

	<main style="flex: 1;">
		{@render children()}
	</main>

	<!-- Mounted once for the whole section so a confirmation outlives the card that
	     raised it — the contact composer closes on send and the toast reports it. -->
	<Toaster />

	<footer>
		<div class="hazard"></div>
		<div class="bar">
			<div
				style="max-width: 860px; margin: 0 auto; padding: 1.25rem 1rem; display: flex; align-items: center; justify-content: center; gap: 1rem; flex-wrap: wrap;"
			>
				<!-- Class, not an inline colour: the footer text has to follow the bar. -->
				<span class="foot-text">© {year} · Built for those who do</span>
			</div>
		</div>
	</footer>
</div>

<style>
	/* The nav bar and footer bar. Every piece of chrome on them — the rail, the hover
	   washes, the glassy utility buttons, the mobile menu — was authored as white ink
	   on a black bar. These tokens carry that whole treatment so the bars can follow
	   the theme: ink-on-light in light, light-on-dark in dark. The yellow active pill
	   and the red sign-out are the exceptions; both already read on either bar. */
	.shell {
		/* Not flat white: a faint top-lit gradient so the bar reads as its own
		   surface — chrome, not just page background that happens to hold links. */
		--bar-bg: linear-gradient(180deg, #ffffff, #f6f6f1);
		--bar-line: var(--line);
		--bar-fg: var(--fg);
		--bar-fg-dim: rgba(31, 35, 40, 0.66);
		--bar-edge: rgba(17, 17, 17, 0.16);
		--bar-wash: rgba(17, 17, 17, 0.05);
		--bar-wash-strong: rgba(17, 17, 17, 0.1);
		--bar-rail-bg: linear-gradient(180deg, rgba(17, 17, 17, 0.06), rgba(17, 17, 17, 0.02));
		/* The inset top highlight only reads on a dark bar. */
		--bar-inset-hi: transparent;
	}
	.bar {
		background: var(--bar-bg);
		border-block: 1px solid var(--bar-line);
	}
	/* Header only (the footer's bar is nested in <footer>): a soft cast below the
	   bar + accent line so the chrome sits above the page instead of on it. */
	.shell > .bar {
		box-shadow: 0 4px 16px rgba(27, 31, 36, 0.06);
	}
	.foot-text {
		font-size: 0.75rem;
		color: var(--bar-fg-dim);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	:global(:root[data-theme='dark']) .shell {
		--bar-bg: linear-gradient(180deg, #20252d, #181c22);
		--bar-fg: #ffffff;
		--bar-fg-dim: rgba(255, 255, 255, 0.72);
		--bar-edge: rgba(255, 255, 255, 0.14);
		--bar-wash: rgba(255, 255, 255, 0.06);
		--bar-wash-strong: rgba(255, 255, 255, 0.14);
		--bar-rail-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03));
		--bar-inset-hi: rgba(255, 255, 255, 0.07);
	}
	:global(:root[data-theme='dark']) .shell > .bar {
		box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
	}

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
	/* Wordmark: a small yellow tile carrying the glyph, plain strong type beside
	   it. Replaces the hard yellow text-shadow treatment, which read as clip-art.
	   Colors ride --bar-fg, so both themes come out right with no brand tokens. */
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		color: var(--bar-fg);
		text-decoration: none;
		flex-shrink: 0;
	}
	.brand-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 10px;
		background: linear-gradient(180deg, var(--yellow), var(--yellow-deep));
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.5),
			0 2px 8px rgba(230, 184, 0, 0.35);
		font-size: 1.05rem;
		transition: filter 0.15s ease;
	}
	.brand-word {
		font-weight: 900;
		font-size: 0.92rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.brand:hover .brand-mark {
		filter: brightness(1.06);
	}
	/* Desktop: links sit next to the brand, user/sign-out pushed to the right. */
	.nav-collapse {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	/* The rail: one continuous track holding every link, so the nav reads as a
	   single control instead of a row of separate outlined buttons. */
	.nav-links {
		position: relative;
		display: flex;
		gap: 0.15rem;
		/* No wrapping — the glide pill only travels horizontally, and below 1025px
		   the whole rail collapses into the hamburger overlay anyway. */
		flex-wrap: nowrap;
		padding: 0.25rem;
		border-radius: 999px;
		border: 1px solid var(--bar-edge);
		background: var(--bar-rail-bg);
		box-shadow: inset 0 1px 0 var(--bar-inset-hi);
	}
	.nav-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	/* The pill that glides between links. Kept out of the layout (absolute) so it
	   can tween freely, and behind the labels (z-index) so type stays crisp.
	   Only shown once measured — see the `:not(.ready)` fallback below. */
	.rail-glide {
		display: none;
	}
	.nav-links.ready .rail-glide {
		display: block;
		position: absolute;
		top: 0.25rem;
		bottom: 0.25rem;
		left: 0;
		width: var(--w);
		transform: translateX(var(--x));
		border-radius: 999px;
		background: linear-gradient(180deg, var(--yellow), var(--yellow-deep));
		box-shadow:
			0 2px 12px rgba(255, 204, 0, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.5);
		overflow: hidden;
		pointer-events: none;
		/* Decelerating ease — the pill arrives rather than snaps. */
		transition:
			transform 0.42s cubic-bezier(0.22, 1, 0.36, 1),
			width 0.42s cubic-bezier(0.22, 1, 0.36, 1);
	}
	/* The shimmer: a highlight drifts across the pill, then rests. The long tail on
	   the keyframe is the pause — it sweeps in the first ~45%, waits out the rest. */
	.nav-links.ready .rail-glide::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			100deg,
			transparent 35%,
			rgba(255, 255, 255, 0.75) 50%,
			transparent 65%
		);
		transform: translateX(-100%);
		animation: rail-shimmer 3.6s ease-in-out 1s infinite;
	}
	@keyframes rail-shimmer {
		0% {
			transform: translateX(-100%);
		}
		45%,
		100% {
			transform: translateX(100%);
		}
	}

	.navlink {
		position: relative;
		z-index: 1; /* above the glide pill */
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		text-decoration: none;
		font-size: 0.85rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		white-space: nowrap;
		color: var(--bar-fg-dim);
		transition:
			color 0.2s ease,
			background 0.2s ease;
	}
	.navlink:hover {
		color: var(--bar-fg);
		background: var(--bar-wash-strong);
	}
	/* Dark type once the yellow pill is underneath. Pinned, not var(--ink): yellow
	   stays light in both themes, so its label must always be dark. */
	.navlink.is-active,
	.navlink.is-active:hover {
		color: #14171c;
		background: transparent;
	}
	/* No-JS / pre-measure fallback: without the pill, the active link paints its own. */
	.nav-links:not(.ready) .navlink.is-active {
		background: var(--yellow);
	}
	.navlink:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-links.ready .rail-glide {
			transition: none;
		}
		.nav-links.ready .rail-glide::after {
			animation: none;
			opacity: 0;
		}
	}

	/* The settings gear. Same quiet icon-only chrome as the theme toggle, except
	   when you're on the settings section: then it takes the yellow active pill so
	   the bar still answers "where am I" with the rail link gone. The label only
	   appears in the collapsed menu (see the 1024px block). */
	.settings-gear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		width: 2.4rem;
		height: 2.4rem;
		flex-shrink: 0;
		border-radius: 999px;
		color: var(--bar-fg-dim);
		text-decoration: none;
		transition:
			color 0.16s ease,
			background 0.16s ease;
	}
	.gear-label {
		display: none;
		font-size: 0.9rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.settings-gear:hover {
		color: var(--bar-fg);
		background: var(--bar-wash-strong);
	}
	/* Pinned dark on yellow, like every active pill. */
	.settings-gear.on,
	.settings-gear.on:hover {
		background: var(--yellow);
		color: #14171c;
	}
	.settings-gear:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}
	.settings-gear svg {
		display: block;
		flex: none;
	}

	/* Account. One square in the bar; the name, billing and sign-out all live in the
	   menu behind it, which is what buys the trial badge its room back. */
	.user {
		position: relative;
		flex: none;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border-radius: 999px;
		border: 1.5px solid var(--bar-edge);
		background: var(--bar-wash);
		color: var(--bar-fg);
		font-family: inherit;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.02em;
		line-height: 1;
		cursor: pointer;
	}
	.avatar:hover,
	.avatar.on {
		background: var(--yellow);
		border-color: var(--yellow);
		color: #14171c;
	}
	.avatar:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}
	.user-scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		border: none;
		background: transparent;
		cursor: default;
	}
	.user-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		z-index: 100;
		box-sizing: border-box;
		min-width: 13rem;
		max-width: calc(100vw - 2rem);
		padding: 0.35rem;
		display: grid;
		gap: 0.1rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
	}
	.user-menu-head {
		display: grid;
		gap: 0.1rem;
		padding: 0.45rem 0.6rem 0.55rem;
		margin-bottom: 0.15rem;
		border-bottom: 1px solid var(--line);
	}
	.user-menu-name {
		font-size: 0.88rem;
		font-weight: 800;
		color: var(--fg);
		overflow-wrap: anywhere;
	}
	.user-menu-sub {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--fg-muted);
	}
	.user-menu-item {
		display: block;
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.6rem;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--fg);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.user-menu-item:hover {
		background: var(--surface-sunken);
	}
	.user-menu-item.is-active {
		color: var(--fg);
		background: color-mix(in srgb, var(--yellow) 22%, var(--surface));
	}
	.user-menu-item.danger {
		color: var(--danger);
	}
	.user-menu-item:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: -2px;
	}
	/* Collapsed-menu-only pieces. Hidden on the bar, where the account menu behind
	   the avatar covers the same ground. Turned on in the 1024px block below. */
	.signout-form {
		display: none;
	}
	.signout {
		padding: 0.55rem 0.9rem;
		border-radius: 10px;
		border: 1.5px solid var(--danger);
		background: none;
		color: var(--danger);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 700;
		cursor: pointer;
	}
	.signout:hover {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
	}

	/* The theme toggle inside the collapsed menu. Icon-only square, not a full-width
	   row — the label lives in aria-label/title. Hidden until the bar collapses (see
	   the max-width: 1024px block). */
	.theme-row {
		display: none;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--bar-fg-dim);
		cursor: pointer;
		transition: color 0.16s ease;
	}
	.theme-row:hover {
		color: var(--bar-fg);
	}
	.theme-row:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}
	.theme-row svg {
		display: block;
		flex: none;
	}

	/* Nav utility buttons (theme toggle + hamburger) share a soft, tactile chrome:
	   a faint glassy fill, hairline border, and a lift-on-hover with a warm glow. */
	/* The hamburger keeps its tactile chrome — it's the control that opens a whole
	   menu, so it should look pressable. */
	.hamburger {
		display: none;
		align-items: center;
		justify-content: center;
		width: 2.6rem;
		height: 2.6rem;
		padding: 0;
		flex-shrink: 0;
		border: 1.5px solid var(--bar-edge);
		background: var(--bar-rail-bg);
		color: var(--bar-fg);
		border-radius: 12px;
		cursor: pointer;
		box-shadow: inset 0 1px 0 var(--bar-inset-hi);
		transition:
			background 0.16s ease,
			border-color 0.16s ease,
			transform 0.12s ease,
			box-shadow 0.16s ease;
	}
	.hamburger:hover {
		background: var(--bar-wash-strong);
		border-color: rgba(255, 204, 0, 0.75);
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
	}
	.hamburger:active {
		transform: translateY(0) scale(0.95);
		box-shadow: inset 0 1px 0 var(--bar-inset-hi);
	}

	/* The theme toggle is just its icon — no fill, no border, no shadow. It keeps a
	   full-size hit area so it stays easy to tap, and only the icon colour responds.
	   (It and the hamburger are never on screen together: the bar's toggle is hidden
	   at the width where the hamburger appears.) */
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		flex-shrink: 0;
		border: none;
		background: none;
		box-shadow: none;
		border-radius: 8px;
		color: var(--bar-fg-dim);
		cursor: pointer;
		transition: color 0.16s ease;
	}
	.theme-toggle:hover {
		color: var(--bar-fg);
	}
	.theme-toggle:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}
	.hamburger svg,
	.theme-toggle svg {
		display: block;
	}

	/* Hide the signed-in name below wide desktop — it only crowds the bar and the
	   overlay doesn't need it. */

	/* Tablet + mobile: collapse behind the hamburger as an animated overlay. The
	   inline bar can't fit the full link set, so tablets get the menu too. */
	@media (max-width: 1024px) {
		.hamburger {
			display: inline-flex;
		}
		/* The bar's toggle moves into the menu at this width (see .theme-row), so the
		   hamburger takes over pushing itself to the right edge. */
		.theme-toggle {
			display: none;
		}
		.hamburger {
			margin-left: auto;
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
			background: var(--bar-bg);
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
		/* Stacked overlay: the rail chrome and its gliding pill are a horizontal
		   idea, so both are dropped here in favour of plain full-width rows. */
		.nav-links {
			flex-direction: column;
			gap: 0.4rem;
			padding: 0;
			border: none;
			background: none;
			box-shadow: none;
		}
		.rail-glide,
		.nav-links.ready .rail-glide {
			display: none;
		}
		.navlink {
			text-transform: none;
			letter-spacing: 0;
			font-size: 0.95rem;
			font-weight: 700;
			border-radius: 10px;
			background: var(--bar-wash);
			color: var(--bar-fg);
			padding: 0.7rem 0.9rem;
		}
		.navlink.is-active,
		.navlink.is-active:hover {
			background: var(--yellow);
			color: #14171c;
			box-shadow: none;
		}
		/* Sign-out becomes a row of its own — the avatar and its popover are dropped
		   entirely here. A menu that opens a second menu is a poor trade on a screen
		   this size. */
		.signout-form {
			display: block;
			margin-top: 0.15rem;
		}
		.signout {
			width: 100%;
			box-sizing: border-box;
		}
		.user {
			display: none;
		}
		/* One compact line rather than a stack of full-width blocks: Settings on the
		   left (the trial badge's old seat), theme icon on the right. */
		.nav-right {
			flex-direction: row;
			align-items: center;
			justify-content: flex-end;
			gap: 0.5rem;
			margin-top: 0.35rem;
			padding-top: 0.7rem;
			border-top: 1px solid var(--bar-edge);
		}
		/* The gear leads the row and gains its label — an icon-only square tucked in
		   a corner is too easy to read as decoration. */
		.settings-gear {
			order: -1;
			margin-right: auto;
			width: auto;
			height: auto;
			padding: 0.45rem 0.8rem;
			background: var(--bar-wash);
			color: var(--bar-fg);
		}
		.gear-label {
			display: inline;
		}
		.theme-row {
			display: inline-flex;
		}
	}

	/* Billing banner. Sits directly under the nav so it is the first thing on every
	   contractor page — a lapsed contractor's pages otherwise look completely normal,
	   because reading is deliberately unaffected. */
	.billing-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem 1rem;
		flex-wrap: wrap;
		padding: 0.7rem 1rem;
		font-size: 0.88rem;
		line-height: 1.45;
		border-bottom: 1px solid var(--line);
	}
	/* A write that was just refused — same treatment as the lapsed banner, but it
	   appears in response to an action rather than on every page. */
	.billing-banner.blocked {
		background: color-mix(in srgb, var(--danger) 16%, var(--surface));
		color: var(--fg);
		border-bottom-color: var(--danger);
		font-weight: 600;
	}
	.billing-banner.lapsed {
		background: color-mix(in srgb, var(--danger) 12%, var(--surface));
		color: var(--fg);
		border-bottom-color: var(--danger);
	}
	.banner-cta {
		flex-shrink: 0;
		padding: 0.35rem 0.85rem;
		border-radius: 999px;
		background: #14171c;
		color: #fff;
		text-decoration: none;
		font-weight: 800;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.banner-cta:hover {
		background: #000;
	}
	/* Scoped to .banner-cta specifically — a bare `[data-theme='dark'] a` here would
	   outrank more specific link rules elsewhere in this file. */
	:global(:root[data-theme='dark']) .banner-cta {
		background: var(--fg);
		color: #14171c;
	}
	:global(:root[data-theme='dark']) .banner-cta:hover {
		background: #fff;
	}
</style>
