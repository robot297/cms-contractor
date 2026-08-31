<script lang="ts">
	import { fly } from 'svelte/transition';
	import { toast } from '$lib/toast.svelte';

	/**
	 * Renders the toast stack. Mounted once, in the contractor layout, so it sits
	 * above every surface rather than inside whichever card raised it.
	 *
	 * Bottom of the viewport: the nav bar owns the top, and on a phone the bottom is
	 * where a thumb already is for the dismiss.
	 */
	const TICKS: Record<string, string> = { success: '✓', error: '!', info: 'i' };
</script>

<!-- `polite` rather than `assertive`: these confirm an action the user just took,
     so they should be announced at the next natural pause, not cut across whatever
     the screen reader is currently saying. -->
<div class="toaster" role="region" aria-live="polite" aria-label="Notifications">
	{#each toast.toasts as t (t.id)}
		<div class="toast {t.tone}" transition:fly={{ y: 12, duration: 180 }}>
			<div class="toast-row">
				<span class="toast-tick" aria-hidden="true">{TICKS[t.tone] ?? 'i'}</span>
				<span class="toast-text">
					<strong>{t.message}</strong>
					{#if t.detail}<span class="toast-detail">{t.detail}</span>{/if}
				</span>
				<button
					type="button"
					class="toast-dismiss"
					aria-label="Dismiss notification"
					onclick={() => toast.dismiss(t.id)}>✕</button
				>
			</div>
			<!-- The countdown made visible. Decorative — the ✕ is the accessible
			     dismissal, and the toast clears itself whether or not this ran. -->
			<div class="toast-bar" aria-hidden="true">
				<span class="toast-bar-fill" style="animation-duration: {t.durationMs}ms;"></span>
			</div>
		</div>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		left: 50%;
		bottom: max(1rem, env(safe-area-inset-bottom));
		transform: translateX(-50%);
		z-index: 60;
		display: grid;
		gap: 0.5rem;
		width: min(26rem, calc(100vw - 1.5rem));
		/* The container spans the width so toasts line up, but only the toasts
		   themselves should catch a click — the page underneath stays usable. */
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		display: grid;
		gap: 0.5rem;
		padding: 0.7rem 0.75rem;
		border: 1px solid #d0d7de;
		border-radius: 12px;
		background: #fff;
		color: #1f2328;
		font-size: 0.88rem;
		line-height: 1.45;
		box-shadow: 0 8px 28px rgba(27, 31, 36, 0.18);
	}
	.toast.success {
		border-color: #b7e0c4;
		background: #eaf6ee;
		color: #14532d;
	}
	.toast.error {
		border-color: #f0c0c4;
		background: #fdeff0;
		color: #a40e26;
	}
	.toast-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.toast-tick {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.15rem;
		height: 1.15rem;
		border-radius: 999px;
		background: #57606a;
		color: #fff;
		font-size: 0.72rem;
		font-weight: 800;
	}
	.toast.success .toast-tick {
		background: #1f883d;
	}
	.toast.error .toast-tick {
		background: #cf222e;
	}
	.toast-text {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.1rem;
	}
	.toast-detail {
		font-size: 0.8rem;
		opacity: 0.85;
	}
	.toast-dismiss {
		flex-shrink: 0;
		width: 1.5rem;
		height: 1.5rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin: -0.15rem -0.15rem 0 0;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 999px;
		background: none;
		color: inherit;
		font-size: 0.78rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0.6;
	}
	.toast-dismiss:hover {
		opacity: 1;
		background: rgba(27, 31, 36, 0.08);
	}
	/* A track that stays put with a fill that drains, so the time left reads at a
	   glance without a number. Driven by the toast's own duration so the bar can
	   never disagree with the timer. */
	.toast-bar {
		height: 3px;
		border-radius: 999px;
		background: rgba(27, 31, 36, 0.12);
		overflow: hidden;
	}
	.toast-bar-fill {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: #57606a;
		transform-origin: left center;
		animation-name: toast-drain;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
	}
	.toast.success .toast-bar-fill {
		background: #1f883d;
	}
	.toast.error .toast-bar-fill {
		background: #cf222e;
	}
	@keyframes toast-drain {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}
	/* A five-second animated bar is exactly what this setting is asking about. The
	   toast still clears on schedule; only the motion stops. */
	@media (prefers-reduced-motion: reduce) {
		.toast-bar-fill {
			animation: none;
		}
	}

	/* Dark theme. The tinted toasts carry their own pairs — their light values are
	   hand-picked rather than token-derived. */
	:global(:root[data-theme='dark']) .toast {
		background: var(--surface);
		border-color: var(--line-strong);
		color: var(--fg);
		box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
	}
	:global(:root[data-theme='dark']) .toast.success {
		background: #14301f;
		border-color: #2f6b45;
		color: #b7ecc6;
	}
	:global(:root[data-theme='dark']) .toast.error {
		background: #3a1f24;
		border-color: #7a3540;
		color: #ffbcc4;
	}
	:global(:root[data-theme='dark']) .toast-dismiss:hover {
		background: rgba(255, 255, 255, 0.12);
	}
	:global(:root[data-theme='dark']) .toast-bar {
		background: rgba(255, 255, 255, 0.14);
	}
	:global(:root[data-theme='dark']) .toast.success .toast-bar-fill {
		background: #4ac26b;
	}
	:global(:root[data-theme='dark']) .toast.error .toast-bar-fill {
		background: #ff7b72;
	}
</style>
