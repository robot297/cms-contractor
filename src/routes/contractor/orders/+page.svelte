<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { customerLocation, portalInfoFor, PROJECT_TYPES, type PortalInfo } from '$lib/crm';
	import ContactPanel from '$lib/ContactPanel.svelte';
	import OrderCard from '$lib/OrderCard.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Trial capacity, from the contractor layout. Null once they're on a paid or
	// comped subscription, which are uncapped.
	const atOrderLimit = $derived(data.billing.limits?.order.atLimit ?? false);

	type OrderView = (typeof data.orders)[number];

	// Which lifecycle bucket is shown. Active is the working list; completed and
	// cancelled orders move out of the way into their own views.
	const VIEWS = ['active', 'completed', 'cancelled'] as const;
	const VIEW_LABELS = { active: 'Active', completed: 'Completed', cancelled: 'Cancelled' } as const;
	let view = $state<(typeof VIEWS)[number]>(untrack(() => data.initialView ?? 'active'));

	// Sort by follow-up attention: overdue first, upcoming next, no-date last.
	function byAttention(a: OrderView, b: OrderView): number {
		const av = a.nextFollowUpAt ? new Date(a.nextFollowUpAt).getTime() : Infinity;
		const bv = b.nextFollowUpAt ? new Date(b.nextFollowUpAt).getTime() : Infinity;
		return av - bv;
	}

	const buckets = $derived.by(() => {
		const active: OrderView[] = [];
		const completed: OrderView[] = [];
		const cancelled: OrderView[] = [];
		for (const o of data.orders) {
			if (o.state === 'Work Complete') completed.push(o);
			else if (o.state === 'Work Cancelled') cancelled.push(o);
			else active.push(o);
		}
		// data.orders arrives newest-first — right for the completed/cancelled
		// archives; the active list is re-sorted by follow-up urgency instead.
		active.sort(byAttention);
		return { active, completed, cancelled };
	});
	const visibleOrders = $derived(buckets[view]);

	// The lifecycle filter is a single button that opens a small menu.
	let viewMenuOpen = $state(false);

	// Contact dialog, driven off the already-loaded customer directory. The body
	// is the shared ContactComposer (message + channel picker).
	let customerDialog: HTMLDialogElement | undefined = $state();
	let customerDetail: (typeof data.customers)[number] | null = $state(null);
	// The project of the order the composer was opened from, so `{{project}}`
	// resolves in email templates.
	let contactProject = $state<string | null>(null);
	// And the order itself, so a successful send is recorded on its timeline.
	let contactOrderId = $state<string | null>(null);
	// Whether this order's customer has a portal — the Chat tab only works when a
	// reply has somewhere to land, exactly as on the dashboard and order workspace.
	let contactCanChat = $state(false);
	// The customer being contacted, and where they stand with the portal — so the
	// Chat tab can offer (or report) an invite when they aren't linked yet.
	let contactCustomerId = $state<string | null>(null);
	let contactPortal = $state<PortalInfo | null>(null);
	// The customer's contact details (email/phone/address/notes), folded behind the
	// ⓘ next to their name — composing is the dialog's job; the details are lookup.
	let contactInfoOpen = $state(false);
	function openContact(
		id: string | null,
		project: string | null = null,
		orderId: string | null = null,
		linked = false
	) {
		customerDetail = id ? (data.customers.find((c) => c.id === id) ?? null) : null;
		contactProject = project;
		contactOrderId = orderId;
		contactCanChat = linked;
		contactCustomerId = id;
		contactPortal = portalInfoFor({ linked, customerId: id, invites: data.invites });
		contactInfoOpen = false;
		if (customerDetail) customerDialog?.showModal();
	}

	// New order modal
	let newOrderDialog: HTMLDialogElement | undefined = $state();
	let projectType = $state('');

	/** "Dana Whitfield — Austin, TX", falling back to the bare name. */
	function customerLabel(c: {
		name: string;
		address: string | null;
		city: string | null;
		state: string | null;
	}): string {
		const where = customerLocation(c);
		return where ? `${c.name} — ${where}` : c.name;
	}

	function openNewOrder() {
		projectType = '';
		newOrderDialog?.showModal();
	}

	// Open the create form on arrival in the two cases where the page has nothing
	// else to offer:
	//   - ?customer=… — "Add & create order" just made that customer and sent us here
	//     to book the work (the select preselects them via `data.presetCustomerId`).
	//   - no orders at all — which is exactly when the getting-started guide's
	//     "Create an order" step points here, mirroring the customers directory.
	// Needs a customer to exist, or the form has nothing to pick from.
	onMount(() => {
		if (data.customers.length === 0) return;
		if (data.presetCustomerId || data.orders.length === 0) newOrderDialog?.showModal();
	});

	// Show the project type only when the name doesn't already say it, so
	// "Poolside Pergola" + type "Pergola" reads as one line, not "… · Pergola".
	function typeSuffix(name: string | null, type: string | null): string | null {
		if (!type) return null;
		if (name && name.toLowerCase().includes(type.toLowerCase())) return null;
		return type;
	}
