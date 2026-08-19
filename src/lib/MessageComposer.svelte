<script lang="ts">
	/**
	 * The box you write a message in. Used by both ends of a Thread.
	 *
	 * `MessageThread` unified how a conversation READS; this unifies how it is
	 * written, which was the other half of the jank. The two surfaces had
	 * separately hand-rolled composers that disagreed about nearly everything: one
	 * was a fixed two-row box with a rectangular "Reply" button, the other a
	 * growing pill with a round send; one sent on ⌘/Ctrl+Enter, the other only on
	 * click; one cleared its draft on success, the other cleared it always. Two
	 * halves of one conversation should not feel like two products.
	 *
	 * Deliberately NOT part of MessageThread: a thread is readable on surfaces
	 * where you cannot write (a Guest subcontractor, the impersonated portal
	 * view), and folding the composer in would make every reader a writer.
	 *
	 * Colour comes from the same `--thread-*` tokens the thread uses, so the
	 * composer belongs to the conversation above it without either surface
	 * restating its palette.
	 */
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';

	let {
		/** Form action to post to, e.g. `?/send`. */
		action,
		/** Placeholder — the only copy that is genuinely per-surface. */
		placeholder,
		/** Disables the whole thing and explains why, in place of the placeholder. */
		disabledReason = null,
		/** Extra hidden fields, if the surface needs any. */
		hidden = {},
		/**
		 * Called with the sent text after a successful send. When provided, the
		 * composer does NOT reload the page — the parent owns the aftermath (e.g. the
		 * dashboard shows the reply in place rather than reloading, which would drop
		 * the just-answered card and yank the whole panel away). Without it the
		 * composer reloads as before, which is what the customer portal wants.
		 */
		onsent = undefined
	}: {
		action: string;
		placeholder: string;
		disabledReason?: string | null;
		hidden?: Record<string, string>;
		onsent?: (body: string) => void;
	} = $props();

	let body = $state('');
	let sending = $state(false);
	let el = $state<HTMLTextAreaElement | null>(null);
	const empty = $derived(body.trim().length === 0);

	/**
	 * ⌘/Ctrl+Enter sends; plain Enter is a newline.
	 *
	 * Not Enter-to-send. That is right for a chat app you live in and wrong here:
	 * these are people writing a paragraph about their kitchen, often on a phone,
	 * and reaching for return should not post half of it.
	 */
	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !empty) {
			event.preventDefault();
			(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
		}
	}
</script>

{#if disabledReason}
	<div class="composer">
		<textarea disabled rows="1" placeholder={disabledReason}></textarea>
		<button type="button" class="send" disabled aria-label="Send">
			{@render sendIcon()}
		</button>
	</div>
{:else}
	<form
		method="POST"
		{action}
		class="composer"
		use:enhance={() => {
			sending = true;
			return async ({ result, update }) => {
				sending = false;
				if (result.type === 'success') {
					const sent = body;
					// Only clear on success. Clearing regardless is how a refused send
					// loses what someone just typed.
					body = '';
					// With an onsent handler the parent shows the message in place; a
					// reload here would undo that (and, on the dashboard, remove the card
					// the panel lives in). Without one, reload as before.
					if (onsent) onsent(sent);
					else await update();
					await tick();
					el?.focus();
				} else {
					await update();
				}
			};
		}}
	>
		{#each Object.entries(hidden) as [name, value] (name)}
			<input type="hidden" {name} {value} />
		{/each}
		<textarea
			name="body"
			bind:value={body}
			bind:this={el}
			rows="1"
			{placeholder}
			disabled={sending}
			onkeydown={onKeydown}></textarea>
		<button
			type="submit"
			class="send"
			disabled={sending || empty}
			aria-label={sending ? 'Sending' : 'Send message'}
			title="Send  (⌘↵)"
		>
			{@render sendIcon()}
		</button>
	</form>
{/if}

{#snippet sendIcon()}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M4 12h15" />
		<path d="m12.5 5.5 6.5 6.5-6.5 6.5" />
	</svg>
{/snippet}

<style>
	.composer {
		display: flex;
		align-items: flex-end;
		gap: 0.45rem;
		min-width: 0;
	}
	textarea {
		flex: 1;
		min-width: 0;
		box-sizing: border-box;
		resize: none;
		/* Grows with what is typed, then scrolls. A fixed box is too tall for "yes
		   thanks" and too short for a real question. */
		field-sizing: content;
		min-height: 2.6rem;
		max-height: 9rem;
		font: inherit;
		/* 16px+: anything smaller makes iOS zoom the page on focus. */
		font-size: 1rem;
		line-height: 1.45;
		padding: 0.6rem 0.8rem;
		border-radius: 16px;
		border: 1px solid var(--field-border);
		background: var(--field-bg);
		color: var(--fg);
	}
	textarea:focus {
		outline: 2px solid var(--thread-mine-hue, var(--line-strong));
		outline-offset: 1px;
		border-color: transparent;
		background: var(--field-bg-focus);
	}
	textarea:disabled {
		opacity: 0.6;
	}
	.send {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.6rem;
		height: 2.6rem;
		border: none;
		border-radius: 999px;
		/* The sender's own colour, so the button belongs to the bubbles it produces. */
		background: var(--thread-mine-hue, var(--line-strong));
		color: var(--send-fg, #14171c);
		font-family: inherit;
		cursor: pointer;
	}
	.send svg {
		width: 1.15rem;
		height: 1.15rem;
	}
	.send:hover:not(:disabled) {
		filter: brightness(0.92);
	}
	.send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
