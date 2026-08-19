<script lang="ts">
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

	const { profile, account, limits, integrations } = $derived(data);

	// Tabs are URL-driven (?tab=email) rather than component state: each label is a
	// plain link, so tabs deep-link, survive reloads, respect back/forward, and still
	// switch with JS disabled. Billing is deliberately not here — it stays its own
	// route, reached from the Account tab's CTA and the nav's account menus.
	const TABS = [
		{ id: 'account', label: 'Account' },
		{ id: 'email', label: 'Email' },
		{ id: 'workspace', label: 'Workspace' }
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

	let followUpDays = $state(untrack(() => data.followUpDays));
	const followUpDirty = $derived(followUpDays !== data.followUpDays);

	// Which tag is awaiting delete confirmation.
	let confirmingTag = $state<string | null>(null);
</script>

<svelte:head><title>Settings</title></svelte:head>

<div class="wrap">
	<div class="head">
		<h1 class="page-title">Settings</h1>
		<p class="head-sub">Your account, email setup and workspace preferences.</p>
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
				<p class="note">
					Your name and email come from the account you signed in with. The business name is what
					customers see on email you send.
				</p>
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
	{:else}
		<div class="tab-panel">
			<!-- Default follow-up interval. Applies to orders created from here on: the
			     follow-ups already on the dashboard may have been moved by hand. -->
			<section class="card">
				<h2>Follow-up reminders</h2>
				<p class="hint">
					Your follow-up cadence. A new order schedules a reminder this far out, and
					<strong>getting in touch resets it</strong> — send an update, an email or a reply and that job
					drops off your list for another interval. When one comes due it appears at the top of your dashboard,
					and you can always snooze or re-date a single order from the order itself.
				</p>
				<form method="POST" action="?/saveFollowUpDays" use:enhance={keepFields} class="grid">
					<label class="field">
						<span>Remind me after</span>
						<select name="followUpDays" bind:value={followUpDays}>
							{#each FOLLOWUP_DAY_CHOICES as days (days)}
								<option value={days}>{followUpDaysLabel(days)}</option>
							{/each}
						</select>
					</label>
					<div class="actions tight">
						<button
							type="submit"
							class="btn primary"
							disabled={!followUpDirty}
							title={followUpDirty ? 'Save interval' : 'No changes to save'}>Save interval</button
						>
						{#if form?.saved === 'followUp' && !followUpDirty}<span class="ok">Saved ✓</span>{/if}
					</div>
					<p class="fine-print">
						Changing this leaves follow-ups already scheduled where they are — only new orders use
						the new interval.
					</p>
				</form>
			</section>

			<!-- Tags. The vocabulary is derived from what's actually in use, so retiring
			     one means stripping it off every record that carries it — which is why
			     it asks. -->
			<section class="card">
				<h2>Tags</h2>
				{#if data.contractorTags.length === 0}
					<p class="hint">
						No tags yet. Add them on an order or subcontractor and they'll collect here.
					</p>
				{:else}
					<p class="hint">
						Used across your orders and subcontractors. Deleting one removes it from every record
						that uses it.
					</p>
					<ul class="tag-list">
						{#each data.contractorTags as tag (tag)}
							<li>
								<span class="tag-name">{tag}</span>
								{#if confirmingTag === tag}
									<form
										method="POST"
										action="?/deleteTag"
										use:enhance={() =>
											async ({ update }) => {
												confirmingTag = null;
												await update();
											}}
									>
										<input type="hidden" name="tag" value={tag} />
										<button type="submit" class="tag-yes">Delete everywhere</button>
									</form>
									<button type="button" class="tag-no" onclick={() => (confirmingTag = null)}
										>Cancel</button
									>
								{:else}
									<button
										type="button"
										class="tag-del"
										aria-label={`Delete tag ${tag}`}
										onclick={() => (confirmingTag = tag)}>Delete</button
									>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- What this deployment can actually do. Answers "why is there no send
			     button" without anyone having to read the server config. -->
			<section class="card">
				<h2>This installation</h2>
				<dl class="facts">
					<div class="fact">
						<dt>Email sending</dt>
						<dd>
							{#if integrations.emailDevTools}
								<span class="pill warn">Simulation</span>
								<span class="muted">No real email leaves this server.</span>
							{:else if integrations.emailSending}
								<span class="pill good">On</span>
								<span class="muted">Messages are sent by the app.</span>
							{:else}
								<span class="pill">Off</span>
								<span class="muted">Messages open in your own mail client instead.</span>
							{/if}
						</dd>
					</div>
					<div class="fact">
						<dt>Online payments</dt>
						<dd>
							{#if integrations.billing}
								<span class="pill good">On</span>
							{:else}
								<span class="pill">Off</span>
								<span class="muted">Checkout is unavailable on this install.</span>
							{/if}
						</dd>
					</div>
					{#if integrations.emailDevTools}
						<div class="fact">
							<dt>Email dev tools</dt>
							<dd>
								<span class="pill warn">On</span>
								<span class="muted">
									The composer simulates sends and real sending is disabled. Unset
									<code>EMAIL_DEV_TOOLS</code> and restart to send for real.
								</span>
							</dd>
						</div>
					{/if}
				</dl>
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
	.head-sub {
		margin: 0;
		font-size: 0.88rem;
		color: #8b949e;
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
		background: var(--yellow);
		color: var(--on-yellow);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
	}
	.tab:focus-visible {
		outline: 2px solid var(--yellow);
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
		border-color: var(--yellow-deep);
		box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.22);
		background: var(--field-bg-focus);
	}
	.ok {
		color: #1a7f37;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.tag-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
	}
	.tag-list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-sunken);
	}
	.tag-name {
		flex: 1;
		min-width: 0;
		font-size: 0.85rem;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.tag-del,
	.tag-no {
		border: none;
		background: none;
		padding: 0.2rem 0.4rem;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
	}
	.tag-del:hover {
		color: var(--danger);
	}
	.tag-no:hover {
		color: var(--fg);
	}
	.tag-yes {
		border: 1px solid var(--danger);
		background: var(--danger);
		color: #fff;
		border-radius: 999px;
		padding: 0.25rem 0.7rem;
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
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
		background: var(--yellow);
		color: var(--on-yellow);
		border-color: transparent;
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--yellow-deep);
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
	:global(:root[data-theme='dark']) .head-sub,
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
