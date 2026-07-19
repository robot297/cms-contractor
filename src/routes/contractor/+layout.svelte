<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const path = $derived(page.url.pathname);
	const onDashboard = $derived(path === '/contractor');
	const onCustomers = $derived(path.startsWith('/contractor/customers'));

	const linkBase =
		'padding: 0.4rem 0.85rem; border-radius: 999px; text-decoration: none; font-size: 0.9rem;';
	const active = 'background: #0969da; color: #fff;';
	const inactive = 'background: transparent; color: #24292f;';
</script>

<div style="border-bottom: 1px solid #e1e4e8; background: #fff;">
	<nav
		style="max-width: 860px; margin: 0 auto; padding: 0.6rem 1rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem;"
	>
		<div style="display: flex; align-items: center; gap: 0.75rem;">
			<span style="font-weight: 700; letter-spacing: -0.01em;">🛠 Contractor&nbsp;CRM</span>
			<div style="display: flex; gap: 0.25rem;">
				<a href={resolve('/contractor')} style="{linkBase} {onDashboard ? active : inactive}"
					>Dashboard</a
				>
				<a
					href={resolve('/contractor/customers')}
					style="{linkBase} {onCustomers ? active : inactive}">Customers</a
				>
			</div>
		</div>
		<div style="display: flex; align-items: center; gap: 0.75rem;">
			<span style="font-size: 0.85rem; color: #57606a;">{data.userName}</span>
			<form method="POST" action="/logout">
				<button
					type="submit"
					style="padding: 0.4rem 0.8rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;"
					>Sign out</button
				>
			</form>
		</div>
	</nav>
</div>

{@render children()}
