<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let mode = $state<'signIn' | 'signUp'>('signIn');
</script>

<svelte:head>
	<title>{mode === 'signIn' ? 'Sign in' : 'Create account'}</title>
</svelte:head>

<div style="max-width: 420px; margin: 3rem auto; padding: 1rem; display: grid; gap: 1rem;">
	<header style="display: grid; gap: 0.35rem; text-align: center;">
		<h1 style="margin: 0;">Contractor CRM</h1>
		<p style="margin: 0; color: #57606a;">
			{mode === 'signIn' ? 'Sign in to your workspace.' : 'Create your account.'}
		</p>
	</header>

	<div style="display: flex; gap: 0.5rem;">
		<button
			type="button"
			onclick={() => (mode = 'signIn')}
			style="flex: 1; padding: 0.5rem; border-radius: 999px; border: 1px solid #d0d7de; background: {mode === 'signIn' ? '#0969da' : '#f6f8fa'}; color: {mode === 'signIn' ? '#fff' : 'inherit'};"
		>Sign in</button>
		<button
			type="button"
			onclick={() => (mode = 'signUp')}
			style="flex: 1; padding: 0.5rem; border-radius: 999px; border: 1px solid #d0d7de; background: {mode === 'signUp' ? '#0969da' : '#f6f8fa'}; color: {mode === 'signUp' ? '#fff' : 'inherit'};"
		>Sign up</button>
	</div>

	{#if form?.message}
		<p style="margin: 0; color: #cf222e; font-size: 0.9rem;">{form.message}</p>
	{/if}

	{#if mode === 'signIn'}
		<form method="POST" action="?/signIn" use:enhance style="display: grid; gap: 0.75rem;">
			<label style="display: grid; gap: 0.25rem;">
				<span style="font-size: 0.9rem;">Email</span>
				<input name="email" type="email" required style="padding: 0.6rem; border-radius: 8px; border: 1px solid #d0d7de;" />
			</label>
			<label style="display: grid; gap: 0.25rem;">
				<span style="font-size: 0.9rem;">Password</span>
				<input name="password" type="password" required style="padding: 0.6rem; border-radius: 8px; border: 1px solid #d0d7de;" />
			</label>
			<button type="submit" style="padding: 0.7rem; border-radius: 999px; border: none; background: #0969da; color: #fff; cursor: pointer;">Sign in</button>
		</form>
	{:else}
		<form method="POST" action="?/signUp" use:enhance style="display: grid; gap: 0.75rem;">
			<label style="display: grid; gap: 0.25rem;">
				<span style="font-size: 0.9rem;">Name</span>
				<input name="name" type="text" required style="padding: 0.6rem; border-radius: 8px; border: 1px solid #d0d7de;" />
			</label>
			<label style="display: grid; gap: 0.25rem;">
				<span style="font-size: 0.9rem;">Email</span>
				<input name="email" type="email" required style="padding: 0.6rem; border-radius: 8px; border: 1px solid #d0d7de;" />
			</label>
			<label style="display: grid; gap: 0.25rem;">
				<span style="font-size: 0.9rem;">Password</span>
				<input name="password" type="password" required minlength="8" style="padding: 0.6rem; border-radius: 8px; border: 1px solid #d0d7de;" />
			</label>
			<fieldset style="border: 1px solid #d0d7de; border-radius: 8px; padding: 0.6rem; display: grid; gap: 0.4rem;">
				<legend style="font-size: 0.9rem; padding: 0 0.35rem;">I am a…</legend>
				<label style="display: flex; gap: 0.5rem; align-items: center;">
					<input type="radio" name="role" value="contractor" required />
					<span>Contractor / service provider</span>
				</label>
				<label style="display: flex; gap: 0.5rem; align-items: center;">
					<input type="radio" name="role" value="customer" checked />
					<span>Customer</span>
				</label>
			</fieldset>
			<button type="submit" style="padding: 0.7rem; border-radius: 999px; border: none; background: #0969da; color: #fff; cursor: pointer;">Create account</button>
		</form>
	{/if}

	<form method="POST" action="?/signInGithub" use:enhance>
		<button type="submit" style="width: 100%; padding: 0.7rem; border-radius: 999px; border: 1px solid #d0d7de; background: #f6f8fa; cursor: pointer;">Continue with GitHub</button>
	</form>
</div>
