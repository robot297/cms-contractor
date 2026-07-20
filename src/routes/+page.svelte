<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Contractor CRM</title>
</svelte:head>

<div style="max-width: 560px; margin: 3rem auto; padding: 1rem;">
	<div
		style="border: 3px solid #111; border-radius: 18px; background: #fff; box-shadow: 8px 8px 0 #111; overflow: hidden;"
	>
		<div class="hazard"></div>
		<div style="padding: 2rem 1.5rem; text-align: center; display: grid; gap: 1.25rem;">
			<div style="font-size: 2.75rem;">🏗️</div>
			<h1 style="margin: 0; font-size: 1.9rem;">Contractor&nbsp;CRM</h1>
			<p style="margin: 0; color: #4b5159; font-weight: 700;">
				Build the job. Track the work. Keep every customer in the loop.
			</p>
			<a
				href={resolve('/login')}
				style="justify-self: center; padding: 0.85rem 1.6rem; border-radius: 999px; background: #0969da; color: #fff; text-decoration: none; font-size: 1.05rem;"
				>Get started →</a
			>
		</div>
		<div class="hazard"></div>
	</div>
</div>
