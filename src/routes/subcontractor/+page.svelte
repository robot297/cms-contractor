<script lang="ts">
	import { tierLabel, type SubcontractorTier } from '$lib/crm';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>My jobs · Subcontractor</title></svelte:head>

<div class="wrap">
	<header class="head">
		<div>
			<h1>My jobs</h1>
			{#if data.tier}
				<span class="tier {data.tier}">{tierLabel(data.tier as SubcontractorTier)}</span>
			{/if}
		</div>
		<div class="right">
			<span class="who">{data.userName}</span>
			<form method="POST" action="/logout">
				<button class="signout" type="submit">Sign out</button>
			</form>
		</div>
	</header>

	{#if data.bindError}
		<div class="notice error">
			<strong>Couldn’t join as a subcontractor.</strong>
			<p>{data.bindError}</p>
		</div>
	{/if}

	{#if data.tier === 'guest'}
		<p class="hint">
			As a Guest Contractor you can see each job’s work details and timeline. Customer contact
			information is hidden, and jobs are read-only.
		</p>
	{/if}

	{#if data.orders.length === 0}
		<div class="empty">
			{#if data.bindError}
				No access yet.
			{:else}
				You have no assigned jobs right now. When a contractor assigns you to an order, it’ll show
				up here.
			{/if}
		</div>
	{:else}
		<div class="grid">
			{#each data.orders as o (o.id)}
				<a class="card" href="/subcontractor/{o.id}">
					<div class="card-top">
						<strong>{o.projectName ?? 'Untitled job'}</strong>
						<span class="state">{o.customerVisibleState}</span>
					</div>
					<div class="meta">
						{o.projectType ?? 'Project'}
						{#if o.customerName}· {o.customerName}{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.wrap {
		max-width: 720px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	h1 {
		margin: 0 0 0.3rem;
		font-size: 1.6rem;
	}
	.tier {
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		border: none;
	}
	.tier.trusted {
		background: #22c55e;
		color: #04210f;
	}
	.tier.guest {
		background: #e5e7eb;
	}
	.right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.who {
		font-weight: 700;
		font-size: 0.85rem;
	}
	.signout {
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		border: 1px solid #d0d7de;
		background: #fff;
		cursor: pointer;
		font-weight: 700;
		font-size: 0.8rem;
		box-shadow: 0 1px 2px rgba(27, 31, 36, 0.08);
	}
	.hint {
		background: #fffbe6;
		border: 1px solid #e6d98a;
		border-radius: 10px;
		padding: 0.7rem 0.9rem;
		font-weight: 600;
		margin: 1rem 0;
	}
	.notice.error {
		background: #fef2f2;
		border: 1px solid #e5a3a3;
		border-radius: 10px;
		padding: 0.8rem 1rem;
		margin: 1rem 0;
	}
	.notice.error p {
		margin: 0.3rem 0 0;
	}
	.grid {
		display: grid;
		gap: 0.8rem;
		margin-top: 1rem;
	}
	.card {
		border: 1px solid #e2e6ea;
		border-radius: 14px;
		background: #fff;
		box-shadow:
			0 1px 2px rgba(27, 31, 36, 0.06),
			0 4px 14px rgba(27, 31, 36, 0.08);
		padding: 0.9rem;
		text-decoration: none;
		color: inherit;
		display: grid;
		gap: 0.3rem;
	}
	.card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.state {
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		background: #ffcc00;
		border: none;
		border-radius: 999px;
		padding: 0.12rem 0.55rem;
	}
	.meta {
		color: #555;
		font-weight: 600;
		font-size: 0.9rem;
	}
	.empty {
		border: 1.5px dashed #c9ced6;
		border-radius: 12px;
		padding: 1.5rem;
		text-align: center;
		color: #666;
		font-weight: 600;
		margin-top: 1rem;
	}
</style>
