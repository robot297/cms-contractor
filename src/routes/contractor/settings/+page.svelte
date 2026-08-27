<script lang="ts">
	import PaletteSwitcher from '$lib/PaletteSwitcher.svelte';
	import ThemeModeButton from '$lib/ThemeModeButton.svelte';
	import { REVIEW_PLATFORMS, MAX_REVIEW_URL } from '$lib/reviews';
	import SupportForm from '$lib/SupportForm.svelte';
	import { onMount, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		blockedMessage,
		limitedRecordLabel,
		LIMITED_RECORDS,
		FOLLOWUP_DAY_CHOICES,
		followUpDaysLabel
	} from '$lib/crm';
	import EmailTemplatesPanel from '$lib/EmailTemplatesPanel.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// `data.integrations` is loaded but read nowhere on this page — the panel that
	// showed it is gone. Left in the loader rather than ripped out here, since
	// EmailTemplatesPanel takes the whole `data`.
	const { profile, account, limits } = $derived(data);

	// Tabs are URL-driven (?tab=email) rather than component state: each label is a
	// plain link, so tabs deep-link, survive reloads, respect back/forward, and still
	// switch with JS disabled. Billing is deliberately not here — it stays its own
	// route, reached from the Account tab's CTA and the nav's account menus.
	const TABS = [
		{ id: 'account', label: 'Account' },
		{ id: 'email', label: 'Email' },
		{ id: 'workspace', label: 'Workspace' },
		// Support was a top-level nav entry. It is configuration-adjacent rather
		// than somewhere you work, and it was spending one of five slots in a bar
		// whose other four are the job itself — so it joins the tabs and the nav
		// gets the slot back.
		{ id: 'support', label: 'Support' }
	] as const;
	type TabId = (typeof TABS)[number]['id'];
	const tab: TabId = $derived(
		TABS.find((t) => t.id === page.url.searchParams.get('tab'))?.id ?? 'account'
	);
	// resolve() can't carry a query string, so tab links append ?tab= to the
	// resolved route themselves — the lint rule can't see that, hence the disables
	// at each navigation site.
	const tabHref = (id: TabId) => `${resolve('/contractor/settings')}?tab=${id}`;

	// The old anchor (#email-templates) was a 308 redirect target for a while, so
	// cached redirects may still arrive with it; forward onto the tab that owns the
	// panel now.
	onMount(() => {
		if (location.hash === '#email-templates')
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- tabHref wraps resolve()
			goto(tabHref('email'), { replaceState: true });
	});

	const dateFmt = new Intl.DateTimeFormat('en-US', {
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	});
	const showDate = (d: Date | string | null | undefined) => (d ? dateFmt.format(new Date(d)) : '—');

	/**
	 * One phrase for the account's state. The billing page explains the money; this
	 * page only has to answer "am I OK?", so it says that and links onward.
	 */
	const statusLabel = $derived(
		{
			trialing: 'Free trial',
			active: 'Subscribed',
			past_due: 'Payment failed',
			lapsed: 'Subscription ended',
			comped: 'Complimentary'
		}[account.status] ?? account.status
	);

	const statusTone = $derived(
		account.status === 'lapsed' || account.status === 'past_due'
			? 'bad'
			: account.status === 'trialing'
				? 'warn'
				: 'good'
	);

	// Workspace tab state. Same pattern as the email panel: fields are seeded once
	// (untrack) and then owned locally, with `reset: false` so a save doesn't let
	// the native form.reset() drift the DOM out from under Svelte.
	const keepFields =
		() =>
		async ({ update }: { update: (o?: object) => Promise<void> }) =>
			await update({ reset: false });

	// Review destinations, one field per platform. Seeded once from the load and
	// owned locally after that, the same way the signature field is: the form
	// posts one platform at a time, so re-deriving all eight from `data` on every
	// action result would blow away whatever is half-typed in the other seven.
	let reviewUrls = $state(
		untrack(() => {
			const seed: Record<string, string> = {};
			for (const p of REVIEW_PLATFORMS) seed[p.id] = '';
			for (const link of data.reviewLinks) seed[link.platform] = link.url;
			return seed;
		})
	);
	// Cleared on the next keystroke, so the tick belongs to what is in the box
	// rather than sitting there over an edited value.
	let reviewSaved = $state<string | null>(null);
	const reviewErr = (id: string) =>
		form?.action === 'review' && form?.platform === id ? form.message : null;
	/** How many are actually offered — the card's one-line answer to "is this on?" */
	const configuredReviews = $derived(
		REVIEW_PLATFORMS.filter((p) => reviewUrls[p.id]?.trim() !== '').length
	);

	// Where the phone/tablet nav sits. Saved on the click rather than behind a Save
	// button: it is a two-way switch whose result is visible the moment it lands,
	// so a confirm step would be a step for nothing.
	let navPlacement = $state(untrack(() => data.navPlacement));
	const NAV_CHOICES = [
		{ id: 'top', label: 'Top bar', note: 'Links behind the menu button, top right.' },
		{ id: 'bottom', label: 'Bottom bar', note: 'A fixed tab bar at the foot of the screen.' }
	] as const;

	let followUpDays = $state(untrack(() => data.followUpDays));
	const followUpDirty = $derived(followUpDays !== data.followUpDays);
