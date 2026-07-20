<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const path = $derived(page.url.pathname);
	const onDashboard = $derived(path === '/contractor');
	const onOrders = $derived(path.startsWith('/contractor/orders'));
	const onCustomers = $derived(path.startsWith('/contractor/customers'));

	const linkBase =
		'padding: 0.4rem 0.9rem; border-radius: 999px; text-decoration: none; font-size: 0.85rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; border: 2px solid #fff;';
	const active =
		'background: #ffcc00; color: #111; border-color: #111; box-shadow: 2px 2px 0 #fff;';
	const inactive = 'background: transparent; color: #fff;';
</script>

<div style="background: #111;">
	<nav
		style="max-width: 860px; margin: 0 auto; padding: 0.7rem 1rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;"
	>
		<div style="display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap;">
			<span
				style="font-weight: 900; text-transform: uppercase; letter-spacing: 0.02em; color: #ffcc00; text-shadow: 2px 2px 0 #000;"
				>🛠 Contractor&nbsp;CRM</span
			>
			<div style="display: flex; gap: 0.4rem;">
				<a href={resolve('/contractor')} style="{linkBase} {onDashboard ? active : inactive}"
					>Dashboard</a
				>
				<a href={resolve('/contractor/orders')} style="{linkBase} {onOrders ? active : inactive}"
					>Orders</a
				>
				<a
					href={resolve('/contractor/customers')}
					style="{linkBase} {onCustomers ? active : inactive}">Customers</a
				>
			</div>
		</div>
		<div style="display: flex; align-items: center; gap: 0.75rem;">
			<span style="font-size: 0.8rem; color: #fff; font-weight: 700;">{data.userName}</span>
			<form method="POST" action="/logout">
				<button
					type="submit"
					style="padding: 0.4rem 0.9rem; border-radius: 999px; border: 2px solid #fff; background: transparent; color: #fff; cursor: pointer; font-weight: 800; text-transform: uppercase; font-size: 0.8rem;"
					>Sign out</button
				>
			</form>
		</div>
	</nav>
</div>
<div class="hazard"></div>

{@render children()}
