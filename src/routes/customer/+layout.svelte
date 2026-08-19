<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { theme } from '$lib/theme.svelte';
	import Toaster from '$lib/Toaster.svelte';
	import DevSwitcher from '$lib/DevSwitcher.svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	onMount(() => {
		theme.sync();
	});

	const path = $derived(page.url.pathname);
	const currentId = $derived(page.params.id ?? null);
	const onSupport = $derived(path.startsWith('/customer/support'));
	const hasOrders = $derived(data.active.length + data.past.length > 0);

	// --- Mobile bottom-bar navigation -------------------------------------
	// Three destinations: the current project's detail, its messages, and account.
	// Project and Messages are the same order route split by a `view` param, so the
	// bar switches between them without needing a second page. When you aren't on an
	// order (e.g. Account), they point at your newest project so the tabs always go
	// somewhere sensible.
	const onOrderPage = $derived(!!currentId);
	const onAccount = $derived(path.startsWith('/customer/account'));
	const currentOrderId = $derived(currentId ?? data.active[0]?.id ?? data.past[0]?.id ?? null);
	const view = $derived(page.url.searchParams.get('view'));
	const isMessages = $derived(onOrderPage && view === 'messages');
	const isProject = $derived(onOrderPage && !isMessages);
	const projectHref = $derived(
		currentOrderId ? resolve(`/customer/orders/${currentOrderId}`) : resolve('/customer')
	);
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
			<span class="state">{o.customerStateLabel}</span>
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
	<a
		href={resolve('/customer/support')}
		class="navlink support"
		class:is-active={onSupport}
		onclick={closeMenu}
	>
		<span class="navlink-name">Support</span>
	</a>
{/snippet}

{#snippet utilities()}
	<!-- Development only. Lives with the other utilities rather than in the header
	     row: on a phone that row is brand, badge and hamburger with nothing to
	     spare, and this is not something to make room for. -->
	{#if data.viewAs || data.devSignInEnabled}
		<DevSwitcher
			side="customer"
			viewing={!!data.viewAs}
			canSignInAs={data.devSignInEnabled}
			orderId={currentId}
		/>
	{/if}
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
	{#if !data.viewAs}
		<form method="POST" action="/logout">
			<button type="submit" class="signout">Sign out</button>
		</form>
	{/if}
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
		<a
			href={messagesHref}
			class="btab"
			class:on={isMessages}
			aria-current={isMessages ? 'page' : undefined}
		>
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
		--accent: #0f7d8c;
		--accent-deep: #0b616d;
		--accent-soft: #e4f2f4;
		/* Text that sits ON an accent fill. */
		--accent-fg: #ffffff;

		/* The hero panel's own palette. In light it is an accent slab; in dark that
		   same slab reads as a glowing plastic brick, so dark gets a deep tinted
		   surface with accent detailing instead of an inverted-brightness copy. */
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

		--bar-bg: linear-gradient(180deg, #ffffff, #f6f8f8);
		--bar-line: var(--line);
		--bar-fg: var(--fg);
		--bar-fg-dim: rgba(31, 35, 40, 0.66);
		--bar-edge: rgba(17, 17, 17, 0.16);
		--bar-wash: rgba(17, 17, 17, 0.05);

		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .shell {
		--accent: #45c2d3;
		--accent-deep: #2b97a6;
		--accent-soft: #13323a;
		--accent-fg: #05232a;

		/* Dark hero: a deep teal-tinted surface that belongs to the page, with the
		   accent used as light (rule, ring, status text) rather than as a fill. */
		--hero-bg:
			radial-gradient(140% 120% at 100% 0%, rgba(69, 194, 211, 0.16), transparent),
			linear-gradient(160deg, #17323b, #121a20);
		--hero-fg: #eaf6f8;
		--hero-dim: rgba(234, 246, 248, 0.62);
		--hero-inset: rgba(0, 0, 0, 0.28);
		--hero-rule: rgba(69, 194, 211, 0.3);
		--hero-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
		--hero-edge: rgba(69, 194, 211, 0.22);
		--hero-tick: #12242b;

		--bar-bg: linear-gradient(180deg, #20252d, #181c22);
		--bar-fg: #f5f8fb;
		--bar-fg-dim: rgba(245, 248, 251, 0.66);
		--bar-edge: rgba(255, 255, 255, 0.14);
		--bar-wash: rgba(255, 255, 255, 0.07);
	}

	/* ------------------------------------------------------------- Bar */
	.bar {
		background: var(--bar-bg);
		border-bottom: 1px solid var(--bar-line);
		box-shadow: 0 4px 16px rgba(27, 31, 36, 0.06);
		position: sticky;
		top: 0;
		z-index: 30;
	}
	.nav {
		position: relative; /* anchor for the overlay panel below */
		box-sizing: border-box;
		padding: 0.6rem 0.9rem;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--bar-fg);
		text-decoration: none;
		flex-shrink: 0;
	}
	.brand-word {
		font-weight: 900;
		font-size: 0.88rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
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
	.nav-collapse {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		z-index: 50;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.4rem;
		padding: 0.75rem 0.9rem 1rem;
		background: var(--bar-bg);
		border-bottom: 1px solid var(--bar-line);
		box-shadow: 0 14px 28px rgba(0, 0, 0, 0.28);
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
	@media (prefers-reduced-motion: reduce) {
		.nav-collapse {
			transition: none;
		}
	}
	.nav-projects {
		display: grid;
		gap: 0.15rem;
	}
	.nav-utils {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-top: 0.35rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--bar-line);
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
	.navlink.support {
		margin-top: 0.4rem;
		border-top: 1px solid var(--line);
		border-radius: 0;
		padding-top: 0.7rem;
		color: var(--fg-muted);
		font-size: 0.9rem;
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

	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border: none;
		background: none;
		border-radius: 8px;
		color: var(--bar-fg-dim);
		cursor: pointer;
	}
	.theme-toggle:hover {
		color: var(--bar-fg);
	}
	.signout {
		border: 1px solid var(--bar-edge);
		background: transparent;
		color: var(--bar-fg-dim);
		border-radius: 999px;
		padding: 0.4rem 0.9rem;
		font-size: 0.85rem;
		font-family: inherit;
		cursor: pointer;
	}
	.signout:hover {
		color: var(--danger);
		border-color: var(--danger);
	}

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
		border-top: 1px solid var(--bar-line);
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
	   page shows one section at a time — the tab you're on. The section ids are the
	   order page's own; the bar toggles which group is hidden via the main's class. */
	@media (max-width: 47.99rem) {
		.wrap {
			padding-bottom: 4.5rem;
		}
		.main.m-messages :global(#status),
		.main.m-messages :global(#documents) {
			display: none;
		}
		.main.m-project :global(#messages) {
			display: none;
		}
	}

	/* ================================================== Tablet and up ===
	   The rail appears beside the content and the utilities move into the
	   bar, so the hamburger has nothing left to hold. */
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
		/* Back into the bar: static, visible, no panel chrome. */
		.nav-collapse {
			position: static;
			flex-direction: row;
			justify-content: flex-end;
			align-items: center;
			flex: 1;
			padding: 0;
			background: none;
			border-bottom: none;
			box-shadow: none;
			opacity: 1;
			visibility: visible;
			transform: none;
			transition: none;
		}
		/* Projects live in the rail at this width, not in the bar. */
		.nav-projects {
			display: none;
		}
		.nav-utils {
			margin-top: 0;
			padding-top: 0;
			border-top: none;
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
