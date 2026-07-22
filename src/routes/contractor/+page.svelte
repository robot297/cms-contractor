<script lang="ts">
	import { enhance } from '$app/forms';
	import { ORDER_ICONS } from '$lib/crm';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Dashboard tabs: due follow-ups (default) and open customer invites.
	let tab = $state<'due' | 'invites'>('due');
	let confirmingDeleteInviteId: string | null = $state(null);
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

	function inviteLabel(status: string, expiresAt: Date): string {
		if (status === 'revoked') return 'Revoked';
		if (status === 'used') return 'Accepted';
		return new Date(expiresAt).getTime() > Date.now() ? 'Active' : 'Expired';
	}
	const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

	const pill =
		'padding: 0.45rem 0.95rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer; font-size: 0.9rem; font-weight: 600;';
	const pillActive = 'background: #0969da; color: #fff; border-color: #0969da;';
	const iconBtn =
		'width: 2.2rem; height: 2.2rem; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 999px; cursor: pointer; font-size: 1rem; line-height: 1;';
	// The settable order-icon bubble + each choice in the picker.
	const iconBubble =
		'width: 2.6rem; height: 2.6rem; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 999px; cursor: pointer; font-size: 1.3rem; line-height: 1; padding: 0;';
	const iconChoice =
		'width: 2.4rem; height: 2.4rem; display: inline-flex; align-items: center; justify-content: center; border: 1px solid transparent; background: none; border-radius: 10px; cursor: pointer; font-size: 1.3rem; line-height: 1; padding: 0;';
	const contactItem =
		'display: flex; align-items: center; gap: 0.5rem; width: 100%; text-align: left; padding: 0.55rem 0.8rem; border: none; background: none; cursor: pointer; font-size: 0.9rem; color: inherit; text-decoration: none;';
</script>

<svelte:head>
	<title>Contractor dashboard</title>
</svelte:head>

<div style="max-width: 860px; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem;">
	<header>
		<h1 style="margin: 0;">Dashboard</h1>
	</header>

	<!-- Tabs -->
	<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
		<button
			type="button"
			onclick={() => (tab = 'due')}
			style="{pill} {tab === 'due' ? pillActive : ''}"
			>Follow-ups due ({data.dueOrders.length})</button
		>
		<button
			type="button"
			onclick={() => (tab = 'invites')}
			style="{pill} {tab === 'invites' ? pillActive : ''}"
			>Customer invites ({data.invites.length})</button
		>
	</div>

	{#if tab === 'due'}
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
						style="padding: 0.85rem; border-radius: 12px; background: #fff; border: 1px solid #e2e6ea; box-shadow: 0 1px 2px rgba(27, 31, 36, 0.05); display: flex; justify-content: space-between; gap: 0.75rem; align-items: center;"
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

						<a
							href={`/contractor/orders/${o.id}`}
							style="flex: 1; min-width: 0; text-decoration: none; color: inherit;"
						>
							<strong style="font-size: 1rem;">{o.customerName}</strong>
							<div style="font-size: 0.85rem; color: #57606a;">
								{o.projectName ?? 'Untitled project'}
							</div>
						</a>

						<div style="flex-shrink: 0;">
							<span
								style="font-size: 0.72rem; font-weight: 700; color: #cf222e; background: #ffebe9; border: 1px solid #e5534b; border-radius: 999px; padding: 0.1rem 0.5rem; white-space: nowrap;"
								>Needs update</span
							>
						</div>

						<!-- Send communication -->
						<div style="position: relative; flex-shrink: 0;">
							<button
								type="button"
								title="Send communication"
								aria-label="Send communication"
								aria-expanded={contactOpenId === o.id}
								onclick={() => (contactOpenId = contactOpenId === o.id ? null : o.id)}
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
	{:else}
		<!-- Customer invites -->
		<section style="display: grid; gap: 0.5rem;">
			{#if data.invites.length === 0}
				<div
					style="border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 16px; padding: 1.25rem; text-align: center; color: #57606a;"
				>
					No invites sent yet.
				</div>
			{/if}
			{#each data.invites as invite (invite.id)}
				<div
					style="padding: 0.75rem; border-radius: 12px; background: #fff; border: 1px solid #e2e6ea; box-shadow: 0 1px 2px rgba(27, 31, 36, 0.05); display: flex; justify-content: space-between; gap: 1rem; align-items: center; flex-wrap: wrap;"
				>
					<div>
						<strong>{invite.customerEmail}</strong>
						<div style="font-size: 0.85rem; color: #57606a;">
							{inviteLabel(invite.status, invite.expiresAt)} · expires {new Date(
								invite.expiresAt
							).toLocaleString()}
						</div>
					</div>
					<div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
						{#if confirmingDeleteInviteId === invite.id}
							<span style="font-size: 0.85rem; color: #57606a;">Delete this invite?</span>
							<form
								method="POST"
								action="?/deleteInvite"
								use:enhance={() =>
									async ({ update }) => {
										confirmingDeleteInviteId = null;
										await update();
									}}
							>
								<input type="hidden" name="inviteId" value={invite.id} />
								<button
									type="submit"
									style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #cf222e; background: #cf222e; color: #fff; cursor: pointer;"
									>Yes, delete</button
								>
							</form>
							<button
								type="button"
								onclick={() => (confirmingDeleteInviteId = null)}
								style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
								>Cancel</button
							>
						{:else}
							<form method="POST" action="?/resendInvite" use:enhance>
								<input type="hidden" name="inviteId" value={invite.id} />
								<button
									type="submit"
									style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #0969da; background: none; cursor: pointer;"
									>Resend</button
								>
							</form>
							{#if invite.status === 'pending'}
								<form method="POST" action="?/revokeInvite" use:enhance>
									<input type="hidden" name="inviteId" value={invite.id} />
									<button
										type="submit"
										style="padding: 0.4rem 0.7rem; border-radius: 999px; border: 1px solid #cf222e; color: #cf222e; background: none; cursor: pointer;"
										>Revoke</button
									>
								</form>
							{/if}
							<button
								type="button"
								title="Delete invite"
								aria-label="Delete invite"
								onclick={() => (confirmingDeleteInviteId = invite.id)}
								style="border: none; background: none; cursor: pointer; font-size: 1rem; line-height: 1; color: #cf222e; padding: 0.2rem 0.35rem;"
								>🗑</button
							>
						{/if}
					</div>
				</div>
			{/each}
		</section>
	{/if}
</div>