</script>

<svelte:head>
	<title>Orders</title>
</svelte:head>

<div class="orders-page page-shell">
	<header>
		<h1 class="page-title" style="margin: 0;">Orders</h1>
	</header>

	<!-- Filter and action on ONE row, across from each other.
	
	     "New order" used to ride up in the header beside the title, which left it
	     stacked directly above the filter chip — two controls on two lines with an
	     empty half-row beside each. On a phone that is the worst version of it: the
	     title is hidden entirely under the bottom bar, so the header collapsed and
	     the button was left floating above the filter for no reason a reader could
	     see. They are the two controls of this page and they belong on its one
	     toolbar. -->
	<div class="orders-toolbar">
		<div class="view-filter">
			<button
				type="button"
				class="view-trigger"
				aria-expanded={viewMenuOpen}
				onclick={() => (viewMenuOpen = !viewMenuOpen)}
			>
				{VIEW_LABELS[view]}
				<span class="view-count">{buckets[view].length}</span>
				<span class="view-caret" aria-hidden="true">▾</span>
			</button>
			{#if viewMenuOpen}
				<!-- click-away backdrop -->
				<button
					type="button"
					aria-label="Close filter menu"
					onclick={() => (viewMenuOpen = false)}
					class="menu-scrim"
				></button>
				<div class="view-menu">
					{#each VIEWS as key (key)}
						<button
							type="button"
							class="view-option"
							class:selected={view === key}
							aria-current={view === key}
							onclick={() => {
								view = key;
								viewMenuOpen = false;
							}}
						>
							<span>{VIEW_LABELS[key]}</span>
							<span class="view-count">{buckets[key].length}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<button type="button" class="new-order" onclick={openNewOrder}>＋ New Order</button>
	</div>

	<!-- Order cards flow into as many columns as the viewport can hold: one on a
	     phone, two on a tablet, three or four on a desktop. The card itself is
	     unchanged — the list simply stops being a single column on screens where
	     that meant two thirds of the width was empty paper. -->
	<section class="order-list card-grid">
		{#if visibleOrders.length === 0}
			<!-- Just states the fact, centred. The instruction to use New Order is gone:
			     the button is right there, and with no orders the create form opens on
			     arrival anyway. -->
			<!-- Spans the whole grid: an empty state parked in column one with two
			     empty columns beside it reads as a rendering fault. -->
			<p class="empty-orders span-all">
				{view === 'active'
					? 'No active orders found.'
					: view === 'completed'
						? 'No completed orders yet.'
						: 'No cancelled orders.'}
			</p>
		{/if}

		{#each visibleOrders as order (order.id)}
			{@const where = customerLocation({
				city: order.customerCity,
				state: order.customerState,
				address: order.customerAddress
			})}
			<!-- The card is the shared one — the same component the dashboard's
			     "response needed" feed renders. It used to be a second copy that had
			     drifted: a bigger title here, a message button hung from the top edge
			     here and centred there, a hover sheen and status rim on the dashboard
			     only. Two cards showing the same job, doing the same two things.

			     The state pill that used to sit opposite the title is gone. Which of
			     ten states a job is in is a fact you act on from the order itself, and
			     the list is already filtered by the coarse version of it (Active /
			     Completed / Cancelled) — so on a phone it was a second column of
			     chrome squeezing the project name, restating the tab you were already
			     looking at.

			     No swipe here: snoozing answers "not this week", which is a thing you
			     say while triaging what is due. This list is not that list.

			     Follow-up dates are deliberately absent too — due ones surface on the
			     dashboard, and notes, snooze and delete live on the order page. -->
			<OrderCard
				orderId={order.id}
				projectName={order.projectName}
				typeSuffix={typeSuffix(order.projectName, order.projectType)}
				customerName={order.customerName}
				location={where}
			>
				{#snippet actions()}
					{#if order.customerId}
						<div class="above-stretch">
							<button
								type="button"
								title="Message {order.customerName}"
								aria-label="Message {order.customerName}"
								onclick={() =>
									openContact(order.customerId, order.projectName, order.id, order.customerLinked)}
								class="card-btn"
							>
								<span aria-hidden="true">💬</span>
								<!-- Always "Message", never "Reply (2)". The count is the badge's
								     job, and a label that changes with it stops being a prefix of
								     the accessible name — which is what keeps the visible words and
								     the announced ones in step (WCAG 2.5.3). -->
								<span class="card-btn-label">Message</span>
								{#if (data.unread[order.id] ?? 0) > 0}
									<span class="btn-count" aria-hidden="true">{data.unread[order.id]}</span>
								{/if}
							</button>
						</div>
					{/if}
				{/snippet}
			</OrderCard>
		{/each}
	</section>
</div>

<!-- Contact dialog -->
<dialog
	bind:this={customerDialog}
	style="border: none; border-radius: 16px; padding: 0; max-width: 420px; width: 92vw; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);"
>
	{#if customerDetail}
		{@const c = customerDetail}
		<div style="display: grid; gap: 0.7rem; padding: 1.25rem;">
			<div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
				<div style="display: flex; align-items: center; gap: 0.5rem; min-width: 0;">
					<h2 style="margin: 0; font-size: 1.1rem; overflow-wrap: anywhere;">{c.name}</h2>
					<button
						type="button"
						class="info-btn"
						class:on={contactInfoOpen}
						title="Customer details"
						aria-label="Customer details"
						aria-expanded={contactInfoOpen}
						onclick={() => (contactInfoOpen = !contactInfoOpen)}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="11" x2="12" y2="16.5" />
							<circle cx="12" cy="7.5" r="0.5" fill="currentColor" />
						</svg>
					</button>
				</div>
				<button
					type="button"
					onclick={() => customerDialog?.close()}
					style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
					>✕</button
				>
			</div>
			{#if contactInfoOpen}
				<div class="contact-info" transition:slide={{ duration: 180 }}>
					<div style="word-break: break-word;">
						<span style="color: #57606a;">Email:</span>
						{c.email}
					</div>
					{#if c.phone}<div><span style="color: #57606a;">Phone:</span> {c.phone}</div>{/if}
					{#if c.address}<div><span style="color: #57606a;">Address:</span> {c.address}</div>{/if}
					{#if c.notes}
						<div style="margin-top: 0.3rem; color: #57606a; white-space: pre-wrap;">{c.notes}</div>
					{/if}
					<a
						href={resolve('/contractor/people')}
						style="justify-self: start; font-size: 0.85rem; color: #0969da;">Manage in people →</a
					>
				</div>
			{/if}
			<ContactPanel
				contact={c}
				project={contactProject}
				orderId={contactOrderId}
				conversations={contactCanChat && contactOrderId
					? [
							{
								orderId: contactOrderId,
								projectName: contactProject,
								thread: data.threads[contactOrderId] ?? []
							}
						]
					: []}
				canChat={contactCanChat}
				customerId={contactCustomerId}
				portal={contactPortal}
				onsent={() => customerDialog?.close()}
			/>
		</div>
	{/if}
</dialog>

<!-- New order modal -->
<dialog bind:this={newOrderDialog} class="neworder">
	<div class="neworder-body">
		<div style="display: flex; justify-content: space-between; align-items: center;">
			<h2 style="margin: 0; font-size: 1.1rem;">New order</h2>
			<button
				type="button"
				onclick={() => newOrderDialog?.close()}
				style="border: none; background: none; font-size: 1.2rem; cursor: pointer; color: #57606a;"
				>✕</button
			>
		</div>

		{#if atOrderLimit}
			<p class="limit-note">
				Your trial covers {data.billing.limits?.order.limit} orders and you have {data.billing
					.limits?.order.used}. Delete an order you no longer need to free a space, or
				<a href={resolve('/contractor/billing')}>subscribe for unlimited</a>.
			</p>
		{/if}

		{#if data.customers.length === 0}
			<p style="margin: 0; color: #57606a;">
				You have no customers yet. <a href={resolve('/contractor/people')} style="color: #0969da;"
					>Add a customer</a
				> first.
			</p>
		{:else}
			<form
				method="POST"
				action="?/createOrder"
				use:enhance={() =>
					async ({ result, update }) => {
						await update();
						if (result.type === 'success') newOrderDialog?.close();
					}}
				style="display: grid; gap: 0.7rem;"
			>
				<label class="fieldset">
					Project name
					<input name="projectName" required class="field" />
				</label>

				<!-- One selector, no search box. The list is a contractor's own directory,
				     so it's short enough to scroll — and on a phone the native picker is
				     a better control than a filter box plus a dropdown. Shows where the
				     job is rather than an email, which is what tells two customers apart
				     at a glance. -->
				<label class="fieldset">
					Customer
					<select name="customerId" required class="field picker">
						<option value="" disabled selected={!data.presetCustomerId}>Choose a customer…</option>
						{#each data.customers as c (c.id)}
							<option value={c.id} selected={c.id === data.presetCustomerId}
								>{customerLabel(c)}</option
							>
						{/each}
					</select>
				</label>

				<label class="fieldset">
					Project type
					<select name="projectType" bind:value={projectType} required class="field picker">
						<option value="" disabled>Choose a type…</option>
						{#each PROJECT_TYPES as t (t)}
							<option value={t}>{t}</option>
						{/each}
						<option value="Other">Other…</option>
					</select>
				</label>
				{#if projectType === 'Other'}
					<input
						name="projectTypeOther"
						placeholder="Describe the structure"
						required
						class="field"
					/>
				{/if}

				{#if form?.action === 'create' && form?.message}
					<p style="margin: 0; color: #cf222e; font-size: 0.85rem;">{form.message}</p>
				{/if}

				<div class="neworder-actions">
					<button type="button" onclick={() => newOrderDialog?.close()} class="no-cancel"
						>Cancel</button
					>
					<button type="submit" class="no-submit">Create order</button>
				</div>
			</form>
		{/if}
	</div>
</dialog>

<style>
	/* ---------------------------------------------------- Lifecycle filter
	   Trigger + menu are token-driven (no inline color literals) so light and
	   dark both come out right instead of relying on the global interception
	   rules, which left the selected row a bright light-blue on dark. */
	/* The page's one toolbar: what you are looking at, and the way to add to it.
	   Wraps rather than squeezing — at 320px the chip and the button would each be
	   too narrow to read on one line. */
	.orders-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.view-filter {
		position: relative;
	}
	/* Was an inline style carrying a hardcoded #0969da — the page's last literal
	   blue, from before the palettes existed. As a class it follows the theme, and
	   it shares `--radius-pill` with the filter chip beside it so the two controls
	   on this row agree on their own shape. */
	.new-order {
		flex: none;
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--brand);
		border-radius: var(--radius-pill);
		background: var(--brand);
		color: var(--on-brand);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
		transition:
			background 0.14s ease,
			border-color 0.14s ease;
	}
	.new-order:hover {
		background: var(--brand-deep);
		border-color: var(--brand-deep);
	}
	.new-order:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	.view-trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.8rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg);
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.view-trigger:hover {
		background: var(--surface-sunken);
	}
	.view-caret {
		color: var(--fg-muted);
		font-size: 0.75rem;
	}
	/* The count sits in its own chip so it reads as metadata, not part of the label. */
	.view-count {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--fg-muted);
		background: var(--surface-sunken);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
	}
	.menu-scrim {
		position: fixed;
		inset: 0;
		z-index: 10;
		background: transparent;
		border: none;
		cursor: default;
	}
	.view-menu {
		position: absolute;
		left: 0;
		top: calc(100% + 6px);
		z-index: 20;
		min-width: 210px;
		display: grid;
		gap: 0.1rem;
		padding: 0.25rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		box-shadow: var(--card-shadow);
	}
	.view-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.6rem;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--fg);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.view-option:hover {
		background: var(--surface-sunken);
	}
	/* Selected row uses the app's safety-yellow accent — legible in both themes,
	   unlike the old light-blue wash. */
	.view-option.selected {
		background: var(--brand);
		color: var(--on-brand);
		font-weight: 800;
	}
	.view-option.selected .view-count {
		background: rgba(20, 23, 28, 0.12);
		border-color: rgba(20, 23, 28, 0.25);
		color: #14171c;
	}

	@media (max-width: 560px) {
		/* Reclaim the width the desktop chrome was spending. A 1rem page gutter plus
		   1.2rem of card padding put 2.2rem between the screen edge and the project
		   name; the cards then sat 1rem apart with 0.85rem between their own rows.
		   None of that is legibility on a 360px screen — it is why four orders
		   filled a phone. */
		.orders-page {
			padding: 0.75rem 0.6rem 2rem;
			gap: 0.6rem;
		}
		.order-list {
			gap: 0.6rem;
		}
		.orders-page :global(.card) {
			padding: 0.85rem;
			border-radius: 14px;
			gap: 0.55rem;
		}
	}

	/* ------------------------------------------------- Contact dialog details
	   The ⓘ beside the customer's name; the detail rows it reveals sit in a quiet
	   inset panel above the composer. */
	.info-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		height: 1.7rem;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: none;
		color: var(--fg-muted);
		cursor: pointer;
		transition:
			color 0.12s ease,
			background 0.12s ease,
			border-color 0.12s ease;
	}
	.info-btn:hover {
		color: var(--fg);
		background: var(--surface-sunken);
	}
	.info-btn.on,
	.info-btn.on:hover {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--on-brand);
	}
	.info-btn:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	.contact-info {
		display: grid;
		gap: 0.4rem;
		font-size: 0.9rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-sunken);
	}

	/* Shown in the new-order modal when a trial has run out of order slots. */
	.limit-note {
		margin: 0;
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		border: 1.5px solid var(--brand-deep);
		background: color-mix(in srgb, var(--brand) 18%, var(--surface));
		color: var(--fg);
		font-size: 0.83rem;
		line-height: 1.5;
	}
	.limit-note a {
		color: inherit;
		font-weight: 700;
	}

	/* Empty list: centred in the view rather than hugging the top-left, so a page
	   with nothing on it reads as deliberate instead of broken. */
	.empty-orders {
		margin: 0;
		padding: 3rem 1rem;
		text-align: center;
		color: var(--fg-muted);
		font-size: 0.95rem;
	}

	/* ------------------------------------------------------- New order modal
	   Sized to the viewport, not to its content. The customer <select> lists
	   "Name · email@address", and inside a grid label that long option text sets
	   the column's max-content width — which is what pushed this dialog wider than
	   a phone screen. `min-width: 0` stops the intrinsic width winning, and
	   `width: 100%` + border-box keeps padding inside the box. */
	.neworder {
		border: none;
		border-radius: 16px;
		padding: 0;
		width: min(92vw, 480px);
		max-width: min(92vw, 480px);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
	}
	.neworder-body {
		display: grid;
		gap: 0.7rem;
		padding: 1.25rem;
		box-sizing: border-box;
		/* Short screens — and the on-screen keyboard — leave very little height, so
		   scroll the form rather than clipping the submit button off the bottom. */
		max-height: min(85dvh, 40rem);
		overflow-y: auto;
	}
	.neworder-body :global(label) {
		min-width: 0;
	}
	.neworder-body :global(input),
	.neworder-body :global(select) {
		width: 100%;
		min-width: 0;
		max-width: 100%;
		box-sizing: border-box;
	}

	.neworder-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	.neworder-actions button {
		padding: 0.55rem 1.1rem;
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
		font-size: 0.9rem;
	}
	/* Cancel is the way out, not a peer of the submit — no fill, no border. */
	.no-cancel {
		border: none;
		background: none;
		color: var(--fg-muted);
		padding: 0.55rem 0.4rem;
		margin-right: auto;
	}
	.no-cancel:hover {
		color: var(--fg);
	}
	/* Same treatment as the page's other primary actions: yellow fill, no border.
	   (This was the page's one leftover blue button — the class escapes the
	   inline-style interception in app.css.) */
	.no-submit {
		border: none;
		background: var(--brand);
		color: var(--on-brand);
		font-weight: 700;
		box-shadow: var(--pop-shadow-sm);
	}
	.no-submit:hover {
		background: var(--brand-deep);
	}
	.neworder-actions button:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 2px;
	}
	/* Width, gutters and gap all come from `.page-shell` (app.css) now, so this
	   only carries what is specific to the orders page. The class stays because
	   the phone tightening below keys on it — and because a scoped selector is
	   (0,2,0) against `.page-shell`'s (0,1,0), which is what lets that override
	   land without an !important. */
	.orders-page {
		display: grid;
	}
	/* A little tighter than the page gap: these are rows of one list, not
	   unrelated panels. */
	.order-list {
		gap: 0.75rem;
		/* Wide enough for a project name, a customer and a city on the lines they
		   were designed for; below it the list stays single-column. */
		--card-min: 21rem;
	}

	@media (max-width: 420px) {
		/* (0,2,0) selectors — media queries add no specificity, so a bare `.no-submit`
		   here would lose to the rules above. */
		.neworder-actions .no-submit {
			flex: 1 1 100%;
		}
		.neworder-actions .no-cancel {
			order: 1;
			flex: 0 0 auto;
			margin: 0.1rem auto 0;
		}
	}

	/* --------------------------------------------------- New order modal fields
	   Token-driven, so they follow the theme instead of the hardcoded greys the
	   old inline style used (which stayed light-on-light in dark mode). */
	.fieldset {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--fg-muted);
	}
	.field {
		width: 100%;
		min-width: 0;
		max-width: 100%;
		box-sizing: border-box;
		/* 44px lands on the usual minimum comfortable tap target. */
		min-height: 2.75rem;
		padding: 0.55rem 0.7rem;
		border-radius: 10px;
		border: 1px solid var(--field-border);
		background: var(--field-bg);
		color: var(--fg);
		font-family: inherit;
		font-size: 1rem;
		text-transform: none;
		letter-spacing: normal;
		font-weight: 400;
	}
	.field:focus-visible {
		outline: none;
		border-color: var(--brand-deep);
		box-shadow: 0 0 0 3px var(--brand-glow);
		background: var(--field-bg-focus);
	}
	/* Native select, restyled: keeps the OS picker on mobile (the right control on
	   a phone) while losing the default chrome. The chevron is a data-URI so it
	   needs no asset, in a mid-grey that reads on both themes. */
	.picker {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5 6 6.5l5-5' stroke='%238b949e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.85rem center;
		padding-right: 2.2rem;
		cursor: pointer;
	}
</style>
