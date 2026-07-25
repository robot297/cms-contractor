<script lang="ts">
	import { untrack } from 'svelte';
	import { normalizePreferredContact } from '$lib/crm';

	let {
		customer,
		rows = 3,
		onsent
	}: {
		customer: { name: string; email: string; phone: string | null; preferredContact: string };
		rows?: number;
		onsent?: () => void;
	} = $props();

	const preferred = $derived(normalizePreferredContact(customer.preferredContact));
	let method = $state<'email' | 'text'>('email');
	let text = $state('');

	// Reset the composer whenever it's pointed at a different customer, defaulting
	// the channel to their preferred messaging channel.
	$effect(() => {
		customer.email;
		untrack(() => {
			method = preferred === 'text' && customer.phone ? 'text' : 'email';
			text = '';
		});
	});

	function send() {
		if (!text.trim()) return;
		const body = encodeURIComponent(text.trim());
		if (method === 'text' && customer.phone) {
			window.location.href = `sms:${customer.phone.replace(/[^\d+]/g, '')}?&body=${body}`;
		} else {
			window.location.href = `mailto:${customer.email}?body=${body}`;
		}
		onsent?.();
	}
</script>

<div class="composer">
	<textarea
		bind:value={text}
		{rows}
		placeholder="Write a message to {customer.name}…"
		class="composer-text"
	></textarea>
	<div class="methods">
		<span class="via">Send via</span>
		<button
			type="button"
			class="chip"
			class:sel={method === 'email'}
			onclick={() => (method = 'email')}
		>
			✉️ Email{#if preferred === 'email'}<span class="star" title="Preferred">★</span>{/if}
		</button>
		{#if customer.phone}
			<button
				type="button"
				class="chip"
				class:sel={method === 'text'}
				onclick={() => (method = 'text')}
			>
				💬 Text{#if preferred === 'text'}<span class="star" title="Preferred">★</span>{/if}
			</button>
		{/if}
	</div>
	<div class="foot">
		<button type="button" class="send" onclick={send} disabled={!text.trim()}>
			Send {method === 'text' ? 'text' : 'email'}
		</button>
		{#if customer.phone}
			<a class="call" href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`}>
				📞 Call{#if preferred === 'call'}<span class="star" title="Preferred">★</span>{/if}
			</a>
		{/if}
	</div>
</div>

<style>
	.composer {
		display: grid;
		gap: 0.55rem;
	}
	.composer-text {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		padding: 0.55rem 0.65rem;
		border: 1.5px solid #d9dde3;
		border-radius: 10px;
		font-size: 0.92rem;
		font-family: inherit;
		color: #1f2328;
	}
	.composer-text:focus {
		outline: none;
		border-color: #a98be2;
		box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.16);
	}
	.methods {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.via {
		font-size: 0.78rem;
		color: #57606a;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.35rem 0.7rem;
		border: 1.5px solid #d9dde3;
		border-radius: 999px;
		background: #fff;
		color: #1f2328;
		font-weight: 600;
		font-size: 0.82rem;
		cursor: pointer;
		transition:
			border-color 0.12s ease,
			background 0.12s ease;
	}
	.chip:hover {
		background: #f6f8fa;
	}
	/* The chosen channel: shaded + ringed so the selection is obvious. */
	.chip.sel {
		background: #ede7fb;
		border-color: #a98be2;
		color: #4b2fa8;
	}
	.star {
		margin-left: 0.15rem;
		color: #b78900;
		font-size: 0.78rem;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		flex-wrap: wrap;
	}
	.send {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 10px;
		background: #1f2328;
		color: #fff;
		font-weight: 600;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.send:hover:not(:disabled) {
		background: #000;
	}
	.send:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.call {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #0969da;
		text-decoration: none;
	}
</style>
