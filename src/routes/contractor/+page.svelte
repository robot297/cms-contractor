<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { followUpLabel, followUpUrgency, portalInfoFor, PROJECT_TYPES } from '$lib/crm';
	import { toast } from '$lib/toast.svelte';
	import ContactDialog from '$lib/ContactDialog.svelte';
	import OrderCard from '$lib/OrderCard.svelte';
	import Guide from '$lib/Guide.svelte';
	import TrialNotice from '$lib/TrialNotice.svelte';
	import WeatherWidget from '$lib/WeatherWidget.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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

	// ------------------------------------------------------- First job
	// The getting-started card's one action. A customer and their first job in
	// one dialog, on this page — it used to be two steps across two screens, and
	// getting a single job into the app meant crossing four of them.
	let firstJobDialog: HTMLDialogElement | undefined = $state();
	/** Empty means "a new customer", and the name/email fields show. */
	let firstJobCustomerId = $state('');
	let firstJobType = $state('');

	function openFirstJob() {
		firstJobCustomerId = '';
		firstJobType = '';
		firstJobDialog?.showModal();
	}

	// ------------------------------------------------------- Snooze
	// Swipe-to-snooze posts through ONE form rather than a form per card. Twenty
	// cards meant twenty forms carrying an identical action and a single hidden
	// field, and the gesture can only be running on one card at a time — so the
	// card being acted on is state, and the form is furniture.
	let snoozeForm: HTMLFormElement | undefined = $state();
	let snoozeOrderId = $state('');
	/** Named in the confirmation, so it says which job just moved. */
	let snoozeProject = $state('');

	async function snooze(order: { id: string; projectName: string | null }) {
		snoozeOrderId = order.id;
		snoozeProject = order.projectName ?? 'Untitled project';
		// The hidden field is bound, so the DOM has to catch up with the assignment
		// above before the form is worth submitting.
		await tick();
		snoozeForm?.requestSubmit();
	}

	// Which due card's contact panel is open. Which TAB it opens on is the panel's
	// own business now — it knows which channels this customer can be reached on.
	let contactOpenId: string | null = $state(null);
</script>

<svelte:head>
	<title>Contractor dashboard</title>
</svelte:head>

<!-- The dashboard is a two-column layout from ~1100px up and a single stack
     below it, and the DOM order is the reading order at every width: today's work
     first, the numbers about it after. Nothing is visually reordered, so what a
     screen reader hears and what the tab key visits match what is on screen. -->
