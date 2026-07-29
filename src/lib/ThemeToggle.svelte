<script lang="ts">
	import { onMount } from 'svelte';
	import { theme } from '$lib/theme.svelte';

	// The signed-out pages (landing, login) have no nav bar to host the toggle, so
	// it pins itself to the top-right of the viewport instead.
	onMount(() => {
		theme.sync();
	});

	const label = $derived(
		theme.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
	);
</script>

<button
	type="button"
	class="theme-toggle"
	title={label}
	aria-label={label}
	onclick={() => theme.toggle()}
>
	{#if theme.current === 'dark'}
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="4.5" />
			<path
				d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
			/>
		</svg>
	{:else}
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
		</svg>
	{/if}
</button>

<style>
	/* Just the icon — no fill, no border, no shadow. The hit area stays a comfortable
	   2.4rem square so it's easy to tap; only the icon colour responds. */
	.theme-toggle {
		position: fixed;
		top: 1rem;
		right: 1rem;
		z-index: 60;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border: none;
		border-radius: 8px;
		background: none;
		box-shadow: none;
		color: var(--fg-muted);
		cursor: pointer;
		transition: color 0.16s ease;
	}
	.theme-toggle:hover {
		color: var(--fg);
	}
	.theme-toggle:focus-visible {
		outline: 2px solid var(--yellow);
		outline-offset: 2px;
	}
	.theme-toggle svg {
		display: block;
	}
	@media (max-width: 480px) {
		.theme-toggle {
			top: 0.6rem;
			right: 0.6rem;
		}
	}
</style>
