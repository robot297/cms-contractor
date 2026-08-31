<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { theme, THEME_LABELS, nextThemeLabel } from '$lib/theme.svelte';
	import ThemeModeIcon from '$lib/ThemeModeIcon.svelte';
	import Toaster from '$lib/Toaster.svelte';
	import DevSwitcher from '$lib/DevSwitcher.svelte';
	import AccountMenu from '$lib/AccountMenu.svelte';
	import PaletteSwitcher from '$lib/PaletteSwitcher.svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Light / dark theme lives in a shared store, since the signed-out pages carry
	// their own toggle too. The nav keeps its own chrome for the button — it sits on
	// the dark bar, not on the page surface — but the state and persistence are shared.
	onMount(() => {
		theme.sync();
	});

	// Both copies of the theme control — the bar's and the collapsed menu's — say
	// the same thing, so they say it from one place. With three modes the name has
	// to carry where you ARE as well as what pressing does: the icon can show the
	// current mode but there is no glyph for "the next one".
	const themeLabel = $derived(
		`Theme: ${THEME_LABELS[theme.choice]}. Switch to ${nextThemeLabel(theme.choice)}.`
	);

	const path = $derived(page.url.pathname);
	const onDashboard = $derived(path === '/contractor');
	const onOrders = $derived(path.startsWith('/contractor/orders'));
	// ONE entry for everyone the contractor knows — the people they work for and
	// the people they work with. It was two (Customers, People), which meant
	// deciding what somebody was to you before you could look them up, and made a
	// person who is both — the customer whose deck you rebuilt and who now swings a
	// hammer for you on Tuesdays — into two records you had to remember to keep in
	// step. The subcontractor page is still a real destination for tier, insurance
	// and invites, so it lights this link too.
	const onPeople = $derived(
		path.startsWith('/contractor/people') ||
			// The two routes the directory absorbed. Both still exist as 308s to it —
			// each was in the nav long enough to be bookmarked.
			path.startsWith('/contractor/crew') ||
			path.startsWith('/contractor/customers') ||
			path.startsWith('/contractor/subcontractors')
	);
	// One entry now: email templates AND support live on the settings page as
	// tabs rather than at routes of their own. Both old paths still exist only to
	// redirect, and both light the gear — landing on one and seeing nothing
	// selected would read as having navigated nowhere.
	const onAccount = $derived(
		path.startsWith('/contractor/settings') || path.startsWith('/contractor/support')
	);
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

	// Where the links live below the desktop breakpoint. `top` keeps them behind
	// the hamburger, the shape this app has always had; `bottom` moves them to a
	// fixed tab bar, the shape the customer portal uses — a shorter reach one-handed,
	// which is how a contractor holds a phone on a site. The contractor picks it on
	// the settings page; above 1024px the bar's rail navigates either way, so the
	// choice only ever changes the narrow widths.
	const bottomNav = $derived(data.navPlacement === 'bottom');
	/** The same five destinations the rail carries, as phone tabs. */
	const TABS = $derived([
		{
			href: resolve('/contractor'),
			// The same word the rail uses. A tab bar tempts you to shorten it to "Home",
			// which then names a destination nothing else in the app calls that.
			label: 'Dashboard',
			icon: '🏠',
			active: onDashboard,
			count: 0
		},
		{
			href: resolve('/contractor/orders'),
			label: 'Orders',
			icon: '🧾',
			active: onOrders,
			count: data.awaitingReply
		},
		{
			href: resolve('/contractor/people'),
			label: 'People',
			icon: '👥',
			active: onPeople,
			count: 0
		},
		// Only reachable from down here in this mode: the bar's gear, the palette and
		// the light/dark toggle all live behind the hamburger, and the hamburger is
		// reduced to sign-out when the tabs are carrying navigation. Settings is
		// where the theme controls moved to, so it has to be a tab rather than a row
		// in a menu that no longer opens.
		{
			href: resolve('/contractor/settings'),
			label: 'Settings',
			icon: '⚙️',
			active: onAccount || onBilling,
			count: 0
		}
	]);

	const year = new Date().getFullYear();

	// Mobile nav: links + sign-out collapse behind a hamburger. The avatar's own
	// menu is `AccountMenu`'s business — it opens, closes and closes-on-navigate
	// by itself, and the portal bar gets the identical control for free.
	let menuOpen = $state(false);
	function closeMenus() {
		menuOpen = false;
	}
	// Close the mobile menu whenever the route changes (a link was followed).
	$effect(() => {
		void path; // track route changes so the mobile menu closes on navigation
		closeMenus();
	});

	/** What sits behind the avatar. Account and billing, in that order. */
	const accountItems = $derived([
		{ label: 'Account', href: resolve('/contractor/settings'), active: onAccount },
		{ label: 'Billing', href: resolve('/contractor/billing'), active: onBilling }
	]);
	/** The trial countdown, as the menu's second line. Absent on a paid plan. */
	const accountSubline = $derived(
		onTrial && trialDays !== null
			? `Trial · ${trialDays} ${trialDays === 1 ? 'day' : 'days'} left`
			: undefined
	);
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

