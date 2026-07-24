<script lang="ts">
	import { enhance } from '$app/forms';
	import { ORDER_ICONS } from '$lib/crm';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Which due card's "send communication" contact menu is open.
	let contactOpenId: string | null = $state(null);
	// Which due card's construction-icon picker is open.
	let iconPickerId: string | null = $state(null);
	// Close the icon picker once a choice is submitted.
	const pickIconThenClose = () =>
		async ({ update }: { update: () => Promise<void> }) => {
			iconPickerId = null;
			await update();
		};

	const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

	// Sizing only — the gold look comes from the shared `.icon-btn` class.
	const iconBtn = 'width: 2.2rem; height: 2.2rem; font-size: 1.25rem;';
	// The settable order-icon "avatar": just the glyph, no button chrome.
	const iconBubble =
		'width: 2.6rem; height: 2.6rem; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; border-radius: 999px; cursor: pointer; font-size: 1.6rem; line-height: 1; padding: 0;';
	const iconChoice =
		'width: 2.4rem; height: 2.4rem; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; background: none; border-radius: 10px; cursor: pointer; font-size: 1.3rem; line-height: 1; padding: 0;';
	const contactItem =
		'display: flex; align-items: center; gap: 0.5rem; width: 100%; text-align: left; padding: 0.55rem 0.8rem; border: none; background: none; cursor: pointer; font-size: 0.9rem; color: inherit; text-decoration: none;';
</script>

<svelte:head>
	<title>Contractor dashboard</title>
</svelte:head>

<div style="max-width: 860px; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem;">
	<header
		style="display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap;"
	>
		<h1 class="page-title" style="margin: 0;">Dashboard</h1>
		<span style="font-size: 0.85rem; color: #57606a;"
			>Follow-ups due ({data.dueOrders.length})</span
		>
	</header>

	<!-- Follow-ups due -->
	<section style="display: grid; gap: 0.5rem;">
			{#if data.dueOrders.length === 0}
				<div
					style="border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 16px; padding: 1.25rem; text-align: center; color: #57606a;"
				>
					You’re all caught up — no follow-ups due.
				</div>
			{:else}
				{#each data.dueOrders as o (o.id)}
					<div
						class="due-card"
						style="padding: 0.85rem; border-radius: 12px; background: #fff; border: 1px solid #e2e6ea; box-shadow: 0 1px 2px rgba(27, 31, 36, 0.05); display: flex; justify-content: space-between; gap: 0.9rem; align-items: center;"
					>
						<!-- Settable construction icon -->
						<div style="position: relative; flex-shrink: 0;">
							<button
								type="button"
								title="Set order icon"
								aria-label="Set order icon"
								aria-expanded={iconPickerId === o.id}
								onclick={() => (iconPickerId = iconPickerId === o.id ? null : o.id)}
								style="{iconBubble} {o.icon ? '' : 'opacity: 0.55;'}">{o.icon ?? '🏗️'}</button
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
								<div style="font-size: 0.8rem; color: #8c959f; display: flex; align-items: center; gap: 0.2rem;">
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
							href={`/contractor/orders/${o.id}`}
							title="View order details"
							aria-label="View order details"
							class="icon-btn"
							style="{iconBtn} flex-shrink: 0; text-decoration: none;">📋</a
						>

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
								<!-- click-away backdrop -->
								<button
									type="button"
									aria-label="Close contact menu"
									onclick={() => (contactOpenId = null)}
									style="position: fixed; inset: 0; z-index: 10; background: transparent; border: none; cursor: default;"
								></button>
								<div
									style="position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; min-width: 180px; background: #fff; border: 1px solid #d0d7de; border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); overflow: hidden; display: grid;"
								>
									<a
										href={`mailto:${o.customerEmail}`}
										onclick={() => (contactOpenId = null)}
										style="{contactItem} {o.customerPreferredContact === 'email'
											? 'color: #0969da; font-weight: 700;'
											: ''}"
										>✉ Email{#if o.customerPreferredContact === 'email'}
											<span style="font-size: 0.7rem; color: #8c959f; font-weight: 400;"
												>· preferred</span
											>{/if}</a
									>
									{#if o.customerPhone}
										<a
											href={telHref(o.customerPhone)}
											onclick={() => (contactOpenId = null)}
											style="{contactItem} border-top: 1px solid #eaeef2; {o.customerPreferredContact ===
											'phone'
												? 'color: #0969da; font-weight: 700;'
												: ''}"
											>📞 Call{#if o.customerPreferredContact === 'phone'}
												<span style="font-size: 0.7rem; color: #8c959f; font-weight: 400;"
													>· preferred</span
												>{/if}</a
										>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</section>
</div>

<style>
	/* Mobile: the "Needs update" pill is redundant (every card here is due) and
	   only crowds the narrow row — drop it so the customer + location breathe. */
	@media (max-width: 560px) {
		.due-card .needs-update {
			display: none;
		}
	}
</style>
