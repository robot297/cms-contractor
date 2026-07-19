<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let requestType = $state<'question' | 'service' | 'issue'>('question');

	const requestLabels = {
		question: 'Ask a question',
		service: 'Request service',
		issue: 'Report an issue'
	} as const;
</script>

<svelte:head>
	<title>Customer order portal</title>
</svelte:head>

<div style="max-width: 760px; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem;">
	<header style="display: flex; justify-content: space-between; align-items: start; gap: 1rem;">
		<div style="display: grid; gap: 0.35rem;">
			<h1 style="margin: 0;">Your orders</h1>
			<p style="margin: 0; color: #57606a;">Welcome, {data.userName}</p>
		</div>
		<form method="POST" action="?/signOut" use:enhance>
			<button type="submit" style="padding: 0.4rem 0.8rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;">Sign out</button>
		</form>
	</header>

	{#if !data.active}
		<section style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1.25rem; text-align: center; color: #57606a;">
			<p style="margin: 0;">You don’t have an active order yet. When your contractor starts one, it will show up here.</p>
		</section>
	{:else}
		{@const active = data.active}
		<section style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.5rem;">
			<h2 style="margin: 0; font-size: 1.1rem;">{active.customerName}</h2>
			<p style="margin: 0; color: #57606a;">
				Current status: <strong>{active.customerVisibleState}</strong>
			</p>
		</section>

		<section style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.75rem;">
			<h2 style="margin: 0; font-size: 1rem;">Activity timeline</h2>
			{#if active.timeline.length === 0}
				<p style="margin: 0; color: #57606a; font-size: 0.9rem;">No activity yet.</p>
			{/if}
			<div style="display: grid; gap: 0.65rem;">
				{#each active.timeline as entry (entry.id)}
					<div style="padding: 0.75rem; border-radius: 12px; background: #f6f8fa; border: 1px solid #d0d7de; display: grid; gap: 0.2rem;">
						<strong>{entry.title}</strong>
						{#if entry.detail}<div style="font-size: 0.9rem; color: #57606a;">{entry.detail}</div>{/if}
						<div style="font-size: 0.8rem; color: #57606a;">
							{new Date(entry.createdAt).toLocaleString()} · {entry.authorRole}
						</div>
					</div>
				{/each}
			</div>
		</section>

		<section style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.75rem;">
			<h2 style="margin: 0; font-size: 1rem;">Send a request</h2>
			<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
				{#each Object.entries(requestLabels) as [value, label] (value)}
					<button type="button" onclick={() => (requestType = value as typeof requestType)} style="padding: 0.5rem 0.75rem; border-radius: 999px; border: 1px solid #d0d7de; background: {requestType === value ? '#0969da' : '#f6f8fa'}; color: {requestType === value ? '#fff' : 'inherit'};">{label}</button>
				{/each}
			</div>
			<form method="POST" action="?/request" use:enhance style="display: grid; gap: 0.5rem;">
				<input type="hidden" name="orderId" value={active.id} />
				<input type="hidden" name="type" value={requestType} />
				<textarea name="detail" rows="3" placeholder={requestLabels[requestType]} required style="padding: 0.6rem; border-radius: 8px; border: 1px solid #d0d7de; resize: vertical;"></textarea>
				<button type="submit" style="padding: 0.7rem; border-radius: 999px; border: none; background: #0969da; color: #fff; cursor: pointer;">Send</button>
			</form>
		</section>
	{/if}

	{#if data.past.length > 0}
		<section style="border: 1px solid #d0d7de; border-radius: 16px; padding: 1rem; display: grid; gap: 0.5rem;">
			<h2 style="margin: 0; font-size: 1rem;">Order history</h2>
			{#each data.past as order (order.id)}
				<div style="display: flex; justify-content: space-between; gap: 1rem; padding: 0.5rem 0; border-top: 1px solid #eaeef2;">
					<span>{order.customerName}</span>
					<span style="color: #57606a;">{order.customerVisibleState}</span>
				</div>
			{/each}
		</section>
	{/if}
</div>
