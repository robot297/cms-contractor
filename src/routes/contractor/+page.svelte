<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { ORDER_ICONS } from '$lib/crm';
	import ContactComposer from '$lib/ContactComposer.svelte';
	import Guide from '$lib/Guide.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The server decides whether the guide starts open (nothing due, still something
	// to learn, not dismissed); the header button overrides that for this visit.
	// Derived rather than seeded state, so the server's answer stays live across
	// navigations until the contractor actually clicks.
	let openOverride = $state<boolean | null>(null);
	const guideOpen = $derived(openOverride ?? data.guideOpen);

	// Which due card's "send communication" contact menu is open.
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

	// Which due card's snooze menu is open, its presets, and a close-on-submit hook.
	let snoozeOpenId: string | null = $state(null);
	const SNOOZE_PRESETS = [
		{ preset: '1d', label: '+1 day' },
		{ preset: '3d', label: '+3 days' },
		{ preset: '1w', label: '+1 week' }
	];
	const snoozeThenClose =
		() =>
		async ({ update }: { update: () => Promise<void> }) => {
			snoozeOpenId = null;
			await update();
		};

	// Sizing only — the gold look comes from the shared `.icon-btn` class.
	const iconBtn = 'width: 2.3rem; height: 2.3rem; font-size: 1.55rem;';
	const iconChoice =
		'width: 2.4rem; height: 2.4rem; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; background: none; border-radius: 10px; cursor: pointer; font-size: 1.3rem; line-height: 1; padding: 0;';
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
			<span style="font-size: 0.85rem; color: #57606a;"
				>Follow-ups due ({data.dueOrders.length})</span
			>
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

	{#if guideOpen}
		<Guide guide={data.guide} onclose={() => (openOverride = false)} />
	{/if}

	<!-- Follow-ups due -->
	<section style="display: grid; gap: 0.5rem;">
		{#if data.dueOrders.length === 0}
			{#if !guideOpen}
				<div
					style="border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 16px; padding: 1.25rem; text-align: center; color: #57606a;"
				>
					You’re all caught up — no follow-ups due.
				</div>
			{/if}
		{:else}
			{#each data.dueOrders as o (o.id)}
				<div
					class="due-card card"
					style="display: flex; justify-content: space-between; gap: 0.9rem; align-items: center;"
				>
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
								style="position: absolute; left: 0; top: calc(100% + 6px); z-index: 20; width: 13.5rem; background: #fff; border: 1px solid #d0d7de; border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); padding: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.2rem;"
							>
								<input type="hidden" name="orderId" value={o.id} />
								{#each ORDER_ICONS as ic (ic)}
									<button
										type="submit"
										name="icon"
										value={ic}
										title={ic}
										style="{iconChoice} {o.icon === ic
											? 'background: #ddf4ff; border-color: #0969da;'
											: ''}">{ic}</button
									>
								{/each}
								{#if o.icon}
									<button
										type="submit"
										name="icon"
										value=""
										style="width: 100%; margin-top: 0.25rem; padding: 0.4rem; border-radius: 8px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; font-size: 0.82rem; color: #57606a;"
										>Clear icon</button
									>
								{/if}
							</form>
						{/if}
					</div>

					<div style="flex: 1; min-width: 0;">
						<strong style="font-size: 1rem;">{o.customerName}</strong>
						<div style="font-size: 0.85rem; color: #57606a;">
							{o.projectName ?? 'Untitled project'}
						</div>
						{#if o.customerLocation}
							<div
								style="font-size: 0.8rem; color: #8c959f; display: flex; align-items: center; gap: 0.2rem;"
							>
								<span aria-hidden="true">📍</span>{o.customerLocation}
							</div>
						{/if}
					</div>

					<div class="needs-update" style="flex-shrink: 0;">
						<span
							style="font-size: 0.72rem; font-weight: 700; color: #cf222e; background: #ffebe9; border: 1px solid #e5534b; border-radius: 999px; padding: 0.1rem 0.5rem; white-space: nowrap;"
							>Needs update</span
						>
					</div>

					<!-- Open the order's details -->
					<a
						href={resolve(`/contractor/orders/${o.id}`)}
						title="View order details"
						aria-label="View order details"
						class="icon-btn"
						style="{iconBtn} flex-shrink: 0; text-decoration: none;">📋</a
					>

					<!-- Snooze the follow-up (drops the card off the due list) -->
					<div style="position: relative; flex-shrink: 0;">
						<button
							type="button"
							title="Snooze follow-up"
							aria-label="Snooze follow-up"
							aria-expanded={snoozeOpenId === o.id}
							onclick={() => (snoozeOpenId = snoozeOpenId === o.id ? null : o.id)}
							class="icon-btn"
							style={iconBtn}>⏰</button
						>
						{#if snoozeOpenId === o.id}
							<!-- click-away backdrop -->
							<button
								type="button"
								aria-label="Close snooze menu"
								onclick={() => (snoozeOpenId = null)}
								style="position: fixed; inset: 0; z-index: 10; background: transparent; border: none; cursor: default;"
							></button>
							<div
								style="position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; min-width: 150px; background: #fff; border: 1px solid #d0d7de; border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); padding: 0.4rem; display: grid; gap: 0.2rem;"
							>
								{#each SNOOZE_PRESETS as s (s.preset)}
									<form method="POST" action="?/snoozeFollowUp" use:enhance={snoozeThenClose}>
										<input type="hidden" name="orderId" value={o.id} />
										<input type="hidden" name="preset" value={s.preset} />
										<button
											type="submit"
											style="display: block; width: 100%; text-align: left; padding: 0.5rem 0.7rem; border: none; background: none; cursor: pointer; font-size: 0.9rem; border-radius: 7px; color: inherit;"
											>{s.label}</button
										>
									</form>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Send communication -->
					<div style="position: relative; flex-shrink: 0;">
						<button
							type="button"
							title="Send communication"
							aria-label="Send communication"
							aria-expanded={contactOpenId === o.id}
							onclick={() => (contactOpenId = contactOpenId === o.id ? null : o.id)}
							class="icon-btn"
							style={iconBtn}>💬</button
						>
						{#if contactOpenId === o.id}
							<!-- Dimmed click-away scrim so the composer is the focus. -->
							<button
								type="button"
								aria-label="Close contact menu"
								onclick={() => (contactOpenId = null)}
								class="contact-scrim"
							></button>
							<div class="contact-pop">
								<ContactComposer
									customer={{
										name: o.customerName,
										email: o.customerEmail,
										phone: o.customerPhone,
										preferredContact: o.customerPreferredContact
									}}
									rows={2}
									onsent={() => (contactOpenId = null)}
									onclose={() => (contactOpenId = null)}
								/>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</section>
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

	/* Mobile: the "Needs update" pill is redundant (every card here is due) and
	   only crowds the narrow row — drop it so the customer + location breathe. */
	@media (max-width: 560px) {
		.due-card .needs-update {
			display: none;
		}
	}
</style>
