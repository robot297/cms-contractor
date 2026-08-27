<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { theme } from '$lib/theme.svelte';
	import Toaster from '$lib/Toaster.svelte';
	import DevSwitcher from '$lib/DevSwitcher.svelte';
	import AccountMenu from '$lib/AccountMenu.svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	onMount(() => {
		theme.sync();
	});

	const path = $derived(page.url.pathname);
	const currentId = $derived(page.params.id ?? null);
	const hasOrders = $derived(data.active.length + data.past.length > 0);

	// --- Mobile bottom-bar navigation -------------------------------------
	// Three destinations: the current project's detail, its messages, and account.
	// Project and Messages are the same order route split by a `view` param, so the
	// bar switches between them without needing a second page. When you aren't on an
	// order (e.g. Account), they point at your newest project so the tabs always go
	// somewhere sensible.
	const onOrderPage = $derived(!!currentId);
	const onAccount = $derived(path.startsWith('/customer/account'));
	// Support is a tab on Account now, not a route of its own. `/customer/support`
	// still 308s onto it, so nothing lands here carrying that path any more.
	// Annotated, not inferred: TypeScript widens a template literal to `string`,
	// and AccountMenu's `href` will not take one — the whole point of its type is
	// that only a resolved path can get in.
	const supportHref: `${ResolvedPathname}?${string}` = `${resolve('/customer/account')}?tab=support`;
	const onSupport = $derived(onAccount && page.url.searchParams.get('tab') === 'support');
	const currentOrderId = $derived(currentId ?? data.active[0]?.id ?? data.past[0]?.id ?? null);
	const view = $derived(page.url.searchParams.get('view'));
	const isMessages = $derived(onOrderPage && view === 'messages');
	const isProject = $derived(onOrderPage && !isMessages);
	const projectHref = $derived(
		currentOrderId ? resolve(`/customer/orders/${currentOrderId}`) : resolve('/customer')
	);
	// resolve() can't carry a query string, so the messages tab appends ?view= to
	// the resolved order path. Same limitation the settings tabs work around.
	const messagesHref = $derived(
		currentOrderId
			? `${resolve(`/customer/orders/${currentOrderId}`)}?view=messages`
			: resolve('/customer')
	);

	/**
	 * Counts for the open project's sections, read off the page's own data rather
	 * than queried again here — the order page has already loaded all three, and a
	 * second set of queries in the layout would run on every portal page to serve
	 * one of them. Cast because `page.data` is the union of every route's data and
	 * these keys exist only on the order page; the optional chaining is what makes
	 * that safe rather than the type.
	 */
	type OrderPageData = {
		order?: { timeline?: unknown[] };
		documents?: unknown[];
		thread?: unknown[];
	};
	const sections = $derived.by(() => {
		if (!currentId) return null;
		const d = page.data as OrderPageData;
		return [
			{ id: 'history', label: 'History', count: Math.max((d.order?.timeline?.length ?? 0) - 1, 0) },
			{ id: 'documents', label: 'Documents', count: d.documents?.length ?? 0 },
			{ id: 'messages', label: 'Messages', count: d.thread?.length ?? 0 }
		];
	});

	// Mobile: links, projects and utilities all collapse behind the hamburger, the
	// same way the contractor bar does. Nothing but the brand, the view badge and
	// the trigger survives on a phone.
	let menuOpen = $state(false);
	// Past work stays folded away — a long-running customer accumulates finished
	// jobs, and the live one is what they opened the app for.
	let pastOpen = $state(false);

	/**
	 * What sits behind the avatar.
	 *
	 * Account and Support, because above the phone breakpoint the bottom tab bar
	 * that used to carry them is hidden — and Support's only other home is the
	 * project rail, which a customer with no projects yet doesn't get either. So
	 * before this menu existed both pages were unreachable on a laptop.
	 */
	const accountItems = $derived([
		{ label: 'Account', href: resolve('/customer/account'), active: onAccount && !onSupport },
		// Deep-links straight to the tab rather than making you land on Account and
		// find it — the menu is the desktop's only route to either.
		{ label: 'Support', href: supportHref, active: onSupport }
	]);

	function closeMenu() {
		menuOpen = false;
	}
	$effect(() => {
		void path;
		menuOpen = false;
	});
</script>