<div
	class="shell"
	class:nav-bottom={bottomNav}
	style="min-height: 100dvh; display: flex; flex-direction: column;"
>
	<div class="bar">
		<nav class="nav">
			<a href={resolve('/')} class="brand">
				<span class="brand-word">Contractor&nbsp;CRM</span>
			</a>

			<!-- The view switcher, on the bar at every width, and in the same seat the
			     customer portal keeps it in — the whole point of the control is
			     hopping between the two sides, and a button that moves when you use
			     it makes you hunt for the way back.

			     One instance, placed by flex `order` rather than by DOM position: it
			     sits at the end of the bar on a desktop and immediately left of the
			     hamburger on a phone, which is the same corner in both cases. -->
			{#if data.viewAsEnabled && (data.viewAsCustomer || data.devSignInEnabled)}
				<div class="switch-slot">
					<DevSwitcher
						side="contractor"
						devCustomer={data.viewAsCustomer}
						canSignInAs={data.devSignInEnabled}
						orderId={page.params.id ?? null}
					/>
				</div>
			{/if}

			<!-- With the tabs at the foot of the screen there is no menu left to open:
			     the five destinations are down there, the theme and the palette moved
			     onto the settings page, and the account rows ARE the settings page. What
			     was behind the hamburger is one thing — the way out — so it is that
			     button, not a menu holding it. Rendered at every width and shown by CSS
			     only where the bottom bar is, since above 1024px the bar's own rail is
			     back and the collapsed menu with it. -->
			<form method="POST" action="/logout" class="bar-signout-form">
				<button type="submit" class="bar-icon bar-signout" title="Sign out" aria-label="Sign out">
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
						<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
						<path d="M16 17l5-5-5-5M21 12H9" />
					</svg>
				</button>
			</form>

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

			<!-- Click-away for the mobile menu. The account menu has had one of these
			     since it was built; the hamburger overlay never did, so the only way out
			     of it was the X — tapping the page behind it did nothing, which reads as
			     a stuck menu rather than as a deliberate modal. Rendered only while
			     open, and only a scrim on the widths where the menu is an overlay. -->
			{#if menuOpen}
				<button
					type="button"
					class="nav-scrim"
					aria-label="Close menu"
					onclick={() => (menuOpen = false)}
				></button>
			{/if}

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
						onclick={closeMenus}
						>Orders{#if data.awaitingReply > 0}<span
								class="count-badge nav-badge"
								aria-label="{data.awaitingReply} awaiting a reply">{data.awaitingReply}</span
							>{/if}</a
					>
					<a
						href={resolve('/contractor/people')}
						class="navlink"
						class:is-active={onPeople}
						onclick={closeMenus}>People</a
					>
				</div>
				<div class="nav-right">
					<!-- TEMPORARY: pick a palette, then delete this and the losers.
					     Sits next to the light/dark toggle because each palette has to be
					     judged in both themes, so switching has to be two clicks. -->
					<span class="palette-slot"><PaletteSwitcher /></span>
					<!-- Light/dark. Lives with the account cluster on the right rather than
					     beside the brand: it is a preference, and a preference sitting in
					     the first position on the bar reads as navigation. Hidden below the
					     desktop breakpoint, where `.theme-row` in the collapsed menu is the
					     control instead. -->
					<button
						type="button"
						class="bar-icon theme-toggle"
						title={themeLabel}
						aria-label={themeLabel}
						onclick={() => theme.cycle()}
					>
						<ThemeModeIcon />
					</button>
					<!-- Settings, in the slot the trial badge used to hold: it's admin,
					     not a work surface, so it sits with the account cluster. In the
					     collapsed menu the same control drops to the bottom-left of the
					     utility row (also the badge's old seat) and gains its label. -->
					<a
						class="bar-icon settings-gear"
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
						title={themeLabel}
						aria-label={themeLabel}
						onclick={() => theme.cycle()}
					>
						<ThemeModeIcon size={18} />
					</button>
					<!-- Account: avatar in the bar, everything else behind it. Shared with
					     the customer portal's bar, which had none of this. -->
					<div class="account-slot">
						<AccountMenu
							name={data.userName}
							subline={accountSubline}
							items={accountItems}
							onnavigate={closeMenus}
						/>
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

	<!-- The phone's primary navigation when the contractor asked for it there. Same
	     links as the bar's rail, fixed to the foot of the screen; hidden above the
	     width where the rail itself is on screen. The bar keeps the hamburger, which
	     at this width holds only the account and the utilities. -->
	{#if bottomNav}
		<nav class="bottombar" aria-label="Sections">
			{#each TABS as t (t.href)}
				<a
					href={t.href}
					class="btab"
					class:on={t.active}
					aria-current={t.active ? 'page' : undefined}
					onclick={closeMenus}
				>
					<span class="bicon" aria-hidden="true">{t.icon}</span>
					<span class="blabel">{t.label}</span>
					{#if t.count > 0}
						<span class="bbadge" aria-label="{t.count} awaiting a reply">{t.count}</span>
					{/if}
				</a>
			{/each}
		</nav>
	{/if}

	<footer>
		<div class="hazard"></div>
		<div class="bar">
			<!-- Tracks the same column as the pages above it, so the footer text stays
			     centred under the content rather than under a column the content
			     stopped using. -->
			<div class="foot-inner">
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
		/* Which half of the product this is, as one token. The shared AccountMenu
		   reads these rather than `--brand` directly, so the same component wears
		   safety yellow here and the portal's teal there.

		   Never a token that flips in dark mode for the foreground: yellow is light
		   in BOTH themes, so text on it is always dark. See the --on-brand note at
		   the top of app.css. */
		--bar-accent: var(--brand);
		--bar-accent-fg: var(--on-brand);
		/* Not flat white: a faint top-lit gradient so the bar reads as its own
		   surface — chrome, not just page background that happens to hold links. */
		/* The bar is its own surface, one step off the page rather than a literal.
		   Mixed from palette tokens so the chrome moves with the accent instead of
		   staying a warm grey under a blue app. */
		--bar-bg: linear-gradient(180deg, var(--surface), var(--surface-sunken));
		--bar-line: var(--line);
		--bar-fg: var(--fg);
		--bar-fg-dim: var(--fg-muted);
		--bar-edge: var(--line-strong);
		--bar-wash: var(--surface-sunken);
		--bar-wash-strong: color-mix(in srgb, var(--brand) 14%, var(--surface));
		--bar-rail-bg: var(--surface-sunken);
		/* The inset top highlight only reads on a dark bar. */
		--bar-inset-hi: transparent;
	}
	/* Surface, padding, wordmark and the utility squares come from the shared
	   `.bar` / `.nav` / `.brand-word` / `.bar-icon` block in app.css — both halves
	   of the product wear one bar. Only the edge is local: this bar is bounded top
	   and bottom because the accent rule sits directly under it. */
	.bar {
		border-block: 1px solid var(--bar-line);
	}
	/* Header only (the footer's bar is nested in <footer>): a soft cast below the
	   bar + accent line so the chrome sits above the page instead of on it. */
	.shell > .bar {
		box-shadow: 0 4px 16px rgba(27, 31, 36, 0.06);
	}
	.shell {
		/*
		 * How tall the fixed tab bar is, as ONE number.
		 *
		 * It used to be written twice — `min-height: 3.1rem` on the tab plus the
		 * bar's own padding here, and a hand-totalled `3.5rem` reserved at the foot
		 * of the page there — and the two had drifted: the bar measures 66.5px and
		 * the page was holding 56px open for it, so the last 10px of the footer sat
		 * UNDER the bar. The bar takes its height from this and the page reserves
		 * the same value, which is what stops the two from disagreeing again.
		 */
		--bottombar-h: 4.25rem;
	}
	.foot-inner {
		box-sizing: border-box;
		max-width: var(--page-max);
		margin: 0 auto;
		padding: 1.25rem var(--page-gutter);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.foot-text {
		font-size: 0.75rem;
		color: var(--bar-fg-dim);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	:global(:root[data-theme='dark']) .shell {
		--bar-bg: linear-gradient(180deg, var(--surface-sunken), var(--surface));
		--bar-fg: var(--fg);
		--bar-fg-dim: var(--fg-muted);
		--bar-edge: var(--line-strong);
		--bar-wash: var(--surface-sunken);
		--bar-wash-strong: color-mix(in srgb, var(--brand) 18%, var(--surface));
		--bar-rail-bg: var(--surface-inset);
		--bar-inset-hi: transparent;
	}
	:global(:root[data-theme='dark']) .shell > .bar {
		box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
	}

	/* Full-width bar: brand hugs the left, the account cluster the right, so the
	   whole desktop width is used instead of a centered column. Wrapping is local
	   — this bar carries six nav links and has to fold on a narrow tablet, where
	   the portal's bar has nothing to wrap. */
	.nav {
		flex-wrap: wrap;
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
		/* CONCENTRIC with the glide pill inside it, not a hard 999px.

		   The track used to be a full lozenge while the pill riding in it followed
		   `--radius-pill` — 3px on Voltage, 0 on Halogen and Blueprint. A near-square
		   selection inside a fully-rounded track is the mismatch, and the fix is not
		   to force the pill round: that would drop the theme's geometry, which is
		   the whole point of the `--radius-*` ladder. So the TRACK gives up its
		   radius instead and follows the pill, offset by the padding that separates
		   them — which is what keeps the two curves parallel at every theme. */
		border-radius: calc(var(--radius-pill) + 0.25rem);
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
		/* The pill follows the theme's geometry: a lozenge on Vapor and Abyss, a
		   hard rectangle on Halogen and Blueprint. */
		border-radius: var(--radius-pill);
		background: var(--brand-sweep);
		/* Decorative and empty — the label lives in the sibling `.navlink`, which
		   sits above it. Declared anyway so the fill and a foreground can never be
		   separated, which is the invariant theme.contrast.test.ts enforces. */
		color: var(--on-brand);
		box-shadow:
			0 0 0 1px var(--brand-glow-strong),
			0 0 18px var(--brand-glow);
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
		/* Matches the glide pill exactly: the hover wash and the selected fill
		   occupy the same box, so moving between them is a colour change and not a
		   change of shape. */
		border-radius: var(--radius-pill);
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
	/* The labels are ALL CAPS: no descenders, nothing above cap height — but the
	   line box still reserves room for both, so the ink sat high inside the glide
	   pill and the row of links looked a hair off its own centre. `text-box` trims
	   the line box down to cap-height/baseline, and the block padding is restated
	   to give back exactly what the trim took (~0.19rem a side at this size) so the
	   pill and the rail keep the height they had.

	   Scoped to a @supports because Safari and Firefox have not shipped it yet, and
	   the compensating padding is only correct once the trim applies. Below 1025px
	   the same links are sentence case with real ascenders, so the trim is turned
	   back off there. */
	@supports (text-box: trim-both cap alphabetic) {
		.navlink {
			text-box: trim-both cap alphabetic;
			padding-block: 0.59rem;
		}
	}

	/* Customers waiting on an answer, carried on the nav so it is visible from
	   wherever you are rather than only on the dashboard. The pill itself is the
	   shared `.count-badge` in app.css — all that is local to the nav is the gap
	   between the link's label and the count. */
	.nav-badge {
		margin-left: 0.35rem;
	}
	.navlink:hover {
		color: var(--bar-fg);
		background: var(--bar-wash-strong);
	}
	/* The label, once the accent pill is underneath it.
	
	   `--on-brand`, never a literal. This carried a pinned `#14171c` from the era
	   when the brand was yellow in both themes and its label was therefore always
	   dark. Every theme now flips — Halogen's dark-mode accent is near-white and
	   Overdrive's light-mode accent is deep violet — so a pinned dark label is
	   near-black on violet in one and correct only by luck in the other. */
	.navlink.is-active,
	.navlink.is-active:hover {
		color: var(--on-brand);
		background: transparent;
	}
	/* No-JS / pre-measure fallback: without the pill, the active link paints its own.
	   Foreground restated rather than left to the `.is-active` rule above, so the
	   fill and its label can never be split apart. */
	.nav-links:not(.ready) .navlink.is-active {
		background: var(--brand);
		color: var(--on-brand);
	}
	.navlink:focus-visible {
		outline: 2px solid var(--brand);
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
	.gear-label {
		display: none;
		font-size: 0.9rem;
		font-weight: 700;
		white-space: nowrap;
	}
	/* Pinned dark on yellow, like every active pill. */

	/* Account. The avatar and the menu behind it are `$lib/AccountMenu.svelte`,
	   shared with the portal bar; this slot only decides whether the bar shows one
	   at all (it doesn't, once the nav collapses — see the 1024px block). */
	.account-slot {
		display: contents;
	}

	/* Sits under the overlay (z-index 50) but over the page. Only exists at the
	   widths where the nav actually collapses — above that the links are inline
	   and a full-screen scrim would swallow every click on the page. */
	.nav-scrim {
		display: none;
		position: fixed;
		inset: 0;
		z-index: 40;
		border: none;
		background: transparent;
		cursor: default;
	}
	@media (max-width: 1024px) {
		.nav-scrim {
			display: block;
		}
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
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	/* :global, because the svg lives inside `$lib/ThemeModeIcon.svelte` now and
	   carries that component's scope, not this one's. `display: block` is the
	   icon's own business and it sets it; `flex: none` is this row's, since it is
	   the flex container. */
	.theme-row :global(svg) {
		flex: none;
	}

	/* The view switcher. `order` puts it last in the bar's flex row at every width — on
	   a desktop that is the far right, and on a phone it lands just before the
	   hamburger, which orders itself after it. */
	.switch-slot {
		display: inline-flex;
		align-items: center;
		order: 3;
		margin-left: 0.5rem;
	}
	.hamburger {
		order: 4;
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
		/* Above the click-away scrim (40), below the menu it opens (50). Without
		   this the scrim covers the button that closes the menu, so the X becomes
		   unclickable the moment the menu is open — tapping it just dismisses via
		   the scrim, and tapping it again reopens. */
		position: relative;
		z-index: 45;
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
		border-color: var(--brand);
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
	.hamburger svg {
		display: block;
		flex: none;
	}

	/* ------------------------------------------------------------- Bottom bar
	   The optional phone navigation (Settings → Navigation → Bottom bar). Deliberately
	   the same control the customer portal has always had — same geometry, same safe-area
	   padding, same badge — because it is the same idea, and the two halves of the product
	   drifting apart on their own chrome is what makes an app feel assembled rather than
	   designed. The one difference is the accent: yellow here, teal there.

	   Only ever on screen below 1025px. Above that the bar's rail is visible and a second
	   copy of the same five links would be two navs for one section. */
	.bottombar {
		display: none;
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 35;
		background: var(--bar-bg);
		/* --line-strong, not --bar-line. The bar had a hairline already; it was
		   just the wrong one. --bar-line resolves to --line, which is drawn to sit
		   quietly BETWEEN things on the same surface — and in dark that is #1a2534
		   against a bar whose top edge is #101823, a difference of nothing at 1px.
		   The drop shadow below cannot rescue it either: on a near-black ground a
		   shadow is invisible, which is why app.css zeroes --card-shadow in dark.
		   So the bar simply ended where the content did, with no seam.

		   --line-strong is the app's rule for an edge that has to READ as an edge,
		   and it stays legible in all thirteen palettes in both modes. */
		border-top: 1px solid var(--line-strong);
		box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.18);
		/* Fixed rather than content-sized, so it cannot quietly outgrow the space
		   the page reserves for it. A tab that no longer fits clips visibly, in the
		   bar, where somebody will see it — rather than invisibly, by eating the
		   bottom of the page. */
		box-sizing: border-box;
		height: calc(var(--bottombar-h) + env(safe-area-inset-bottom, 0px));
		padding: 0.2rem 0.2rem calc(0.2rem + env(safe-area-inset-bottom, 0px));
	}
	/* Sign-out on the bar, in the hamburger's seat. Hidden everywhere except the
	   bottom-bar phone layout, which is the only place the menu that used to hold
	   it does not exist. */
	.bar-signout-form {
		display: none;
		align-items: center;
		order: 4;
	}
	.bar-signout {
		width: 2.4rem;
		height: 2.4rem;
	}

	.btab {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.12rem;
		min-width: 0;
		min-height: 3.1rem;
		padding: 0.3rem 0.15rem;
		text-decoration: none;
		color: var(--bar-fg-dim);
		font-size: 0.62rem;
		font-weight: 700;
	}
	/* WHERE AM I. The whole tab lights, not a pill behind the glyph: at the foot of
	   a phone the tab IS the target, and a wash around a 1.15rem emoji was a hint
	   where the question deserves an answer.
	   
	   A filled accent block rather than a tint, and that is the app's existing
	   answer to "which section is this" — the desktop rail's glide pill is the same
	   fill with the same foreground. The two navigations are one idea at two
	   widths and should not each invent their own selected state.
	   
	   Not colour alone, either: the fill is a shape a colour-blind reader still
	   sees (WCAG 1.4.1), and `aria-current="page"` carries it for a screen
	   reader. */
	/* The lit tab. A full-strength brand fill is the loudest thing on the screen —
	   it is safety yellow, sized for a hard hat, and five of these in a row put a
	   headlight under every page. A wash of it says the same thing: the tab is a
	   small shape and the eye reads WHICH one is filled long before it reads how
	   saturated the fill is. The label goes to full contrast instead, which is
	   where the legibility actually has to be. */
	.btab.on {
		background: color-mix(in srgb, var(--brand) 22%, transparent);
		color: var(--bar-fg);
		border-radius: var(--radius-control);
	}
	.btab.on .blabel {
		font-weight: 800;
	}
	.btab:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: -2px;
	}
	/* Dark bars swallow a 22% wash, so it is lifted there — the same fill has to
	   read as "lit" against both grounds. */
	:global(:root[data-theme='dark']) .btab.on {
		background: color-mix(in srgb, var(--brand) 30%, transparent);
	}
	.bicon {
		font-size: 1.15rem;
		line-height: 1;
	}
	.blabel {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The same count the rail carries on Orders. Pinned to the icon rather than the
	   label so a five-tab row stays legible at 360px. */
	.bbadge {
		position: absolute;
		top: 0.3rem;
		left: calc(50% + 0.45rem);
		min-width: 1.05rem;
		height: 1.05rem;
		padding: 0 0.28rem;
		box-sizing: border-box;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: var(--brand);
		color: var(--on-brand);
		font-size: 0.62rem;
		font-weight: 800;
		line-height: 1;
	}
	/* Inverted on the selected tab: an accent badge on an accent fill is a badge
	   nobody can see. */
	.btab.on .bbadge {
		background: var(--on-brand);
		color: var(--brand);
	}

	/* Tablet + mobile: collapse behind the hamburger as an animated overlay. The
	   inline bar can't fit the full link set, so tablets get the menu too. */
	@media (max-width: 1024px) {
		.bottombar {
			display: flex;
		}
		/* Room for the fixed bar, so the footer clears it rather than sitting under
		   it — the last line of the page is otherwise unreachable. */
		.shell.nav-bottom {
			padding-bottom: calc(var(--bottombar-h) + env(safe-area-inset-bottom, 0px));
		}
		/* And room INSIDE the footer, under its line of type.
		   
		   Clearing the bar is not the same as looking clear of it: with the footer's
		   own 1.25rem the copyright line sat about ten pixels off the tab bar's top
		   edge, near enough to read as one crowded strip rather than as two pieces of
		   chrome. The space goes inside the footer rather than below it so the
		   footer's own ground fills it — reserving more on the shell would open a
		   band of page background between two bars instead. */
		.shell.nav-bottom .foot-inner {
			padding-bottom: 2.25rem;
		}
		/* The page title is redundant when a lit tab at the foot of the screen is
		   already naming the section — "Dashboard" as a heading directly above
		   "Dashboard" as a tab is the same word twice on a screen with no room for
		   it once.
		   
		   HIDDEN, NOT REMOVED. A page still needs its h1: it is what a screen
		   reader announces on arrival and what heading navigation jumps between, so
		   this only takes it off the glass. And only when the bottom bar is
		   actually there — with the links behind the hamburger nothing else names
		   the section, and the title is the only answer to "where am I".
		   
		   `:global()` because the title is rendered by the page inside this layout,
		   not by the layout itself. */
		.shell.nav-bottom :global(h1.page-title) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		/* …and take its wrapper out of the layout with it. Clipping the title left
		   a header that measured zero but still sat in the page's grid, so every
		   section under the bottom bar opened on a dead band one `--page-gap` tall.
		   `display: contents` drops the box without dropping the heading.
		   
		   Only when the title is the header's ONLY child — a header that also
		   carries a control still has a job to do, and collapsing it would drop
		   that control into the page grid on its own. */
		.shell.nav-bottom :global(header:has(> h1.page-title:only-child)) {
			display: contents;
		}
		/* With the tabs carrying navigation, the whole collapsed menu goes: its links
		   are duplicated at the foot of the screen, its theme and palette rows moved
		   to the settings page, and its account rows are that page. The hamburger goes
		   with it — a button that opens nothing — and sign-out, the one thing that was
		   only ever in there, becomes a control of its own on the bar. */
		.shell.nav-bottom .nav-collapse,
		.shell.nav-bottom .hamburger,
		.shell.nav-bottom .nav-scrim {
			display: none;
		}
		.shell.nav-bottom .bar-signout-form {
			display: flex;
			margin-left: auto;
		}
		/* The switcher keeps its seat beside it, the same corner the hamburger had. */
		.shell.nav-bottom .switch-slot ~ .bar-signout-form {
			margin-left: 0;
		}
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
		/* The pair sits together at the right edge: the switcher takes the slack so
		   the hamburger does not push it into the middle. */
		.switch-slot {
			margin-left: auto;
			margin-right: 0.4rem;
		}
		.switch-slot ~ .hamburger {
			margin-left: 0;
		}
		/* The palette picker moves to Settings at this width. It is a preference,
		   and the utility row it was sharing is already carrying more than a strip
		   this narrow can hold. TEMPORARY along with the rest of the switcher. */
		.palette-slot {
			display: none;
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
			/* Sentence case here: ascenders reach past cap height, so a cap-trimmed
			   line box would clip the visual breathing room off 'd', 'l', 'k'. */
			text-box: normal;
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
			background: var(--brand);
			color: var(--on-brand);
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
		.account-slot {
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
			/* `.bar-icon` sets no gap — it is built for an icon on its own, where the
			   glyph is centred in a square. Here the label joins it and the two sat
			   flush against each other. */
			gap: 0.5rem;
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
