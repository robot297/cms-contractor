<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { ORDER_ICONS, followUpLabel, followUpUrgency, portalInfoFor } from '$lib/crm';
	import ContactPanel from '$lib/ContactPanel.svelte';
	import Guide from '$lib/Guide.svelte';
	import TrialNotice from '$lib/TrialNotice.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Trial state comes from the contractor layout. Only shown while a trial is
	// actually live — a paid or comped subscription has nothing to say here.
	const onTrial = $derived(
		data.billing.status === 'trialing' && data.billing.canWrite && !data.trialNoticeDismissed
	);

	// The server decides whether the guide starts open (nothing due, still something
	// to learn, not dismissed); the header button overrides that for this visit.
	// Derived rather than seeded state, so the server's answer stays live across
	// navigations until the contractor actually clicks.
	let openOverride = $state<boolean | null>(null);
	const guideOpen = $derived(openOverride ?? data.guideOpen);

	// The caught-up greeting names the day. Seeded during render so the server has
	// something to send, then re-read on mount: the day that matters is the one in
	// the contractor's timezone, not the server's.
	const weekday = () => new Date().toLocaleDateString('en-US', { weekday: 'long' });
	let today = $state(weekday());
	// Same reason as `today`: whether a follow-up counts as overdue or as due
	// today is decided by the calendar day where the CONTRACTOR is, not where the
	// server is. Seeded for the server render, then re-read once the browser can
	// answer for itself.
	let now = $state(new Date());
	onMount(() => {
		today = weekday();
		now = new Date();
	});

	// Which due card's contact panel is open. Which TAB it opens on is the panel's
	// own business now — it knows which channels this customer can be reached on.
	let contactOpenId: string | null = $state(null);

	// Which due card's construction-icon picker is open.
	let iconPickerId: string | null = $state(null);
	// Close the icon picker once a choice is submitted.
	const pickIconThenClose =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			iconPickerId = null;
			await update();
		};

	/**
	 * Bring a just-opened popover fully into view.
	 *
	 * Anchored popovers are positioned relative to their button, which says
	 * nothing about whether the result is on screen — a card low in the list opens
	 * one that runs off the bottom. Measured after a frame so the height includes
	 * the thread that has just rendered inside it.
	 */
	function revealPopover(node: HTMLElement) {
		requestAnimationFrame(() => node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
	}

	// Sizing only — the gold look comes from the shared `.icon-btn` class.
	const iconBtn = 'width: 2.3rem; height: 2.3rem; font-size: 1.55rem;';
</script>

<svelte:head>
	<title>Contractor dashboard</title>
</svelte:head>

<div style="max-width: 860px; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem;">
	<header
		style="display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap;"
	>
		<h1 class="page-title" style="margin: 0;">Dashboard</h1>
		<span class="header-right">
			<!-- Opens the checklist on demand. Subtle by design: most days there is
			     nothing to learn and this should read as a footnote, not a feature. -->
			<button
				type="button"
				class="icon-btn guide-btn"
				aria-expanded={guideOpen}
				aria-label={guideOpen ? 'Hide getting started' : 'Show getting started'}
				title="Getting started"
				onclick={() => (openOverride = !guideOpen)}>?</button
			>
		</span>
	</header>

	{#if onTrial}
		<TrialNotice limits={data.billing.limits} />
	{/if}

	{#if guideOpen}
		<Guide guide={data.guide} onclose={() => (openOverride = false)} />
	{/if}

	<!-- ONE list. Everything here is waiting on the contractor; whether it got here
	     because of a follow-up they set or a customer who wrote in is a property of
	     the row, not a reason for a second section. The split version showed an
	     order that was both overdue AND unanswered twice, in two different visual
	     languages, which is what gave the game away. -->
	<section class="attention">
		{#if data.attention.length === 0}
			{#if !guideOpen}
				<div class="caught-up">Happy {today} — you are all caught up!</div>
			{/if}
		{:else}
			<h2 class="attention-head">
				Due today
				<span class="count-badge">{data.attention.length}</span>
			</h2>

			{#each data.attention as o (o.id)}
				{@const urgency = followUpUrgency(o.nextFollowUpAt, now)}
				{@const overdue = o.followUpDue && urgency === 'overdue'}
				<div class="due-card card" class:is-overdue={overdue} class:is-owed={o.pending > 0}>
					<div class="due-top">
						<!-- Settable construction icon -->
						<div style="position: relative; flex-shrink: 0;">
							<button
								type="button"
								class="icon-btn icon-bubble"
								class:dim={!o.icon}
								title="Set order icon"
								aria-label="Set order icon"
								aria-expanded={iconPickerId === o.id}
								onclick={() => (iconPickerId = iconPickerId === o.id ? null : o.id)}
								>{o.icon ?? '🏗️'}</button
							>
							{#if iconPickerId === o.id}
								<!-- click-away backdrop -->
								<button
									type="button"
									aria-label="Close icon picker"
									onclick={() => (iconPickerId = null)}
									style="position: fixed; inset: 0; z-index: 10; background: transparent; border: none; cursor: default;"
								></button>
								<form
									method="POST"
									action="?/setOrderIcon"
									use:enhance={pickIconThenClose}
									class="icon-picker"
								>
									<input type="hidden" name="orderId" value={o.id} />
									{#each ORDER_ICONS as ic (ic)}
										<button
											type="submit"
											name="icon"
											value={ic}
											title={ic}
											class="icon-choice"
											class:on={o.icon === ic}>{ic}</button
										>
									{/each}
									{#if o.icon}
										<button type="submit" name="icon" value="" class="icon-clear">Clear icon</button
										>
									{/if}
								</form>
							{/if}
						</div>

						<div class="due-text">
							<strong class="due-name">{o.customerName}</strong>
							<div class="due-project">{o.projectName ?? 'Untitled project'}</div>
						</div>

						<!-- Why this card is here. Unanswered messages are NOT stated here:
						     the count on the 💬 already says it, and saying it twice cost a
						     line of vertical space per card to tell you something you were
						     about to read anyway. -->
						<div class="due-meta">
							{#if o.followUpDue}
								<span class="due-flag" class:overdue={urgency === 'overdue'}>
									{followUpLabel(o.nextFollowUpAt, now)}
								</span>
							{/if}
						</div>
					</div>

					<!-- Where the job is, sharing the action row rather than claiming a
					     line of its own. The row had empty space on the left and the
					     location is a fact you glance at, not one you act on. -->
					<div class="due-actions">
						{#if o.customerLocation}
							<span class="due-loc"><span aria-hidden="true">📍</span>{o.customerLocation}</span>
						{/if}
						<a
							href={resolve(`/contractor/orders/${o.id}`)}
							title="View order details"
							aria-label="View order details"
							class="icon-btn"
							style="{iconBtn} flex-shrink: 0; text-decoration: none;">📋</a
						>

						<!-- Snoozing a follow-up lives on the order detail page now, next to
						     everything else about the date — the dashboard card is for acting
						     on what's due, not rescheduling it. -->

						<div style="position: relative; flex-shrink: 0;">
							<button
								type="button"
								title="Message {o.customerName}"
								aria-label="Message {o.customerName}"
								aria-expanded={contactOpenId === o.id}
								onclick={() => (contactOpenId = contactOpenId === o.id ? null : o.id)}
								class="icon-btn"
								style={iconBtn}
								>💬{#if o.pending > 0}<span class="btn-count" aria-hidden="true">{o.pending}</span
									>{/if}</button
							>
							{#if contactOpenId === o.id}
								<button
									type="button"
									aria-label="Close contact menu"
									onclick={() => (contactOpenId = null)}
									class="contact-scrim"
								></button>
								<!-- Opens DOWNWARD: this panel carries a conversation, and opening a
								     tall box upward from a card near the top of the page put its
								     newest message — the thing it exists to show — above the top of
								     the screen. -->
								<!-- The conversation IS this panel. Email, text and call are real
								     options but they are the exceptions — they used to sit open
								     below the thread, which made a chat window look like a form
								     with a chat stuck on top of it. Behind a toggle they cost one
								     click and stop competing. -->
								<div class="contact-pop wide" {@attach revealPopover}>
									<ContactPanel
										contact={{
											name: o.customerName,
											email: o.customerEmail,
											phone: o.customerPhone,
											preferredContact: o.customerPreferredContact
										}}
										project={o.projectName ?? ''}
										orderId={o.id}
										conversations={[
											{ orderId: o.id, projectName: o.projectName, thread: o.thread }
										]}
										canChat={o.customerLinked}
										customerId={o.customerId}
										portal={portalInfoFor({
											linked: o.customerLinked,
											customerId: o.customerId,
											invites: data.invites
										})}
										onsent={() => (contactOpenId = null)}
										onclose={() => (contactOpenId = null)}
									/>
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		{/if}
	</section>

	<!-- What is coming, kept out of the list above. Everything up there needs the
	     contractor today; folding next week's follow-ups in with it is how a
	     to-do list stops being believed. Collapsed, because it is a glance
	     forward rather than work. -->
	{#if data.soon.length > 0}
		<details class="soon">
			<summary>
				Due soon
				<span class="soon-count">{data.soon.length}</span>
			</summary>
			<ul class="soon-list">
				{#each data.soon as o (o.id)}
					<li>
						<a class="soon-row" href={resolve(`/contractor/orders/${o.id}`)}>
							<span class="soon-icon" aria-hidden="true">{o.icon ?? '🏗️'}</span>
							<span class="soon-text">
								<span class="soon-name">{o.customerName}</span>
								<span class="soon-project">{o.projectName ?? 'Untitled project'}</span>
							</span>
							<span class="soon-when">{followUpLabel(o.nextFollowUpAt, now)}</span>
						</a>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>

<style>
	.header-right {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	/* Small round "?" beside the follow-up count. Sizing only — the pressable feel
	   comes from the global .icon-btn. */
	.guide-btn {
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 800;
		color: var(--fg-muted);
	}

	/* Follow-up card: an info band over an action band. Overrides the shared
	   `.card` grid gap — the two bands sit closer than card-level spacing. */
	/* --------------------------------------------------------- Needs you
	   One feed. Everything below is something the contractor has to act on. */
	.attention {
		display: grid;
		gap: 0.6rem;
	}
	.attention-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.1rem;
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}
	/* Due soon. Deliberately quieter than the cards above — a summary line and a
	   list of rows, not a stack of things demanding action. */
	.soon > summary {
		list-style: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.15rem 0;
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}
	.soon > summary::-webkit-details-marker {
		display: none;
	}
	.soon > summary::before {
		content: '▸';
		display: inline-block;
		transition: transform 0.15s ease;
	}
	.soon[open] > summary::before {
		transform: rotate(90deg);
	}
	.soon > summary:hover {
		color: var(--fg);
	}
	.soon-count {
		display: inline-grid;
		place-items: center;
		min-width: 1.2rem;
		height: 1.2rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg-muted);
		font-size: 0.68rem;
		letter-spacing: normal;
	}
	.soon-list {
		margin: 0.4rem 0 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--line);
		border-radius: 12px;
		overflow: hidden;
		background: var(--surface);
	}
	.soon-list li + li {
		border-top: 1px solid var(--line);
	}
	.soon-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.55rem 0.8rem;
		text-decoration: none;
		color: inherit;
	}
	.soon-row:hover {
		background: var(--surface-sunken);
	}
	.soon-icon {
		font-size: 1.05rem;
		flex: none;
	}
	.soon-text {
		flex: 1;
		min-width: 0;
		display: grid;
	}
	.soon-name {
		font-size: 0.88rem;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.soon-project {
		font-size: 0.76rem;
		color: var(--fg-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.soon-when {
		flex: none;
		font-size: 0.74rem;
		color: var(--fg-muted);
		white-space: nowrap;
	}
	@media (prefers-reduced-motion: reduce) {
		.soon > summary::before {
			transition: none;
		}
	}

	.caught-up {
		border: 1px solid var(--line);
		background: var(--surface-sunken);
		border-radius: 16px;
		padding: 1.25rem;
		text-align: center;
		color: var(--fg-muted);
	}

	/* Order-icon picker. Was a wall of inline style; as a class it can use the theme
	   tokens, which is what it always needed — the hardcoded #fff panel was
	   invisible-on-invisible in dark mode. */
	.icon-picker {
		position: absolute;
		left: 0;
		top: calc(100% + 6px);
		z-index: 20;
		width: 13.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
		padding: 0.5rem;
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		background: var(--surface);
		box-shadow: var(--pop-shadow-sm);
	}
	.icon-choice {
		width: 2.4rem;
		height: 2.4rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 10px;
		background: none;
		cursor: pointer;
		font-size: 1.3rem;
		line-height: 1;
	}
	.icon-choice:hover {
		background: var(--surface-sunken);
	}
	.icon-choice.on {
		border-color: var(--yellow-deep);
		background: var(--yellow);
		/* Pinned dark: yellow stays light in both themes, so an inherited colour
		   flips to near-white on it. */
		color: var(--on-yellow);
	}
	.icon-clear {
		width: 100%;
		margin-top: 0.25rem;
		padding: 0.4rem;
		border: 1px solid var(--line-strong);
		border-radius: 8px;
		background: var(--surface-sunken);
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.82rem;
		text-transform: none;
		letter-spacing: normal;
		cursor: pointer;
	}
	.due-card {
		display: grid;
		gap: 0.5rem;
		/* Transparent by default so the overdue variant can colour it without the
		   card's contents shifting sideways when it does. */
		border-left: 4px solid transparent;
	}
	/* The second carrier of the same signal. A row of cards that differ only by a
	   small pill is a row you have to read; an edge is something you can scan.
	   Overdue wins the edge when a card is both: late is the older problem. */
	.due-card.is-owed {
		border-left-color: var(--yellow-deep);
	}
	.due-card.is-overdue {
		border-left-color: var(--danger);
	}
	.due-top {
		display: flex;
		align-items: flex-start;
		gap: 0.9rem;
	}
	.due-text {
		flex: 1;
		min-width: 0;
	}
	.due-name {
		font-size: 1rem;
	}
	.due-project {
		font-size: 0.85rem;
		color: var(--fg-muted);
	}
	/* Right-hand facts column. Right-aligned so it reads as one edge with the
	   action row beneath it. */
	.due-meta {
		flex-shrink: 0;
		display: grid;
		justify-items: end;
		gap: 0.25rem;
		text-align: right;
	}
	/* Due today: the brand accent, because it is the work, not a fault — the same
	   rule app.css states for the unanswered-message badge. Overdue escalates to
	   --danger, which is reserved for exactly this kind of "something has gone
	   wrong" signal. Tokens rather than the hex literals this used to carry, so
	   both survive dark mode. */
	.due-flag {
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.01em;
		color: var(--on-yellow);
		background: var(--yellow);
		border: 1px solid var(--yellow-deep);
		border-radius: 999px;
		padding: 0.1rem 0.55rem;
		white-space: nowrap;
	}
	.due-flag.overdue {
		color: #fff;
		background: var(--danger);
		border-color: var(--danger);
	}
	/* How many are unanswered, on the button that opens them. This replaced a
	   "2 messages waiting" pill on the card: the pill and the dot were the same
	   fact twice, and the pill was the one costing a line of height. */
	/* The shared .icon-btn is not positioned, so the badge needs an anchor. Scoped
	   here rather than added to the global class — nothing else pins anything to
	   an icon button, and giving every one of them a stacking context to serve one
	   badge is the kind of change that surfaces somewhere unrelated. */
	.due-actions .icon-btn {
		position: relative;
		overflow: visible;
	}
	.btn-count {
		position: absolute;
		top: -0.2rem;
		right: -0.2rem;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 0.22rem;
		box-sizing: border-box;
		display: grid;
		place-items: center;
		border-radius: 999px;
		border: 2px solid var(--surface);
		background: var(--danger);
		color: #fff;
		font-size: 0.66rem;
		font-weight: 800;
		line-height: 1;
	}

	.due-loc {
		font-size: 0.8rem;
		color: #8c959f;
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		white-space: nowrap;
	}
	/* The action row. These are three unrelated destinations — open the job,
	   push the date, start a conversation — and at a 0.4rem gap they read as one
	   segmented control and are easy to mis-tap on a phone. */
	.due-actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 0.85rem;
		padding-top: 0.15rem;
	}
	/* Pushes the buttons to the right and takes the slack itself, so a long
	   location truncates instead of shoving them off the edge. */
	.due-actions .due-loc {
		margin-right: auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* The settable order-icon "avatar" is a round icon button: the raised/pressable
	   feel comes from the global .icon-btn; this only makes it round + sized. */
	.icon-bubble {
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 999px;
		font-size: 1.6rem;
	}
	.icon-bubble.dim {
		opacity: 0.55;
	}

	/* Mobile used to hide this pill on the grounds that it was redundant — every
	   card in this list is due, so "Needs update" told you nothing the section
	   heading hadn't. It now says WHICH kind of due and how late, which is the one
	   thing worth keeping when the row is narrow, so it stays and only tightens. */
	@media (max-width: 560px) {
		.due-flag {
			font-size: 0.68rem;
			padding: 0.1rem 0.45rem;
		}
	}
</style>
