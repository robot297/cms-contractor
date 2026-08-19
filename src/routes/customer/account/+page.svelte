<script lang="ts">
	import { resolve } from '$app/paths';
	import { theme } from '$lib/theme.svelte';
	import DevSwitcher from '$lib/DevSwitcher.svelte';
	import type { PageData } from './$types';

	// Data comes from the portal layout load (projects, who this is for, dev flags).
	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Account</title></svelte:head>

<section class="acct">
	<header class="acct-head">
		<h1>Account</h1>
		<p class="who">Signed in as {data.userName}</p>
	</header>

	<div class="group">
		<span class="group-label">Appearance</span>
		<button type="button" class="row as-button" onclick={() => theme.toggle()}>
			<span>Theme</span>
			<span class="row-value">{theme.current === 'dark' ? 'Dark' : 'Light'}</span>
		</button>
	</div>

	{#if data.active.length > 0 || data.past.length > 0}
		<div class="group">
			<span class="group-label">Your projects</span>
			{#each data.active as o (o.id)}
				<a class="row" href={resolve(`/customer/orders/${o.id}`)}>
					<span class="row-name">{o.projectName ?? 'Your project'}</span>
					<span class="row-meta">
						<span class="state">{o.customerStateLabel}</span>
						{#if o.unread > 0}<span class="unread">{o.unread}</span>{/if}
					</span>
				</a>
			{/each}
			{#each data.past as o (o.id)}
				<a class="row past" href={resolve(`/customer/orders/${o.id}`)}>
					<span class="row-name">{o.projectName ?? 'Your project'}</span>
					<span class="state">Complete</span>
				</a>
			{/each}
		</div>
	{/if}

	<div class="group">
		<span class="group-label">Help</span>
		<a class="row" href={resolve('/customer/support')}>
			<span>Support</span>
			<span class="chev" aria-hidden="true">›</span>
		</a>
	</div>

	{#if data.viewAs || data.devSignInEnabled}
		<div class="group">
			<span class="group-label">Developer</span>
			<div class="dev-row">
				<DevSwitcher
					side="customer"
					viewing={!!data.viewAs}
					canSignInAs={data.devSignInEnabled}
					orderId={null}
				/>
			</div>
		</div>
	{/if}

	{#if !data.viewAs}
		<form method="POST" action="/logout" class="signout-form">
			<button type="submit" class="signout">Sign out</button>
		</form>
	{/if}
</section>

<style>
	.acct {
		display: grid;
		gap: 1rem;
		align-content: start;
	}
	.acct-head h1 {
		margin: 0;
		font-size: 1.35rem;
	}
	.who {
		margin: 0.15rem 0 0;
		color: var(--fg-muted);
		font-size: 0.9rem;
	}
	.group {
		display: grid;
		gap: 0.3rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: 0.7rem;
		box-shadow: var(--card-shadow);
	}
	.group-label {
		padding: 0.1rem 0.35rem;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--fg-muted);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 2.75rem;
		padding: 0.5rem 0.65rem;
		border-radius: 10px;
		border: none;
		background: none;
		color: var(--fg);
		font-family: inherit;
		font-size: 0.95rem;
		text-decoration: none;
		cursor: pointer;
	}
	.row:hover {
		background: var(--surface-sunken);
	}
	.row-name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.row-value {
		color: var(--fg-muted);
		font-size: 0.88rem;
	}
	.row-meta {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.state {
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.row.past .row-name {
		color: var(--fg-muted);
	}
	.unread {
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--accent);
		color: var(--accent-fg);
		font-size: 0.7rem;
		font-weight: 800;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.chev {
		color: var(--fg-muted);
		font-size: 1.1rem;
	}
	.dev-row {
		padding: 0.2rem 0.35rem;
	}
	.signout-form {
		display: flex;
		justify-content: center;
		padding-top: 0.25rem;
	}
	.signout {
		border: 1px solid var(--line-strong);
		background: var(--surface);
		color: var(--fg-muted);
		border-radius: 999px;
		padding: 0.6rem 1.4rem;
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
	}
	.signout:hover {
		color: var(--danger);
		border-color: var(--danger);
	}
</style>
