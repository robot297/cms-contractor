<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { theme } from '$lib/theme.svelte';
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
	const onTemplates = $derived(path.startsWith('/contractor/settings/templates'));
	const onSupport = $derived(path.startsWith('/contractor/support'));

	const year = new Date().getFullYear();

	// Mobile nav: links + user/sign-out collapse behind a hamburger.
	let menuOpen = $state(false);
	// Close the menu whenever the route changes (a link was followed).
	$effect(() => {
		void path; // track route changes so the mobile menu closes on navigation
		menuOpen = false;
	});

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
			<a href={resolve('/')} class="brand">🛠 Contractor&nbsp;CRM</a>

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
					<a
						href={resolve('/contractor/settings/templates')}
						class="navlink"
						class:is-active={onTemplates}>Templates</a
					>
					<a href={resolve('/contractor/support')} class="navlink" class:is-active={onSupport}
						>Support</a
					>
				</div>
				<div class="nav-right">
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
		--bar-bg: var(--surface);
		--bar-line: var(--line);
		--bar-fg: var(--fg);
		--bar-fg-dim: rgba(31, 35, 40, 0.66);
		--bar-edge: rgba(17, 17, 17, 0.16);
		--bar-wash: rgba(17, 17, 17, 0.05);
		--bar-wash-strong: rgba(17, 17, 17, 0.1);
		--bar-rail-bg: linear-gradient(180deg, rgba(17, 17, 17, 0.06), rgba(17, 17, 17, 0.02));
		/* The inset top highlight only reads on a dark bar. */
		--bar-inset-hi: transparent;
		/* Pop-art wordmark, inverted per theme: ink on yellow in light, yellow on ink
		   in dark. Yellow type on a white bar would be unreadable. */
		--brand-fg: #14171c;
		--brand-shadow: 2px 2px 0 var(--yellow);
		--brand-fg-hover: #000000;
	}
	.bar {
		background: var(--bar-bg);
		border-block: 1px solid var(--bar-line);
	}
	.foot-text {
		font-size: 0.75rem;
		color: var(--bar-fg-dim);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	:global(:root[data-theme='dark']) .shell {
		--bar-fg: #ffffff;
		--bar-fg-dim: rgba(255, 255, 255, 0.72);
		--bar-edge: rgba(255, 255, 255, 0.14);
		--bar-wash: rgba(255, 255, 255, 0.06);
		--bar-wash-strong: rgba(255, 255, 255, 0.14);
		--bar-rail-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03));
		--bar-inset-hi: rgba(255, 255, 255, 0.07);
		--brand-fg: var(--yellow);
		--brand-shadow: 2px 2px 0 #000;
		--brand-fg-hover: #ffffff;
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
	.brand {
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--brand-fg);
		text-shadow: var(--brand-shadow);
		text-decoration: none;
		flex-shrink: 0;
	}
	.brand:hover {
		color: var(--brand-fg-hover);
	}
	/* Desktop: links sit next to the brand, user/sign-out pushed to the right. */
	.nav-collapse {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	/* The rail: one continuous track holding all six links, so the nav reads as a
	   single control instead of six separate outlined buttons. */
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

	.username {
		font-size: 0.8rem;
		color: var(--bar-fg);
		font-weight: 700;
	}
	.signout {
		padding: 0.32rem 0.8rem;
		border-radius: 999px;
		border: 1.5px solid #e5534b;
		background: #cf222e;
		color: #fff;
		cursor: pointer;
		font-weight: 800;
		text-transform: uppercase;
		font-size: 0.72rem;
		letter-spacing: 0.02em;
	}
	.signout:hover {
		background: #b3202a;
		border-color: #b3202a;
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
	@media (max-width: 1180px) {
		.username {
			display: none;
		}
	}

	/* Tablet + mobile: collapse behind the hamburger as an animated overlay. The
	   inline bar can't fit six links, so tablets get the menu too. */
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
		/* One compact line rather than a stack of full-width blocks: name on the left,
		   theme icon and sign-out on the right. */
		.nav-right {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: 0.5rem;
			margin-top: 0.35rem;
			padding-top: 0.7rem;
			border-top: 1px solid var(--bar-edge);
		}
		.username {
			padding: 0 0.2rem;
			margin-right: auto;
		}
		.theme-row {
			display: inline-flex;
		}
		.signout {
			text-transform: none;
			font-size: 0.85rem;
			border-radius: 999px;
			padding: 0.4rem 0.9rem;
		}
	}
</style>
