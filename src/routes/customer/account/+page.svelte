<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PaletteSwitcher from '$lib/PaletteSwitcher.svelte';
	import ThemeModeButton from '$lib/ThemeModeButton.svelte';
	import SupportForm from '$lib/SupportForm.svelte';
	import type { PageData, ActionData } from './$types';

	// Projects, who this is for and the dev flags come from the portal layout load;
	// the support config comes from this page's own.
	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Tabs in the contractor Settings idiom, and URL-driven for the same reasons:
	// each label is a plain link, so they deep-link, survive a reload, respect
	// back/forward and still work with JS off. `/customer/support` 308s onto
	// ?tab=support, so every old link lands on the right one.
	const TABS = [
		{ id: 'account', label: 'Account' },
		{ id: 'support', label: 'Support' }
	] as const;
	type TabId = (typeof TABS)[number]['id'];
	const tab: TabId = $derived(
		TABS.find((t) => t.id === page.url.searchParams.get('tab'))?.id ?? 'account'
	);
	// resolve() can't carry a query string, so the links append ?tab= to the
	// resolved route themselves — the lint rule can't see through that.
	const tabHref = (id: TabId) => `${resolve('/customer/account')}?tab=${id}`;
</script>

<svelte:head><title>Account</title></svelte:head>

<section class="acct">
	<header class="acct-head">
		<h1>Account</h1>
		<p class="who">Signed in as {data.userName}</p>
	</header>

	<nav class="tabs" aria-label="Account sections">
		{#each TABS as t (t.id)}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- tabHref wraps resolve() -->
			<a
				class="tab"
				class:on={tab === t.id}
				aria-current={tab === t.id ? 'page' : undefined}
				href={tabHref(t.id)}
				data-sveltekit-noscroll>{t.label}</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/each}
	</nav>

	{#if tab === 'account'}
		<!-- Appearance, in step with the contractor side: light/dark AND the palette.
		     Both used to ride in the portal bar; they live here instead, because the
		     bar's job in a customer portal is to show someone their job, not to offer
		     two colour controls above it. The one control left up there is the view
		     switcher.

		     TEMPORARY, like every other palette control: goes when a palette is
		     picked. Grep `data-palette`. -->
		<div class="group">
			<span class="group-label">Appearance</span>
			<p class="group-hint">Light or dark, and the colour scheme that rides on top of it.</p>
			<!-- Both on ONE row. They are two answers to the same question — how this
			     should look — and giving each its own row put a label over a lone
			     control twice, which is what made the palette read as an afterthought
			     bolted under the theme.

			     The theme half is a single button rather than two radios. The old
			     objection to a toggle was that it only says what it will do next; this
			     one names the mode it is IN on its face and the action it performs in
			     its accessible name, so nothing has to be read off the page. That
			     matters here more than anywhere: this is the portal's only theme
			     control at every width. -->
			<div class="appearance-row">
				<ThemeModeButton />
				<PaletteSwitcher />
			</div>
		</div>

		{#if data.active.length > 0 || data.past.length > 0}
			<div class="group">
				<span class="group-label">Your projects</span>
				{#each data.active as o (o.id)}
					<a class="row" href={resolve(`/customer/orders/${o.id}`)}>
						<span class="row-name">{o.projectName ?? 'Your project'}</span>
						<span class="row-meta">
							<!-- Same substitution the rail makes: the one question this list is
							     read to answer is which project needs you. -->
							{#if o.openTasks > 0 || o.paymentDue}
								<span class="state waiting">Over to you</span>
							{:else}
								<span class="state">{o.customerStateLabel}</span>
							{/if}
							{#if o.unread > 0}<span class="unread">{o.unread}</span>{/if}
						</span>
					</a>
				{/each}
				{#each data.past as o (o.id)}
					<a class="row past" href={resolve(`/customer/orders/${o.id}`)}>
						<span class="row-name">{o.projectName ?? 'Your project'}</span>
						<span class="state">Complete</span>
					</a>
				{/each}
			</div>
		{/if}

		{#if !data.viewAs}
			<form method="POST" action="/logout" class="signout-form">
				<button type="submit" class="signout">Sign out</button>
			</form>
		{/if}
	{:else if tab === 'support'}
		<!-- The same component the contractor's Settings › Support renders, with the
		     same words and the same controls. It was a 500-line hand-rolled twin of
		     that form until now — CAPTCHA, upload pre-check and honeypot all
		     duplicated, which is the shape of thing that gets fixed on one side and
		     not the other. Two hosts, one form; the accent differs because the
		     portal repoints `--brand`, and nothing here has to know that. -->
		<div class="group">
			<span class="group-label">Support</span>
			<p class="group-hint">
				Something broken, or something missing? This goes straight to the people who build the app —
				add a screenshot if it helps.
			</p>
			<SupportForm
				configured={data.support.configured}
				captchaSiteKey={data.support.captchaSiteKey}
				{form}
				action="?/submitSupport"
				readOnly={!!data.viewAs}
				readOnlyNote="Read-only: you are viewing this portal as the customer, not as them."
			/>
		</div>
	{/if}
</section>

<style>
	.acct {
		display: grid;
		gap: 1rem;
		align-content: start;
	}
	.acct-head h1 {
		margin: 0;
		font-size: 1.35rem;
	}
	/* The tab bar, in the contractor Settings idiom — a bordered track of pills
	   with the accent on the current one — but written in tokens rather than the
	   literals that copy still carries. It comes out in the PORTAL's colour with
	   no work here: `.shell` repoints `--brand` at the customer accent, so the
	   same recipe is safety yellow on one side of the product and the portal's
	   own hue on the other.

	   Hugs its labels rather than spanning the column, and scrolls rather than
	   wrapping, so adding a third tab later cannot push the row into two lines. */
	.tabs {
		display: flex;
		align-items: center;
		justify-self: start;
		max-width: 100%;
		box-sizing: border-box;
		gap: 0.2rem;
		padding: 0.3rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-pill, 999px);
		background: var(--surface-sunken);
		overflow-x: auto;
	}
	.tab {
		flex-shrink: 0;
		padding: 0.45rem 1rem;
		border-radius: var(--radius-pill, 999px);
		font-size: 0.85rem;
		font-weight: 700;
		text-decoration: none;
		white-space: nowrap;
		color: var(--fg-muted);
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}
	.tab:hover {
		color: var(--fg);
		background: var(--surface);
	}
	.tab.on,
	.tab.on:hover {
		background: var(--brand);
		color: var(--on-brand);
	}
	.tab:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.who {
		margin: 0.15rem 0 0;
		color: var(--fg-muted);
		font-size: 0.9rem;
	}
	.group {
		display: grid;
		gap: 0.3rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: 0.7rem;
		box-shadow: var(--card-shadow);
	}
	.group-label {
		padding: 0.1rem 0.35rem;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--fg-muted);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 2.75rem;
		padding: 0.5rem 0.65rem;
		border-radius: 10px;
		border: none;
		background: none;
		color: var(--fg);
		font-family: inherit;
		font-size: 0.95rem;
		text-decoration: none;
		cursor: pointer;
	}
	.row:hover {
		background: var(--surface-sunken);
	}
	.row-name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.group-hint {
		margin: 0 0 0.15rem;
		padding: 0 0.35rem;
		color: var(--fg-muted);
		font-size: 0.82rem;
	}

	/* One row, wrapping rather than shrinking — at a phone width two pills do not
	   fit a line, and a squeezed palette trigger loses the name that is the whole
	   reason it is not just a swatch. */
	.appearance-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.15rem 0.35rem 0.1rem;
	}

	.row-meta {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.state {
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.state.waiting {
		color: var(--accent);
		font-weight: 800;
	}
	.row.past .row-name {
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
	.signout-form {
		display: flex;
		justify-content: center;
		padding-top: 0.25rem;
	}
	.signout {
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg-muted);
		border-radius: 999px;
		padding: 0.6rem 1.4rem;
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
	}
	.signout:hover {
		color: var(--danger);
		border-color: var(--danger);
	}
</style>
