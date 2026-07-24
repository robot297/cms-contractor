<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();
	let mode = $state<'signIn' | 'signUp'>('signIn');
	let demoLoading = $state(false);
</script>

<svelte:head>
	<title>{mode === 'signIn' ? 'Sign in' : 'Create account'}</title>
</svelte:head>

<div class="wrap">
	<div class="card">
		<h1 class="brand">🏗️ Contractor&nbsp;CRM</h1>

		{#if data.demoEnabled}
			<form
				method="POST"
				action="?/demo"
				use:enhance={() => {
					demoLoading = true;
					return async ({ update }) => {
						await update();
						demoLoading = false;
					};
				}}
			>
				<button type="submit" class="demo" disabled={demoLoading}>
					{demoLoading ? 'Setting up your demo…' : '▶  Explore the live demo'}
				</button>
			</form>

			<div class="divider"><span>or</span></div>
		{/if}

		<div class="tabs">
			<button type="button" class:active={mode === 'signIn'} onclick={() => (mode = 'signIn')}
				>Sign in</button
			>
			<button type="button" class:active={mode === 'signUp'} onclick={() => (mode = 'signUp')}
				>Sign up</button
			>
		</div>

		{#if form?.message}
			<p class="error">{form.message}</p>
		{/if}

		{#if mode === 'signIn'}
			<form method="POST" action="?/signIn" use:enhance class="fields">
				<label>Email<input name="email" type="email" required autocomplete="email" /></label>
				<label
					>Password<input
						name="password"
						type="password"
						required
						autocomplete="current-password"
					/></label
				>
				<button type="submit" class="primary">Sign in</button>
			</form>
		{:else}
			<form method="POST" action="?/signUp" use:enhance class="fields">
				<label>Name<input name="name" type="text" required /></label>
				<label>Email<input name="email" type="email" required autocomplete="email" /></label>
				<label
					>Password<input
						name="password"
						type="password"
						required
						minlength="8"
						autocomplete="new-password"
					/></label
				>
				<button type="submit" class="primary">Create account</button>
			</form>
		{/if}

		<form method="POST" action="?/signInGithub" use:enhance>
			<button type="submit" class="github">Continue with GitHub</button>
		</form>
	</div>
</div>

<style>
	.wrap {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem 1rem;
	}
	.card {
		width: 100%;
		max-width: 380px;
		display: grid;
		gap: 1rem;
		background: #fff;
		border: 1px solid #e6e8eb;
		border-radius: 18px;
		padding: 1.75rem 1.5rem;
		box-shadow: 0 10px 30px rgba(17, 17, 17, 0.06);
	}
	/* Clean wordmark — opt out of the global chunky-yellow h1 treatment. */
	.brand {
		margin: 0 0 0.25rem;
		text-align: center;
		font-family: 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif;
		font-size: 1.4rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		text-transform: none;
		color: #1f2328;
		background: none;
		border: none;
		border-radius: 0;
		box-shadow: none;
		padding: 0;
		display: block;
	}
	.demo {
		width: 100%;
		padding: 0.85rem;
		border: none;
		border-radius: 12px;
		background: #ffcc00;
		color: #1f2328;
		font-weight: 700;
		font-size: 0.95rem;
		cursor: pointer;
		transition: background 0.12s ease;
	}
	.demo:hover:not(:disabled) {
		background: #f0be00;
	}
	.demo:disabled {
		opacity: 0.7;
		cursor: default;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: #b3b9c2;
		font-size: 0.8rem;
	}
	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: #ececf0;
	}
	.tabs {
		display: flex;
		gap: 0.3rem;
		background: #f4f5f7;
		border-radius: 10px;
		padding: 0.25rem;
	}
	.tabs button {
		flex: 1;
		padding: 0.5rem;
		border: none;
		border-radius: 8px;
		background: none;
		color: #57606a;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.tabs button.active {
		background: #fff;
		color: #1f2328;
		box-shadow: 0 1px 2px rgba(17, 17, 17, 0.08);
	}
	.fields {
		display: grid;
		gap: 0.75rem;
	}
	.fields label {
		display: grid;
		gap: 0.3rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: #57606a;
	}
	.fields input {
		padding: 0.6rem 0.7rem;
		border: 1.5px solid #d9dde3;
		border-radius: 9px;
		font-size: 0.95rem;
		background: #fff;
		color: #1f2328;
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.fields input:focus {
		outline: none;
		border-color: #a98be2;
		box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
	}
	.primary {
		padding: 0.7rem;
		border: none;
		border-radius: 10px;
		background: #1f2328;
		color: #fff;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		transition: background 0.12s ease;
	}
	.primary:hover {
		background: #000;
	}
	.error {
		margin: 0;
		color: #cf222e;
		font-size: 0.88rem;
	}
	.github {
		width: 100%;
		padding: 0.65rem;
		border: 1.5px solid #d9dde3;
		border-radius: 10px;
		background: #fff;
		color: #1f2328;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.github:hover {
		background: #f7f8fa;
	}
</style>
