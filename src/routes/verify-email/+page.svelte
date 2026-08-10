<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ThemeToggle from '$lib/ThemeToggle.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Verify your email</title></svelte:head>

<ThemeToggle />

<div class="wrap">
	<div class="card">
		<span class="mark" aria-hidden="true">✉️</span>
		<h1 class="title">Verify your email</h1>
		<p class="lede">
			The app is locked until <strong>{data.email}</strong> is confirmed. Open the verification link we
			sent you — then you're in.
		</p>

		{#if form?.resent}
			<p class="ok" role="status">Sent — check your inbox (and spam folder).</p>
		{:else if form?.message}
			<p class="err" role="alert">{form.message}</p>
		{/if}

		<form method="POST" action="?/resend" use:enhance>
			<button type="submit" class="primary">Resend the verification email</button>
		</form>

		<form method="POST" action={resolve('/logout')}>
			<button type="submit" class="quiet">Sign out</button>
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
		max-width: 400px;
		display: grid;
		gap: 0.8rem;
		justify-items: center;
		text-align: center;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 18px;
		padding: 2rem 1.5rem 1.5rem;
		box-shadow: var(--card-shadow);
	}
	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		border-radius: 14px;
		background: linear-gradient(180deg, var(--yellow), var(--yellow-deep));
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.5),
			0 2px 8px rgba(230, 184, 0, 0.35);
		font-size: 1.4rem;
	}
	/* Opt out of the global yellow-chip h1 treatment. */
	.title {
		margin: 0;
		background: none;
		border: none;
		box-shadow: none;
		padding: 0;
		font-size: 1.25rem;
		color: var(--fg);
	}
	.lede {
		margin: 0;
		font-size: 0.92rem;
		line-height: 1.55;
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}
	.ok {
		margin: 0;
		padding: 0.5rem 0.7rem;
		border: 1px solid #b7e0c4;
		border-radius: 10px;
		background: #eaf6ee;
		color: #14532d;
		font-size: 0.85rem;
	}
	:global(:root[data-theme='dark']) .ok {
		background: #14301f;
		border-color: #2f6b45;
		color: #b7ecc6;
	}
	.err {
		margin: 0;
		color: #cf222e;
		font-size: 0.85rem;
	}
	:global(:root[data-theme='dark']) .err {
		color: #ff8f8a;
	}
	.primary {
		padding: 0.6rem 1.1rem;
		border: none;
		border-radius: 10px;
		background: var(--yellow);
		color: #14171c;
		font: inherit;
		font-size: 0.88rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.primary:hover {
		background: var(--yellow-deep);
	}
	.quiet {
		border: none;
		background: none;
		padding: 0.3rem 0.5rem;
		color: var(--fg-muted);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
	}
	.quiet:hover {
		color: var(--fg);
	}
</style>