</script>

<svelte:head><title>Settings</title></svelte:head>

<div class="wrap">
	<div class="head">
		<h1 class="page-title">Settings</h1>
	</div>

	<nav class="tabs" aria-label="Settings sections">
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
		<div class="tab-panel">
			<!-- Who you are. Read-only for now: name and email are owned by the auth
			     provider, and editing them is a separate change with its own
			     re-verification rules rather than something to bolt on here. -->
			<section class="card">
				<div class="card-head">
					<h2>Profile</h2>
					<span class="muted">Signed in</span>
				</div>
				<dl class="facts">
					<div class="fact">
						<dt>Name</dt>
						<dd>{profile.name}</dd>
					</div>
					<div class="fact">
						<dt>Email</dt>
						<dd>
							{profile.email}
							{#if profile.emailVerified}
								<span class="pill good" title="This address has been verified">Verified</span>
							{:else}
								<span class="pill warn" title="This address has not been verified">Unverified</span>
							{/if}
						</dd>
					</div>
					<div class="fact">
						<dt>Business name</dt>
						<dd>
							{#if profile.businessName}
								{profile.businessName}
							{:else}
								<span class="muted">Not set —</span>
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tabHref wraps resolve() -->
								<a href={tabHref('email')} data-sveltekit-noscroll>add it on the Email tab</a>
							{/if}
						</dd>
					</div>
					<div class="fact">
						<dt>Member since</dt>
						<dd>{showDate(profile.memberSince)}</dd>
					</div>
				</dl>
			</section>

			<!-- Account state. Deliberately a summary with a way through, not a second
			     billing page — one surface owns plans and payment. -->
			<section class="card">
				<div class="card-head">
					<h2>Account state</h2>
					<span class="pill {statusTone}">{statusLabel}</span>
				</div>

				<dl class="facts">
					{#if account.status === 'trialing'}
						<div class="fact">
							<dt>Trial ends</dt>
							<dd>
								{showDate(account.trialEndsAt)}
								{#if account.trialDaysRemaining !== null}
									<span class="muted"
										>({account.trialDaysRemaining}
										{account.trialDaysRemaining === 1 ? 'day' : 'days'} left)</span
									>
								{/if}
							</dd>
						</div>
					{:else if account.currentPeriodEnd}
						<div class="fact">
							<dt>{account.status === 'lapsed' ? 'Ended' : 'Renews'}</dt>
							<dd>{showDate(account.currentPeriodEnd)}</dd>
						</div>
					{/if}
					<div class="fact">
						<dt>Changes</dt>
						<dd>
							{#if account.canWrite}
								Allowed
							{:else}
								<span class="pill bad">Paused</span>
							{/if}
						</dd>
					</div>
				</dl>

				{#if !account.canWrite && account.reason}
					<p class="alert">{blockedMessage(account.reason)}</p>
				{/if}

				{#if account.limitsApply && limits}
					<h3 class="sub">Trial capacity</h3>
					<ul class="limits">
						{#each LIMITED_RECORDS as kind (kind)}
							{@const entry = limits[kind]}
							<li class:at-limit={entry.atLimit}>
								<span class="limit-label">{limitedRecordLabel(kind, true)}</span>
								<span class="limit-count">{entry.used} / {entry.limit}</span>
							</li>
						{/each}
					</ul>
				{/if}

				<div class="actions">
					<a class="btn primary" href={resolve('/contractor/billing')}>
						{account.status === 'trialing' || account.status === 'lapsed'
							? 'Choose a plan'
							: 'Manage billing'}
					</a>
				</div>
			</section>

			<section class="card">
				<h2>Session</h2>
				<p class="note">Signing out ends this session on this device only.</p>
				<div class="actions">
					<form method="POST" action={resolve('/logout')}>
						<button type="submit" class="btn danger">Sign out</button>
					</form>
				</div>
			</section>
		</div>
	{:else if tab === 'email'}
		<div class="tab-panel">
			<!-- Signature, templates and the placeholder reference. The panel owns its
			     own cards; it shares this route's form actions. -->
			<EmailTemplatesPanel {data} {form} />
		</div>
	{:else if tab === 'workspace'}
		<div class="tab-panel">
			<!-- Appearance. Light/dark AND the palette, on ONE row: they are two
			     answers to "how should this look", and stacking them put a heading
			     over a lone control twice. The theme control is a single button that
			     names the mode it is in rather than a pair of radios — see
			     ThemeModeButton for why that is not the usual toggle mistake.

			     Light/dark lives here as well as on the bar. It HAS to: with the
			     navigation at the foot of the screen the bar's toggle and the menu
			     that used to hold a second copy are both gone, and a preference you
			     can only change in a layout you are not using is not a preference.
			     Same shared store either way, so the two never disagree.

			     The palette half is TEMPORARY, like every other palette control:
			     goes when a palette is picked. Grep `data-palette`. -->
			<section class="card">
				<h2>Appearance</h2>
				<p class="hint">Light or dark, and the colour scheme that rides on top of it.</p>
				<div class="appearance-row">
					<ThemeModeButton />
					<PaletteSwitcher />
				</div>
			</section>

			<!-- Where the nav sits on a phone. Chrome rather than configuration, so it
			     keeps company with Appearance — and it changes nothing above the
			     desktop breakpoint, where the bar's rail navigates either way. -->
			<section class="card">
				<h2>Navigation</h2>
				<p class="hint">
					Where the links sit on a phone. Above 1024px the bar carries them either way.
				</p>
				<form method="POST" action="?/saveNav" use:enhance={keepFields} class="nav-choices">
					{#each NAV_CHOICES as choice (choice.id)}
						<label class="nav-choice" class:on={navPlacement === choice.id}>
							<input
								class="sr-only"
								type="radio"
								name="navPlacement"
								value={choice.id}
								checked={navPlacement === choice.id}
								onchange={(e) => {
									navPlacement = choice.id;
									e.currentTarget.form?.requestSubmit();
								}}
							/>
							<!-- A phone with its bar drawn where the choice puts it. Two words can
							     describe this, but only the picture answers it at a glance. -->
							<span class="nav-shot {choice.id}" aria-hidden="true">
								<span class="nav-shot-bar"></span>
								<span class="nav-shot-body"></span>
							</span>
							<span class="nav-choice-text">
								<strong>{choice.label}</strong>
								<span class="fine-print">{choice.note}</span>
							</span>
						</label>
					{/each}
				</form>
				<!-- Errors only. There was a "Saved ✓" here, and it was the one
				     confirmation in this card that had nothing to confirm: the choice
				     saves on change, the pill you just pressed is already lit, and the
				     nav itself moves. A receipt for something you can see happen is
				     just a line that appears and then sits there. -->
				{#if form?.action === 'nav' && form?.message}
					<p class="err">{form.message}</p>
				{/if}
			</section>

			<!-- Where a finished job gets reviewed.
			     
			     The links are the contractor's because only they can produce them:
			     every one of these platforms hands out a different URL per business,
			     found in a different corner of a different dashboard. The app cannot
			     guess them, so it asks once and then does the asking on every job
			     that completes — which is the part a contractor otherwise has to
			     remember to do by hand, at the exact moment they are least likely to
			     (the work is done and they are already on the next site).
			     
			     Blank is off. A platform with no link is simply not offered, so the
			     card doubles as the on/off switch and there is nothing to explain
			     about the difference between "empty" and "disabled". -->
			<section class="card">
				<h2>Reviews</h2>
				<p class="hint">
					When you mark a job complete, your customer is offered these links from their portal.
					{#if configuredReviews === 0}
						Add at least one to start asking.
					{:else}
						Offering {configuredReviews}
						{configuredReviews === 1 ? 'platform' : 'platforms'}. Clear a box to stop offering it.
					{/if}
				</p>

				<ul class="reviews">
					{#each REVIEW_PLATFORMS as platform (platform.id)}
						<li class="review">
							<!-- One form per platform. Eight independent facts, edited one at a
							     time — a single save-everything form would make a typo in one
							     a reason for the other seven not to be written.
							     
							     `&tab=workspace` on the action, because a form posts to
							     `?/saveReviewLink` and that REPLACES the query string. With JS the
							     enhanced fetch never navigates and it does not matter; without it
							     the browser lands on `/contractor/settings?/saveReviewLink`, which
							     has no `tab` — so saving a link bounced you to the Account tab.
							     The tabs are plain links specifically so this page works with JS
							     off, and a form that breaks that undoes it. -->
							<form
								method="POST"
								action="?/saveReviewLink&tab=workspace"
								use:enhance={() =>
									async ({ result, update }) => {
										await update({ reset: false });
										if (result.type === 'success') reviewSaved = platform.id;
									}}
								class="review-form"
								data-platform={platform.id}
							>
								<input type="hidden" name="platform" value={platform.id} />
								<label class="review-label" for="review-{platform.id}">
									<span class="review-name">{platform.label}</span>
									<span class="fine-print">{platform.hint}</span>
								</label>
								<div class="review-row">
									<input
										id="review-{platform.id}"
										class="field-input"
										name="url"
										type="url"
										inputmode="url"
										autocomplete="off"
										spellcheck="false"
										maxlength={MAX_REVIEW_URL}
										placeholder={platform.example}
										bind:value={reviewUrls[platform.id]}
										oninput={() => (reviewSaved = null)}
									/>
									<button type="submit" class="cta ghost review-save">Save</button>
								</div>
								{#if reviewErr(platform.id)}
									<p class="err">{reviewErr(platform.id)}</p>
								{:else if reviewSaved === platform.id}
									<p class="ok">Saved ✓</p>
								{/if}
							</form>
						</li>
					{/each}
				</ul>
			</section>

			<!-- How long "follow up" means. One number, so it saves on change like the
			     nav switch rather than behind a button of its own. -->
			<section class="card">
				<h2>Follow-ups</h2>
				<p class="hint">
					How far ahead a new follow-up is set when you snooze one without picking a date.
				</p>
				<form method="POST" action="?/saveFollowUp" use:enhance={keepFields} class="followup">
					<label class="field">
						<span>Default follow-up</span>
						<select
							name="followUpDays"
							bind:value={followUpDays}
							onchange={(e) => e.currentTarget.form?.requestSubmit()}
						>
							{#each FOLLOWUP_DAY_CHOICES as days (days)}
								<option value={days}>{followUpDaysLabel(days)}</option>
							{/each}
						</select>
					</label>
					{#if form?.saved === 'followUp' && !followUpDirty}<span class="ok">Saved ✓</span>{/if}
				</form>
			</section>
		</div>
	{:else if tab === 'support'}
		<div class="tab-panel">
			<section class="card">
				<h2>Report an issue</h2>
				<p class="hint">
					Something broken, or something missing? This files it with us directly — add a screenshot
					if it helps.
				</p>
				<SupportForm
					configured={data.support.configured}
					captchaSiteKey={data.support.captchaSiteKey}
					form={form?.action === 'support' ? form : null}
					action="?/submitSupport"
				/>
			</section>
		</div>
	{/if}
</div>

<style>
	.wrap {
		max-width: 760px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
		display: grid;
		gap: 1.1rem;
	}
	.head {
		display: grid;
		gap: 0.15rem;
	}

	/* The tab bar: one segmented control in the same idiom as the nav rail — a
	   bordered track of pills with the yellow accent on the current one. It hugs
	   its three labels rather than spanning the column. */
	.tabs {
		display: flex;
		align-items: center;
		justify-self: start;
		max-width: 100%;
		box-sizing: border-box;
		gap: 0.2rem;
		padding: 0.3rem;
		border: 1px solid #d0d7de;
		border-radius: 999px;
		background: #f6f8fa;
		overflow-x: auto;
	}
	.tab {
		flex-shrink: 0;
		padding: 0.45rem 1rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 700;
		text-decoration: none;
		white-space: nowrap;
		color: #57606a;
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}
	.tab:hover {
		color: #1f2328;
		background: rgba(17, 17, 17, 0.05);
	}
	/* Yellow stays light in both themes, so the active label is pinned dark. */
	.tab.on,
	.tab.on:hover {
		background: var(--brand);
		color: var(--on-brand);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
	}
	.tab:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}

	.tab-panel {
		display: grid;
		gap: 1.1rem;
	}

	.card h2 {
		margin: 0 0 0.6rem;
		font-size: 1.05rem;
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.6rem;
	}
	.card-head h2 {
		margin: 0;
	}
	.muted {
		color: #8b949e;
		font-size: 0.82rem;
	}
	.sub {
		margin: 0.9rem 0 0.4rem;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #57606a;
	}

	/* Label/value rows. Grid rather than flex so the values line up down the page,
	   and it collapses to stacked pairs on a phone rather than squeezing. */
	.facts {
		margin: 0;
		display: grid;
		gap: 0.55rem;
	}
	.fact {
		display: grid;
		grid-template-columns: 9.5rem 1fr;
		gap: 0.3rem 0.75rem;
		align-items: baseline;
	}
	.fact dt {
		font-size: 0.82rem;
		color: #57606a;
	}
	.fact dd {
		margin: 0;
		font-size: 0.92rem;
		color: #1f2328;
		overflow-wrap: anywhere;
	}
	@media (max-width: 30rem) {
		.fact {
			grid-template-columns: 1fr;
		}
	}

	.pill {
		display: inline-block;
		padding: 0.1rem 0.45rem;
		border: 1px solid #d0d7de;
		border-radius: 999px;
		background: #f6f8fa;
		color: #57606a;
		font-size: 0.72rem;
		font-weight: 700;
		vertical-align: middle;
	}
	.pill.good {
		background: #eaf6ee;
		border-color: #b7e0c4;
		color: #14532d;
	}
	.pill.warn {
		background: #fff6e0;
		border-color: #f0d9a0;
		color: #7a5600;
	}
	.pill.bad {
		background: #fdeff0;
		border-color: #f0c0c4;
		color: #a40e26;
	}

	.alert {
		margin: 0.7rem 0 0;
		padding: 0.6rem 0.7rem;
		border: 1px solid #f0c0c4;
		border-radius: 10px;
		background: #fdeff0;
		color: #a40e26;
		font-size: 0.86rem;
		line-height: 1.45;
	}
	.note,
	.hint {
		margin: 0.7rem 0 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: #8b949e;
	}
	.hint {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
	}
	/* Quieter than the hint above the control: it answers "what happens to the
	   follow-ups I already have", which only matters once you've changed it. */
	.fine-print {
		margin: 0;
		font-size: 0.78rem;
		color: #8b949e;
		line-height: 1.45;
	}

	.limits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
	}
	.limits li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid #e4e8ee;
		border-radius: 8px;
		background: #f9fafb;
		font-size: 0.86rem;
	}
	.limits li.at-limit {
		border-color: #f0c0c4;
		background: #fdeff0;
		color: #a40e26;
	}
	.limit-label {
		text-transform: capitalize;
	}
	.limit-count {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
	}

	/* Workspace forms */
	.grid {
		display: grid;
		gap: 0.75rem;
	}
	.field {
		display: grid;
		gap: 0.3rem;
	}
	.field > span {
		font-size: 0.8rem;
		font-weight: 600;
		color: #57606a;
	}
	/* App-wide field recipe: hairline border, sunken well, yellow focus ring. */
	.field select {
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--field-border);
		border-radius: 10px;
		font-size: 0.92rem;
		font-family: inherit;
		color: #1f2328;
		background: var(--field-bg);
	}
	.field select:focus {
		outline: none;
		border-color: var(--brand-deep);
		box-shadow: 0 0 0 3px var(--brand-glow);
		background: var(--field-bg-focus);
	}
	/* Both answers to "how should this look" on one row: the light/dark button and
	   the palette picker. They were stacked, which put a heading over a lone
	   control twice and made the palette read as an afterthought under the theme.
	   Wraps rather than shrinks — at a phone width two pills do not fit a line. */
	.appearance-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	/* The radio itself: present for the keyboard and the screen reader, invisible
	   to the eye — the card around it is what shows the choice. Not `display:none`,
	   which would take it out of the tab order and out of the a11y tree. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		border: 0;
		clip-path: inset(50%);
		overflow: hidden;
		white-space: nowrap;
	}

	/* The two nav placements, as picture-and-label cards. Radios underneath, so
	   keyboard and screen readers get a real radio group and the card is only the
	   paint on top of it. */
	.nav-choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.nav-choice {
		flex: 1 1 9rem;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.6rem 0.7rem;
		border: 1.5px solid var(--line);
		border-radius: 12px;
		background: var(--surface-sunken);
		cursor: pointer;
	}
	.nav-choice:hover {
		border-color: var(--line-strong);
	}
	.nav-choice.on {
		border-color: var(--brand);
		background: color-mix(in srgb, var(--brand) 10%, var(--surface));
	}
	.nav-choice:focus-within {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	.nav-choice-text {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
		font-size: 0.85rem;
	}
	/* A phone in miniature: a filled bar at one end, the page at the other. */
	.nav-shot {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 1.7rem;
		height: 2.6rem;
		padding: 2px;
		border: 1px solid var(--line-strong);
		border-radius: 5px;
		background: var(--surface);
	}
	.nav-shot.bottom {
		flex-direction: column-reverse;
	}
	.nav-shot-bar {
		flex: none;
		height: 0.42rem;
		border-radius: 2px;
		background: var(--brand);
		/* Empty and decorative, but the fill and a foreground are never allowed to
		   be separated — the invariant theme.contrast.test.ts enforces. */
		color: var(--on-brand);
	}
	.nav-shot-body {
		flex: 1;
		border-radius: 2px;
		background: var(--surface-sunken);
	}

	.ok {
		color: #1a7f37;
		font-size: 0.85rem;
		font-weight: 600;
	}
	/* The error line's twin. It was being rendered with no rule at all — the nav
	   card has used `class="err"` since it was written, and it came out as plain
	   body text with nothing to say it was a failure. */
	.err {
		margin: 0;
		color: var(--danger);
		font-size: 0.85rem;
		font-weight: 600;
	}

	/* ------------------------------------------------------------- Reviews
	   A list, not a grid: each row is a label, a field and its own Save, and the
	   rows are independent forms. Stacked so the hint under each name has
	   somewhere to sit — these URLs are all found in different places and the
	   hint is doing more work than the label is. */
	.reviews {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.85rem;
	}
	.review-form {
		display: grid;
		gap: 0.3rem;
	}
	.review-label {
		display: grid;
		gap: 0.05rem;
	}
	.review-name {
		font-size: 0.85rem;
		font-weight: 700;
	}
	.review-row {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.review-row .field-input {
		flex: 1;
		min-width: 0;
	}
	.review-save {
		flex: none;
	}
	/* The field wins the width on a phone; the button drops under it rather than
	   squeezing a URL into a third of the screen. */
	@media (max-width: 30rem) {
		.review-row {
			flex-wrap: wrap;
		}
		.review-row .field-input {
			flex-basis: 100%;
		}
	}

	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.9rem;
	}
	.actions.tight {
		margin-top: 0;
	}
	/* Local button styling rather than a global class: this page has a handful of
	   buttons and none belongs to a shared control set. Hairline secondary,
	   borderless yellow primary — the app's modern button language. */
	.btn {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--line-strong);
		border-radius: 10px;
		background: var(--surface);
		color: var(--fg);
		font-size: 0.86rem;
		font-weight: 700;
		font-family: inherit;
		text-decoration: none;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.btn.primary {
		background: var(--brand);
		color: var(--on-brand);
		border-color: transparent;
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--brand-deep);
	}
	.btn.danger {
		border-color: #cf222e;
		color: #cf222e;
	}
	.btn.danger:hover {
		background: #cf222e;
		color: #fff;
	}
	/* Nothing to commit → the accent drains and the button goes flat and dashed, so
	   "inert" is obvious at a glance. Listed per-variant so it outranks .btn.primary
	   instead of losing on specificity. */
	.btn:disabled,
	.btn.primary:disabled {
		cursor: not-allowed;
		background: transparent;
		color: #8b949e;
		border-color: #d0d7de;
		border-style: dashed;
	}

	/* Dark theme. Tokens where they exist; the pills carry their own pairs because
	   their light values are hand-picked rather than token-derived. Interactive
	   pieces carve out .on / :disabled so a bare dark override can't outrank the
	   state rules on specificity. */
	:global(:root[data-theme='dark']) .note,
	:global(:root[data-theme='dark']) .hint,
	:global(:root[data-theme='dark']) .fine-print,
	:global(:root[data-theme='dark']) .muted {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .tabs {
		background: var(--surface-sunken);
		border-color: var(--line-strong);
	}
	:global(:root[data-theme='dark']) .tab:not(.on) {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .tab:not(.on):hover {
		color: var(--fg);
		background: rgba(255, 255, 255, 0.07);
	}
	:global(:root[data-theme='dark']) .fact dt,
	:global(:root[data-theme='dark']) .sub,
	:global(:root[data-theme='dark']) .field > span {
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .fact dd {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .pill {
		background: var(--surface-sunken);
		border-color: var(--line-strong);
		color: var(--fg-muted);
	}
	:global(:root[data-theme='dark']) .pill.good {
		background: #14301f;
		border-color: #2f6b45;
		color: #b7ecc6;
	}
	:global(:root[data-theme='dark']) .pill.warn {
		background: #38300f;
		border-color: #7a6a2a;
		color: #f3dfa0;
	}
	:global(:root[data-theme='dark']) .pill.bad,
	:global(:root[data-theme='dark']) .alert {
		background: #3a1f24;
		border-color: #7a3540;
		color: #ffbcc4;
	}
	:global(:root[data-theme='dark']) .limits li {
		background: var(--surface-sunken);
		border-color: var(--line);
	}
	:global(:root[data-theme='dark']) .limits li.at-limit {
		background: #3a1f24;
		border-color: #7a3540;
		color: #ffbcc4;
	}
	/* Fields and base buttons are token-driven above; only the field's text color
	   needs dark. Kept off border/background so the focus ring can't be outranked. */
	:global(:root[data-theme='dark']) .field select {
		color: var(--fg);
	}
	:global(:root[data-theme='dark']) .ok {
		color: #4ac26b;
	}
	:global(:root[data-theme='dark']) .btn:disabled,
	:global(:root[data-theme='dark']) .btn.primary:disabled {
		background: transparent;
		color: var(--fg-muted);
		border-color: var(--line);
	}
	:global(:root[data-theme='dark']) .btn.danger:not(:disabled) {
		background: transparent;
		border-color: #f85149;
		color: #ff9a94;
	}
	:global(:root[data-theme='dark']) .btn.danger:hover:not(:disabled) {
		background: #cf222e;
		color: #fff;
	}
</style>
