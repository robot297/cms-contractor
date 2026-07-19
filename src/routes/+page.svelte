<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Contractor customer relations</title>
</svelte:head>

<div
	style="max-width: 520px; margin: 4rem auto; padding: 1rem; display: grid; gap: 1.25rem; text-align: center;"
>
	<h1 style="margin: 0;">Contractor customer relations</h1>
	<p style="margin: 0; color: #57606a;">
		A mobile-first workspace for contractors and a calm order portal for customers.
	</p>
	<a
		href={resolve('/login')}
		style="padding: 0.8rem 1rem; border-radius: 999px; background: #0969da; color: #fff; text-decoration: none;"
		>Sign in or create an account</a
	>
</div>