<svelte:head><title>Your projects</title></svelte:head>

{#snippet projectLink(o: (typeof data.active)[number], withSections: boolean)}
	<a
		href={resolve(`/customer/orders/${o.id}`)}
		class="navlink"
		class:is-active={o.id === currentId}
		aria-current={o.id === currentId ? 'page' : undefined}
		onclick={closeMenu}
	>
		<span class="navlink-name">{o.projectName ?? 'Your project'}</span>
		<span class="navlink-meta">
			<!-- "Over to you" replaces the state word rather than sitting beside it.
			     A customer with three projects reads this rail to find the one that
			     needs them, and "In progress · Over to you" makes them read two
			     things to answer one question. The precise state is on the project
			     itself, one tap away, where it is the headline. -->
			{#if o.openTasks > 0 || o.paymentDue}
				<span class="state waiting">Over to you</span>
			{:else}
				<span class="state">{o.customerStateLabel}</span>
			{/if}
			{#if o.openTasks > 0}
				<span
					class="todo-pip"
					aria-label="{o.openTasks} {o.openTasks === 1 ? 'thing' : 'things'} to do"
					>{o.openTasks}</span
				>
			{/if}
			{#if o.unread > 0}
				<span class="unread" aria-label="{o.unread} messages awaiting your reply">{o.unread}</span>
			{/if}
		</span>
	</a>
	<!-- The open project's own sections, as jump links. Only on the rail and only
	     for the project you are actually looking at: the rail is navigation, and a
	     section of a page you are not on is not somewhere to navigate to. -->
	{#if withSections && o.id === currentId && sections}
		<ul class="subnav">
			{#each sections as s (s.id)}
				<li>
					<a class="sublink" href="#{s.id}" class:empty={s.count === 0}>
						{s.label}
						<span class="subcount">{s.count}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet projectNav(withSections = false)}
	{#if data.active.length > 0}
		<p class="nav-head">Active</p>
		{#each data.active as o (o.id)}{@render projectLink(o, withSections)}{/each}
	{/if}
	{#if data.past.length > 0}
		<button
			class="nav-head as-button"
			type="button"
			aria-expanded={pastOpen}
			onclick={() => (pastOpen = !pastOpen)}
		>
			Past work ({data.past.length})
			<span class="chev" class:open={pastOpen} aria-hidden="true">▾</span>
		</button>
		{#if pastOpen}
			{#each data.past as o (o.id)}{@render projectLink(o, withSections)}{/each}
		{/if}
	{/if}
{/snippet}

{#snippet utilities()}
	<!-- The one control the portal bar carries at every width, phones included:
	     hopping back to the contractor side. It is the same corner the contractor
	     bar keeps its own copy in, so the way back is never somewhere new.

	     Appearance used to sit here too. It moved to the Account page — light/dark
	     and the palette are preferences you set once, and two colour controls in
	     the chrome of a portal that is meant to be showing a customer their job
	     were the loudest thing in the bar. -->
	{#if data.viewAs || data.devSignInEnabled}
		<div class="switch-slot">
			<DevSwitcher
				side="customer"
				viewing={!!data.viewAs}
				canSignInAs={data.devSignInEnabled}
				orderId={currentId}
			/>
		</div>
	{/if}

	<!-- The account pair. `display: contents` above the tablet breakpoint, so the
	     wrapper costs nothing in the flex row; below it both are hidden, because
	     the bottom tab bar's Account tab is the phone's way to them. -->
	<div class="nav-account">
		<!-- Account, in the same seat the contractor bar keeps it: a quiet gear that
		     takes the accent pill when you are on the section, so the bar still answers
		     "where am I" without a nav link for it. -->
		<a
			class="bar-icon settings-gear"
			class:on={onAccount}
			href={resolve('/customer/account')}
			title="Account"
			aria-label="Account"
			onclick={closeMenu}
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
		</a>
		<!-- The name, the account links and sign-out, all behind one square — the same
		     control the contractor bar carries. Replaces a bare "Sign out" pill, which
		     was the widest thing in this bar and the only account affordance in it.

		     Under development view-as there is no sign-out on offer: the session being
		     borrowed is the contractor's, and ending it would sign THEM out. -->
		<AccountMenu
			name={data.userName}
			items={accountItems}
			canSignOut={!data.viewAs}
			onnavigate={closeMenu}
		/>
	</div>
{/snippet}

<div class="shell">
	<div class="bar">
		<nav class="nav">
			<a href={resolve('/customer')} class="brand" onclick={closeMenu}>
				<span class="brand-word">Contractor&nbsp;CRM</span>
			</a>
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

			<!-- Phone: the whole menu. Wider: only the utilities live here, because
			     the projects have a rail of their own beside the content. -->
			<!-- Click-away, same as the contractor bar. Tapping the page behind an open
			     menu should close it; without this the only way out is the X, which
			     reads as a stuck menu. -->
			{#if menuOpen}
				<button
					type="button"
					class="nav-scrim"
					aria-label="Close menu"
					onclick={() => (menuOpen = false)}
				></button>
			{/if}

			<div class="nav-collapse" class:open={menuOpen}>
				<div class="nav-projects">
					{@render projectNav()}
				</div>
				<div class="nav-utils">
					{@render utilities()}
				</div>
			</div>
		</nav>
	</div>

	<div class="wrap" class:solo={!hasOrders}>
		{#if data.bindError}
			<div class="notice" role="alert">
				<strong>Couldn’t join that project.</strong>
				<p>{data.bindError}</p>
			</div>
		{/if}

		{#if hasOrders}
			<aside class="rail" aria-label="Your projects">
				{@render projectNav(true)}
			</aside>
		{/if}

		<main class="main" class:m-messages={isMessages} class:m-project={isProject}>
			{@render children()}
		</main>
	</div>

	<!-- Bottom tab bar — the phone's primary navigation. Hidden on wider screens,
	     where the rail and the bar's own utilities do the same job. -->
	<nav class="bottombar" aria-label="Sections">
		<a
			href={projectHref}
			class="btab"
			class:on={isProject}
			aria-current={isProject ? 'page' : undefined}
		>
			<span class="bicon" aria-hidden="true">🏗️</span>
			<span class="blabel">Project</span>
		</a>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- messagesHref wraps resolve() -->
		<a
			href={messagesHref}
			class="btab"
			class:on={isMessages}
			aria-current={isMessages ? 'page' : undefined}
		>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<span class="bicon" aria-hidden="true">💬</span>
			<span class="blabel">Messages</span>
			{#if data.awaitingReply > 0}
				<span class="bbadge" aria-label="{data.awaitingReply} awaiting your reply"
					>{data.awaitingReply}</span
				>
			{/if}
		</a>
		<a
			href={resolve('/customer/account')}
			class="btab"
			class:on={onAccount}
			aria-current={onAccount ? 'page' : undefined}
		>
			<span class="bicon" aria-hidden="true">⚙️</span>
			<span class="blabel">Account</span>
		</a>
	</nav>
</div>

<Toaster />

<style>
	/* ============================================================
	   Customer portal chrome.

	   MOBILE FIRST: everything above the media query IS the phone
	   layout. Wider screens only ADD to it (min-width); nothing is
	   corrected back down from a desktop baseline.

	   The palette is the contractor app's, with one substitution: an
	   `--accent` teal in place of the safety yellow, so which half of
	   the product you are in is legible at a glance. Every other token
	   is shared, so dark mode needs nothing extra here.
	   ============================================================ */
	/* app.css paints a yellow highlight block behind every bare `h1` — the
	   contractor app's "Job Site" treatment, which the contractor pages opt out of
	   with `h1.page-title`. The portal is a different surface and opts out
	   wholesale, here, so no page has to remember to. */
	.shell :global(h1),
	.shell :global(h2),
	.shell :global(h3) {
		display: block;
		background: none;
		color: inherit;
		border: none;
		border-radius: 0;
		padding: 0;
		box-shadow: none;
		text-transform: none;
		letter-spacing: normal;
		font-weight: 700;
	}

	.shell {
		/* The portal's own colour, which is now the palette's answer for "the other
		   half of the product" rather than a fixed teal. `--who-customer` is set per
		   palette in app.css and chosen to sit far enough from the contractor accent
		   that the two sides of a message thread stay tellable apart. */
		--accent: var(--who-customer);
		--accent-deep: color-mix(in srgb, var(--who-customer) 78%, #000);
		--accent-soft: color-mix(in srgb, var(--who-customer) 12%, var(--surface));
		/* Text that sits ON an accent fill. The portal accent is a mid-tone in light
		   and a bright in dark, so this follows the same rule --on-brand does. */
		--accent-fg: #ffffff;

		/* Which half of the product this is, as one token the shared nav chrome can
		   read — `$lib/AccountMenu.svelte` wears these, so the identical component
		   comes out teal here and safety yellow on the contractor side. Pointed at
		   `--accent` rather than copied from it, so the dark override below moves
		   both without restating either. */
		--bar-accent: var(--accent);
		--bar-accent-fg: var(--accent-fg);

		/* THE BRAND FAMILY, REPOINTED AT THE PORTAL'S OWN ACCENT.
		
		   The portal used to override `--accent` only. But `--accent` is the
		   portal's private token: everything SHARED reaches for `--brand` instead —
		   the focus ring on every input (`input:focus` in app.css), `::selection`,
		   `.icon-btn` hover and its pressed state, `h1.page-title`, and the innards
		   of `$lib/PaletteSwitcher.svelte` and `$lib/DevSwitcher.svelte`, both of
		   which sit in this bar. All of those kept resolving to the CONTRACTOR's
		   accent, so the portal read as two colours arguing: the Status panel and
		   the invoice in `--who-customer`, and every ring, selection and hover in
		   the contractor's `--brand`.
		
		   Repointing the family here fixes all of them at once and keeps working
		   for anything shared that is added later, which copying values into each
		   component would not. Nothing branches on which side it is on — this is
		   the same trick `--accent` was already doing, applied to the tokens the
		   rest of the app actually uses. */
		--brand: var(--accent);
		--brand-deep: var(--accent-deep);
		--on-brand: var(--accent-fg);
		/* The second brand hue. `--who-contractor` rather than a mix off the accent:
		   a sweep needs two hues that are genuinely different, and the two halves of
		   the product are exactly that pair — the palettes are built so they read
		   apart. */
		--brand-2: var(--who-contractor);
		--brand-glow: color-mix(in srgb, var(--accent) 30%, transparent);
		--brand-glow-strong: color-mix(in srgb, var(--accent) 55%, transparent);
		--brand-sweep: linear-gradient(135deg, var(--accent), var(--who-contractor));

		/* The hero panel's own palette. In light it is an accent slab; in dark that
		   same slab reads as a glowing plastic brick, so dark gets a deep tinted
		   surface with accent detailing instead of an inverted-brightness copy.

		   The whites below are NOT the frozen-literal bug the dark block had: here
		   the slab is a fill of --accent, so white and its alphas are the text ON
		   the palette rather than a colour beside it, and they follow it by
		   sitting on top of it. Every light `--who-customer` clears 5.3:1 against
		   white. */
		--hero-bg:
			radial-gradient(120% 100% at 100% 0%, rgba(255, 255, 255, 0.22), transparent),
			linear-gradient(160deg, var(--accent), var(--accent-deep));
		--hero-fg: #ffffff;
		--hero-dim: rgba(255, 255, 255, 0.72);
		--hero-inset: rgba(0, 0, 0, 0.16);
		--hero-rule: rgba(255, 255, 255, 0.32);
		--hero-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 32%, transparent);
		--hero-edge: transparent;
		/* The tick inside a completed step dot, drawn on --hero-fg. */
		--hero-tick: var(--accent-deep);

		--bar-bg: linear-gradient(180deg, var(--surface), var(--surface-sunken));
		--bar-line: var(--line);
		--bar-fg: var(--fg);
		--bar-fg-dim: var(--fg-muted);
		--bar-edge: var(--line-strong);
		--bar-wash: var(--surface-sunken);

		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .shell {
		--accent: var(--who-customer);
		--accent-deep: color-mix(in srgb, var(--who-customer) 72%, var(--surface));
		--accent-soft: color-mix(in srgb, var(--who-customer) 16%, var(--surface));
		/* Dark on the bright dark-mode accent, matching --on-brand's behaviour.
		   Mixed from the accent and the palette's darkest surface rather than
		   written as a literal, so it stays in the accent's own family. */
		--accent-fg: color-mix(in srgb, var(--accent) 14%, var(--surface-inset));

		/* Dark hero: a deep accent-tinted surface that belongs to the page, with
		   the accent used as light (rule, ring, status text) rather than as a fill.

		   EVERY value below is mixed FROM --accent. They used to be six frozen
		   teal literals, left over from when the portal's accent was a fixed teal
		   rather than the palette's `--who-customer`. That made the Status panel —
		   the largest thing on the customer's main screen — the one surface in the
		   app that ignored the palette outright in dark mode. Light mode hid it:
		   there the slab IS the accent fill, so it changed and this did not.

		   The two blacks that remain are shade, not hue: an inset well and a drop
		   shadow are darkness, and tinting them just muddies the slab. */
		--hero-bg:
			radial-gradient(
				140% 120% at 100% 0%,
				color-mix(in srgb, var(--accent) 16%, transparent),
				transparent
			),
			linear-gradient(160deg, color-mix(in srgb, var(--accent) 22%, var(--surface)), var(--surface));
		--hero-fg: color-mix(in srgb, var(--accent) 12%, var(--fg));
		--hero-dim: color-mix(in srgb, var(--hero-fg) 70%, transparent);
		--hero-inset: rgba(0, 0, 0, 0.28);
		--hero-rule: color-mix(in srgb, var(--accent) 30%, transparent);
		--hero-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
		--hero-edge: color-mix(in srgb, var(--accent) 22%, transparent);
		/* The tick inside a completed step dot, drawn on the --hero-fg fill. */
		--hero-tick: color-mix(in srgb, var(--accent) 30%, var(--surface-inset));

		--bar-bg: linear-gradient(180deg, var(--surface-sunken), var(--surface));
		--bar-fg: var(--fg);
		--bar-fg-dim: var(--fg-muted);
		--bar-edge: var(--line-strong);
		--bar-wash: var(--surface-sunken);
	}

	/* ------------------------------------------------------------- Bar */
	/* Surface, padding, wordmark and the utility squares come from the shared
	   `.bar` / `.nav` / `.brand-word` / `.bar-icon` block in app.css — both halves
	   of the product wear one bar. Only what is genuinely this bar's own stays
	   here: it is pinned (the portal is read top-to-bottom and the bar is how you
	   get back out), and it has one edge rather than two, because no accent rule
	   sits under it. */
	.bar {
		border-bottom: 1px solid var(--bar-line);
		position: sticky;
		top: 0;
		z-index: 30;
	}
	/* The view switcher. Same arrangement as the contractor bar: `order` puts it last in
	   the flex row, so it is the far right on a desktop and immediately left of
	   the hamburger on a phone. */
	.switch-slot {
		display: inline-flex;
		align-items: center;
		order: 3;
		margin-left: 0.5rem;
	}

	.hamburger {
		/* The phone navigates from the bottom bar now, so its old top-corner menu
		   (projects + utilities, all of which live in the Account tab) is retired. */
		display: none;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		margin-left: auto;
		flex-shrink: 0;
		/* Above the scrim (40), below the menu (50) — see .nav-scrim. */
		position: relative;
		z-index: 45;
		border: 1.5px solid var(--bar-edge);
		background: var(--bar-wash);
		color: var(--bar-fg);
		border-radius: 12px;
		cursor: pointer;
	}
	.hamburger:hover {
		background: var(--bar-edge);
	}

	/* Phone: an overlay panel that floats over the page and tweens in, rather than
	   an inline block that shoves the content down when it opens — the same
	   treatment the contractor bar uses. `visibility` is transitioned on a delay
	   so the panel stays out of the tab order while it is fading out. */
	/* Under the menu (50), over the page. The hamburger is lifted above it below,
	   or the scrim would cover the very button that closes the menu. */
	.nav-scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		border: none;
		background: transparent;
		cursor: default;
	}
	/* No longer a panel. It was an overlay that dropped from the hamburger, but the
	   hamburger is retired — the bottom tab bar navigates the phone — which left
	   this hidden and unreachable below the tablet breakpoint. It is now simply the
	   bar's right-hand cluster: static, on show at every width, and carrying the
	   view switcher down to the smallest screen. */
	.nav-collapse {
		display: flex;
		flex: 1;
		flex-direction: row;
		align-items: center;
		justify-content: flex-end;
		gap: 0.4rem;
	}
	/* Projects have the rail beside the content and the bottom tab bar on a phone.
	   The bar's copy is never the way to them. */
	.nav-projects {
		display: none;
	}
	/* The bar's right-hand cluster: view switcher, gear, avatar — the contractor
	   bar's `.nav-right` order and spacing, minus the Appearance controls, which
	   are the Account page's now. */
	.nav-utils {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.75rem;
	}
	/* The gear and the avatar. On a phone the bottom bar's Account tab is the way to
	   both, so a bar copy would only duplicate — which leaves the view switcher as
	   the single control in the portal's upper-right at that width. Above the
	   breakpoint the wrapper dissolves so the flex row spaces the controls as if it
	   weren't there. */
	.nav-account {
		display: none;
	}

	/* --------------------------------------------------------- Nav links */
	.nav-head {
		margin: 0.35rem 0 0.2rem;
		padding: 0 0.55rem;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--fg-muted);
	}
	.nav-head.as-button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
	}
	.navlink {
		display: grid;
		gap: 0.15rem;
		/* 44px minimum target: this is the primary navigation on a phone. */
		min-height: 2.75rem;
		align-content: center;
		padding: 0.5rem 0.55rem;
		border-radius: 10px;
		text-decoration: none;
		color: var(--fg);
		border: 1px solid transparent;
	}
	.navlink:hover {
		background: var(--surface-sunken);
	}
	.navlink.is-active {
		background: var(--accent-soft);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
	}
	:global(:root[data-theme='dark']) .navlink.is-active {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.navlink-name {
		font-weight: 600;
		font-size: 0.92rem;
		overflow-wrap: anywhere;
	}
	.navlink-meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	/* Sections of the open project. Indented and quieter than a project link, so
	   the rail still reads as a list of projects with one of them expanded rather
	   than as a flat list of six equal things. */
	.subnav {
		list-style: none;
		margin: 0.1rem 0 0.3rem;
		padding: 0 0 0 0.55rem;
		display: grid;
		gap: 0.05rem;
		border-left: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
		margin-left: 0.55rem;
	}
	.sublink {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 2rem;
		padding: 0.3rem 0.5rem;
		border-radius: 8px;
		text-decoration: none;
		color: var(--fg-muted);
		font-size: 0.85rem;
	}
	.sublink:hover {
		background: var(--surface-sunken);
		color: var(--fg);
	}
	/* A section with nothing in it is still worth showing — it says "no documents
	   yet" rather than leaving the customer to wonder where documents went — but it
	   should not compete with the ones that have something to read. */
	.sublink.empty {
		opacity: 0.55;
	}
	.subcount {
		min-width: 1.1rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		font-size: 0.7rem;
		font-weight: 700;
		text-align: center;
	}
	.state {
		font-size: 0.76rem;
		color: var(--fg-muted);
	}
	/* The rail's one "this needs you" mark. It borrows the accent the unread badge
	   wears rather than inventing a second alarm colour: both mean the same thing
	   to a customer — something here is waiting on me — and two colours would ask
	   them to learn which is worse. */
	.state.waiting {
		color: var(--accent);
		font-weight: 800;
	}
	.todo-pip {
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 0.3rem;
		box-sizing: border-box;
		border-radius: 999px;
		border: 1.5px solid var(--accent);
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 800;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.unread {
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--accent);
		color: var(--accent-fg);
		font-size: 0.7rem;
		font-weight: 800;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.chev {
		transition: transform 0.15s ease;
	}
	.chev.open {
		transform: rotate(180deg);
	}

	/* Phone: the bar carries the brand and the view switcher, nothing else. The
	   bottom tab bar navigates, and its Account tab is the way to the gear, the
	   account menu and Appearance — so those hide below the tablet breakpoint and
	   the switcher does not. */

	/* The account gear. Quiet icon-only chrome, except when you're on the account
	   section: then it takes the accent pill, so
	   the bar answers "where am I" with no nav link for it.

	   Icon-only, with the name carried by `aria-label`. The contractor's copy
	   reveals a text label inside its collapsed hamburger panel; this bar has no
	   such panel — below the tablet breakpoint the bottom tab bar navigates and
	   `.nav-account` is hidden — so there is nowhere for one to appear. */

	/* ------------------------------------------------------------ Body */
	.wrap {
		flex: 1;
		width: 100%;
		box-sizing: border-box;
		max-width: 1100px;
		margin: 0 auto;
		padding: 0.9rem;
		display: grid;
		gap: 0.9rem;
		align-content: start;
	}
	.rail {
		display: none;
	}
	.main {
		min-width: 0;
		display: grid;
		/* Every grid level from the page down to a document row needs an explicit
		   0 floor: a track sized `auto` takes its item's MAX-content width, so one
		   long filename widens the row, the card, the main column and finally the
		   document. Truncation lower down only works if the constraint reaches it. */
		grid-template-columns: minmax(0, 1fr);
		gap: 0.9rem;
		align-content: start;
	}
	.notice {
		border: 1px solid var(--line);
		border-left: 3px solid var(--danger);
		background: var(--surface);
		border-radius: 12px;
		padding: 0.85rem 0.95rem;
	}
	.notice p {
		margin: 0.3rem 0 0;
		color: var(--fg-muted);
		font-size: 0.9rem;
	}

	/* --------------------------------------------------------- Bottom bar
	   The phone's primary navigation: Project · Messages · Account, fixed to the
	   foot of the screen like a native app's tab bar. */
	.bottombar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 35;
		display: flex;
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
		box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
		padding: 0.2rem 0.2rem calc(0.2rem + env(safe-area-inset-bottom, 0px));
	}
	.btab {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.12rem;
		min-height: 3.1rem;
		padding: 0.3rem 0.2rem;
		text-decoration: none;
		color: var(--bar-fg-dim);
		font-size: 0.66rem;
		font-weight: 700;
	}
	.btab.on {
		color: var(--accent);
	}
	.bicon {
		font-size: 1.2rem;
		line-height: 1;
	}
	.bbadge {
		position: absolute;
		top: 0.32rem;
		left: calc(50% + 0.5rem);
		min-width: 1.05rem;
		height: 1.05rem;
		padding: 0 0.28rem;
		box-sizing: border-box;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: var(--accent);
		color: var(--accent-fg);
		font-size: 0.64rem;
		font-weight: 800;
		line-height: 1;
	}

	/* Below the tablet breakpoint the bottom bar owns navigation, so the project
	   page shows one group at a time — the tab you're on. The section ids are the
	   order page's own; the bar toggles which group is hidden via the main's class.

	   Messages hides EVERYTHING that isn't the thread, rather than naming the
	   sections to hide one at a time. The list version had been outgrown: it named
	   #status and #documents, so when the invoice card was added it was on neither
	   list and showed up under both tabs — a customer read their balance on the
	   Messages tab, which is for messages. Written this way a section added later
	   lands on Project by default, which is the side that means "your job"; only
	   the thread belongs here.

	   Direct children only, and `section` only. The order page's `<header>` carries
	   the job's name and stays as context on both tabs, and the document viewer is
	   a `div` dialog that must still be able to open over either. */
	@media (max-width: 47.99rem) {
		.wrap {
			padding-bottom: 4.5rem;
		}
		.main.m-messages > :global(section:not(#messages)) {
			display: none;
		}
		.main.m-project > :global(#messages) {
			display: none;
		}
	}

	/* ================================================== Tablet and up ===
	   The rail appears beside the content, and the account-side controls join the
	   Appearance pair already in the bar. */
	@media (min-width: 48rem) {
		/* The rail and top-bar utilities navigate here; the bottom bar is a phone
		   affordance. */
		.bottombar {
			display: none;
		}
		.nav {
			padding: 0.7rem 1.5rem;
		}
		.hamburger {
			display: none;
		}
		/* `contents`, not `flex`: the wrapper stops being a box and its three
		   controls join `.nav-utils`' own flex row, so the gap between the theme
		   toggle and the gear is the same 0.75rem as everywhere else in the bar. */
		.nav-account {
			display: contents;
		}

		.wrap {
			padding: 1.25rem 1.5rem;
			grid-template-columns: 250px minmax(0, 1fr);
		}
		.wrap.solo {
			grid-template-columns: minmax(0, 1fr);
		}
		.notice {
			grid-column: 1 / -1;
		}
		.rail {
			display: block;
			background: var(--surface);
			border: 1px solid var(--line);
			border-radius: 16px;
			padding: 0.7rem;
			box-shadow: var(--card-shadow);
			position: sticky;
			top: 5rem;
		}
	}
</style>