<div class="page-shell dash">
	<!-- No "?" here any more. The checklist opens itself while there is something
	     on it to do, and once it has been dismissed a permanent question mark on
	     the busiest screen in the app is a control almost nobody presses twice.
	     Bringing it back lives on the settings page. -->
	<header class="dash-head">
		<h1 class="page-title" style="margin: 0;">Dashboard</h1>
	</header>

	{#if onTrial || guideOpen}
		<div class="dash-notices">
			{#if onTrial}
				<TrialNotice limits={data.billing.limits} />
			{/if}
			{#if guideOpen}
				<Guide guide={data.guide} onclose={() => (openOverride = false)} onstart={openFirstJob} />
			{/if}
		</div>
	{/if}

	<!-- THE DAY. First thing on the page because it is the only band that is about
	     the next few hours rather than about the backlog: where the crew is going,
	     and whether the sky will let them work when they get there. Those two are
	     one question, so the forecast sits in the corner across from the heading
	     rather than as a panel of its own — it is a fact about the day, not a
	     second thing to read.

	     Either half can be absent: no visits booked, or a forecast that never
	     landed. The band hides itself when both are. -->
	<div class="dash-day">
		{#if data.visits.length > 0}
			<section class="today dash-today" aria-labelledby="today-head">
				<div class="today-head">
					<h2 id="today-head">
						Today's jobs
						<span class="count-badge">{data.visits.length}</span>
					</h2>
					<!-- Renders nothing at all until its own fetch lands, and nothing ever
					     if there is no work area to forecast for or the upstream is down. -->
					<WeatherWidget zip={data.weatherZip} />
				</div>

				<ol class="today-list">
					{#each data.visits as visit, i (visit.id)}
						<li class="today-stop">
							<span class="today-num" aria-hidden="true">{i + 1}</span>
							<div class="today-body">
								<a class="today-name" href={resolve(`/contractor/orders/${visit.id}`)}>
									{visit.projectName ?? 'Untitled project'}
								</a>
								<span class="today-who">{visit.customerName}</span>
								{#if visit.siteLabel}
									<span class="today-where">{visit.siteLabel}</span>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
			</section>
		{:else}
			<!-- Nothing booked, so there is no heading to sit across from — but the
			     day's sky is still worth a glance, and it keeps its corner. -->
			<WeatherWidget zip={data.weatherZip} />
		{/if}
	</div>

	<!-- ONE list. Everything here is waiting on the contractor; whether it got here
	     because of a follow-up they set or a customer who wrote in is a property of
	     the row, not a reason for a second section. The split version showed an
	     order that was both overdue AND unanswered twice, in two different visual
	     languages, which is what gave the game away. -->
	<section class="attention dash-feed">
		{#if data.attention.length === 0}
			{#if !guideOpen}
				<div class="caught-up">Happy {today} — you are all caught up!</div>
			{/if}
		{:else}
			<!-- Not "Due today": this list carries overdue follow-ups and unanswered
			     messages too, and a heading that named only today's work made the
			     late ones look like they had been filed under the wrong day. What
			     every row here has in common is that the contractor owes a reply. -->
			<h2 class="attention-head">
				Response needed
				<span class="count-badge">{data.attention.length}</span>
			</h2>

			<!-- A GRID, not a column. One card per row left two thirds of a desktop as
			     empty paper and made a working week look like a scroll; the orders list
			     already flows into as many columns as the viewport holds, and this is
			     the same card doing the same job. -->
			<div class="due-list card-grid">
				{#each data.attention as o (o.id)}
					{@const urgency = followUpUrgency(o.nextFollowUpAt, now)}
					{@const overdue = o.followUpDue && urgency === 'overdue'}
					{@const dueToday = o.followUpDue && urgency === 'today'}
					<OrderCard
						orderId={o.id}
						projectName={o.projectName}
						customerName={o.customerName}
						location={o.customerLocation}
						tone={overdue ? 'overdue' : o.pending > 0 ? 'owed' : dueToday ? 'due' : null}
						onsnooze={() => snooze(o)}
						onswipestart={() => (contactOpenId = null)}
					>
						{#snippet actions()}
							<!-- Message is the one control on the card. The "View order" button
						     that used to sit beside it is gone — the card itself is the link
						     now — and it lifts above the stretched link so a press on it
						     opens the conversation rather than navigating. -->
							<div class="above-stretch">
								<button
									type="button"
									title="Message {o.customerName}"
									aria-label="Message {o.customerName}"
									aria-expanded={contactOpenId === o.id}
									onclick={() => (contactOpenId = contactOpenId === o.id ? null : o.id)}
									class="card-btn"
								>
									<span aria-hidden="true">💬</span>
									<!-- Always "Message", never "Reply (2)". The count is the badge's job,
								     and a label that changes with it stops being a prefix of the
								     accessible name — which is what keeps the visible words and the
								     announced ones in step (WCAG 2.5.3). -->
									<span class="card-btn-label">Message</span>
									{#if o.pending > 0}
										<span class="btn-count" aria-hidden="true">{o.pending}</span>
									{/if}
								</button>
								{#if contactOpenId === o.id}
									<!-- One modal, the same one every surface opens. It used to be an
									     anchored popover that had to be scrolled into view after
									     opening, because a card low in the list opened one that ran
									     off the bottom of the screen. -->
									<ContactDialog
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
								{/if}
							</div>
						{/snippet}
					</OrderCard>
				{/each}
			</div>

			<!-- The swipe's submit. Off-screen rather than hidden, because a form
			     inside the card grid would be a grid item; `requestSubmit()` on it is
			     what the gesture calls. -->
			<form
				bind:this={snoozeForm}
				method="POST"
				action="?/snoozeFollowUp"
				class="sr-only-form"
				use:enhance={() => {
					const project = snoozeProject;
					return async ({ result, update }) => {
						await update();
						if (result.type === 'success') {
							toast.success('Snoozed for a week', {
								detail: `${project} comes back on this list next week.`
							});
						} else {
							toast.error('That could not be snoozed');
						}
					};
				}}
			>
				<input type="hidden" name="orderId" value={snoozeOrderId} />
			</form>
		{/if}
	</section>

	<!-- The rail beside the feed on a wide screen, and the block under it on a
	     narrow one. Context for the work above rather than work itself. The
	     forecast used to lead it and has moved up to the day band. -->
	<aside class="dash-side">
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
								<span class="soon-text">
									<span class="soon-title">{o.projectName ?? 'Untitled project'}</span>
									<span class="soon-sub">{o.customerName}</span>
								</span>
								<span class="soon-when">{followUpLabel(o.nextFollowUpAt, now)}</span>
							</a>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</aside>
</div>

<!-- ------------------------------------------------- First job
     The getting-started card's one action, and the whole of it. A customer and
     the work you are doing for them, created together — this used to be two
     steps on two different pages, which meant four screens to get one job in.

     The customer picker is here because a contractor who added somebody before
     finding this card must not be made to add them twice. With none on file it
     is not rendered at all, and the fields below are the only path. -->
<dialog bind:this={firstJobDialog} class="firstjob">
	<form
		method="POST"
		action="?/createFirstJob"
		use:enhance={() =>
			async ({ result, update }) => {
				await update();
				// A redirect means the job exists and we are on its page already.
				if (result.type === 'redirect') firstJobDialog?.close();
			}}
		class="fj-body"
	>
		<div class="fj-head">
			<h2>Add your first job</h2>
			<button type="button" class="fj-x" aria-label="Close" onclick={() => firstJobDialog?.close()}
				>✕</button
			>
		</div>

		<div class="fj-group">
			<span class="fj-legend">Who it's for</span>
			{#if data.firstJobCustomers.length > 0}
				<label class="fj-field">
					<span>Customer</span>
					<select class="field-input" name="customerId" bind:value={firstJobCustomerId}>
						<option value="">＋ New customer</option>
						{#each data.firstJobCustomers as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</label>
			{/if}
			{#if firstJobCustomerId === ''}
				<div class="fj-row">
					<label class="fj-field">
						<span>Name</span>
						<input class="field-input" name="name" required autocomplete="name" />
					</label>
					<label class="fj-field">
						<span>Email</span>
						<input class="field-input" name="email" type="email" required autocomplete="email" />
					</label>
					<label class="fj-field">
						<span>Phone <em>optional</em></span>
						<input class="field-input" name="phone" type="tel" autocomplete="tel" />
					</label>
				</div>
			{/if}
		</div>

		<div class="fj-group">
			<span class="fj-legend">What you're building</span>
			<div class="fj-row">
				<label class="fj-field wide">
					<span>Project name</span>
					<input class="field-input" name="projectName" required placeholder="Poolside pergola" />
				</label>
				<label class="fj-field">
					<span>Type</span>
					<select class="field-input" name="projectType" bind:value={firstJobType}>
						<option value="">Choose…</option>
						{#each PROJECT_TYPES as t (t)}
							<option value={t}>{t}</option>
						{/each}
						<option value="Other">Other</option>
					</select>
				</label>
				{#if firstJobType === 'Other'}
					<label class="fj-field">
						<span>Which?</span>
						<input class="field-input" name="projectTypeOther" required />
					</label>
				{/if}
			</div>
		</div>

		{#if form?.action === 'firstJob' && form?.message}
			<p class="fj-error" role="alert">{form.message}</p>
		{/if}

		<p class="fj-note">
			You can invite them to their own portal later — that is what lets you message inside the app,
			and it is entirely optional.
		</p>

		<div class="fj-actions">
			<button type="button" class="fj-cancel" onclick={() => firstJobDialog?.close()}>Cancel</button
			>
			<button type="submit" class="fj-save">Create job →</button>
		</div>
	</form>
</dialog>

<style>
	/* ------------------------------------------------------------ Dashboard grid
	   One stack on a phone, two columns from 1100px. `.page-shell` (app.css) is
	   already a grid with the page gap, so this only has to say how many columns
	   and which children span them.

	   1100px rather than a tablet breakpoint: the rail needs ~19rem to hold a
	   four-day forecast without wrapping, and the feed needs the rest to keep a
	   card's name, follow-up flag and action row on the lines they were designed
	   for. Splitting earlier than that gives two columns that are both too narrow. */
	@media (min-width: 1100px) {
		.dash {
			grid-template-columns: minmax(0, 1.6fr) minmax(19rem, 1fr);
			/* The rail sits level with the top of the feed rather than stretching to
			   its height — a four-day forecast should not grow to match a list of
			   eleven jobs. */
			align-items: start;
		}
		/* Everything except the feed/rail pair runs the full width. */
		.dash-head,
		.dash-day,
		.dash-notices {
			grid-column: 1 / -1;
		}
		.dash-feed {
			grid-column: 1;
		}
		.dash-side {
			grid-column: 2;
		}
	}
	.dash-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.dash-notices {
		display: grid;
		gap: var(--page-gap);
	}
	.dash-day {
		display: grid;
		gap: var(--page-gap);
	}
	/* Both halves are conditional, so the band can end up holding nothing at all,
	   and an empty grid item still costs the page a full gap. `:has(*)` tests for
	   an ELEMENT child, so the widget's own comment anchor doesn't count — the
	   same reasoning as `.dash-side` below. */
	.dash-day:not(:has(*)) {
		display: none;
	}
	.dash-side {
		display: grid;
		gap: var(--page-gap);
		align-content: start;
		min-width: 0;
	}
	/* The rail is always in the markup because the forecast arrives after mount,
	   but on a quiet week it can end up holding nothing at all — and an empty grid
	   item still costs the page a full gap. `:has(*)` tests for an ELEMENT child,
	   so Svelte's own comment anchors don't count as content. */
	.dash-side:not(:has(*)) {
		display: none;
	}
	/* Follow-up card: an info band over an action band. Overrides the shared
	   `.card` grid gap — the two bands sit closer than card-level spacing. */
	/* --------------------------------------------------------- Needs you
	   One feed. Everything below is something the contractor has to act on. */
	.attention {
		display: grid;
		gap: 0.6rem;
		align-content: start;
	}
	/* Tighter than the page gap: these are rows of one list, not unrelated panels —
	   the same minimum and the same reasoning as the orders list. */
	.due-list {
		--card-min: 19rem;
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
	.soon-text {
		flex: 1;
		min-width: 0;
		display: grid;
	}
	.soon-title {
		font-size: 0.88rem;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.soon-sub {
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

	/* Off-screen, not `display: none`: a hidden form still submits, but keeping it
	   in the layout at zero cost avoids any question about whether the browser
	   will run its validation. */
	.sr-only-form {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	/* ---- Today's run.
	   A numbered list rather than a stack of cards: it is one sequence read top to
	   bottom, and giving each stop card chrome would have made five stops look
	   like five separate concerns. */
	.today {
		display: grid;
		gap: 0.5rem;
	}
	/* Heading left, forecast right. `center` rather than `baseline`: the forecast
	   is a three-line block and the heading is one line, so a shared baseline hung
	   the heading off the readout's first line instead of centring on it. */
	.today-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	/* With no visits there is no heading row, so the forecast is the band's only
	   child and pins itself right. */
	.dash-day > :global(.weather) {
		justify-self: end;
	}
	.today-head h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-muted);
	}
	.today-list {
		list-style: none;
		margin: 0;
		padding: 0.15rem 0.9rem 0.3rem;
		display: grid;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--surface);
		box-shadow: var(--card-shadow);
	}
	.today-stop {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.55rem 0;
	}
	.today-stop + .today-stop {
		border-top: 1px solid var(--line);
	}
	/* The stop number. The only thing carrying the sequence, so it is the one
	   element here allowed any weight. */
	.today-num {
		flex-shrink: 0;
		width: 1.5rem;
		height: 1.5rem;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: var(--brand);
		color: var(--on-brand);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.today-body {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.02rem;
	}
	.today-name {
		font-size: 0.92rem;
		color: var(--fg);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.today-name:hover {
		text-decoration: underline;
	}
	.today-who,
	.today-where {
		font-size: 0.76rem;
		color: var(--fg-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* ------------------------------------------------------- First job
	   The getting-started card's dialog: a customer and their first job on one
	   surface, grouped so it reads as two short questions rather than six fields
	   in a column. */
	.firstjob {
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-card);
		padding: 0;
		width: 34rem;
		max-width: 94vw;
		background: var(--surface);
		color: var(--fg);
	}
	.fj-body {
		display: grid;
		gap: 0.9rem;
		padding: 1.15rem 1.3rem 1.3rem;
	}
	.fj-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.fj-head h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	.fj-x {
		border: none;
		background: none;
		font-size: 1.1rem;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.fj-group {
		display: grid;
		gap: 0.5rem;
		padding: 0.75rem 0.85rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
	}
	.fj-legend {
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--fg-muted);
	}
	/* Fields flow across before they flow down: three short ones on a desktop is
	   one line, and the whole dialog stays a screenful on a phone. */
	.fj-row {
		display: grid;
		/* `min()` against 100% so a narrow dialog drops to one column instead of
		   overflowing: without it the track floor wins and the row runs past the
		   group's edge. */
		grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr));
		gap: 0.55rem;
	}
	.fj-field {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
		font-size: 0.74rem;
		font-weight: 700;
		color: var(--fg-muted);
	}
	/* An <input> carries an intrinsic width from its `size` attribute — about 20
	   characters — which is wider than these tracks and is what pushed the phone
	   field out through the side of its group. */
	.fj-field :global(.field-input) {
		width: 100%;
		box-sizing: border-box;
		min-width: 0;
	}
	.fj-field.wide {
		grid-column: 1 / -1;
	}
	.fj-field em {
		font-style: normal;
		font-weight: 600;
		opacity: 0.75;
	}
	/* The one thing worth saying about the portal, said where the decision is
	   actually being made rather than as its own step in a checklist. */
	.fj-note {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.fj-error {
		margin: 0;
		color: var(--danger);
		font-size: 0.85rem;
		font-weight: 600;
	}
	.fj-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		align-items: center;
	}
	.fj-cancel,
	.fj-save {
		padding: 0.5rem 1rem;
		border-radius: var(--radius-control);
		font-family: inherit;
		font-size: 0.88rem;
		font-weight: 700;
		cursor: pointer;
	}
	.fj-cancel {
		border: 1px solid var(--line-strong);
		background: none;
		color: var(--fg);
	}
	.fj-save {
		border: none;
		background: var(--brand-sweep);
		color: var(--on-brand);
		box-shadow: 0 0 16px var(--brand-glow);
	}
</style>
