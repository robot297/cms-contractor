<script lang="ts">
	/**
	 * Development-only: one button to the other side of the product.
	 *
	 * Comparing both halves of a job used to mean a sign-out, a sign-in and finding
	 * the order again. This is that round trip, as a button — and it lands on the
	 * SAME job wherever the destination can see it.
	 *
	 * Deliberately one control with no options on it. An earlier version offered
	 * "view as" and "sign in as" from a menu, with a segmented indicator saying
	 * which side you were on; all of that was chrome in the way of the one thing
	 * anyone wanted. The mechanism is picked here instead: a real session swap when
	 * the seeded logins exist (writes work, both directions symmetric), falling back
	 * to read-only impersonation when they do not.
	 *
	 * Renders nothing unless there is somewhere to go, so a build without the dev
	 * flags has no trace of it in the DOM.
	 */
	let {
		side,
		/** True when the current view is impersonated rather than a real session. */
		viewing = false,
		/** The seeded dev customer to view as, when there is one. */
		devCustomer = null,
		/** Whether the real-session swap is available (needs SEED_DEV_LOGIN too). */
		canSignInAs = false,
		/** The order on screen, so the switch lands on the same job. */
		orderId = null
	}: {
		side: 'contractor' | 'customer';
		viewing?: boolean;
		devCustomer?: { id: string; name: string } | null;
		canSignInAs?: boolean;
		orderId?: string | null;
	} = $props();

	const other = $derived(side === 'contractor' ? 'customer' : 'contractor');

	/**
	 * There is no visible label any more — the glyph is the control and the
	 * accessible name carries the words. It is kept in the aria text rather than
	 * dropped because the ambiguity that shaped it is still real: sitting in the
	 * contractor bar, the destination read as a description of the bar and people
	 * concluded they were already on the customer side. So the name says both
	 * halves — where you are, then where the press goes.
	 *
	 * "Customer", not "Client": CONTEXT.md makes Customer the canonical term and
	 * lists Client under _Avoid_.
	 */
	const goesTo = $derived(other === 'customer' ? 'customer' : 'contractor');

	/**
	 * Which endpoint gets us there, in order of fidelity:
	 *   - a real session swap, when the seeded logins are there;
	 *   - dropping the impersonation cookie, when that is all we are in;
	 *   - entering impersonation, when there is a seeded customer to point at.
	 * Null when none apply, and then nothing renders.
	 */
	const target = $derived.by(() => {
		if (canSignInAs) return { action: '/dev/sign-in-as', as: other, customerId: null };
		if (viewing) return { action: '/dev/view-as', as: null, customerId: null };
		if (side === 'contractor' && devCustomer)
			return { action: '/dev/view-as', as: null, customerId: devCustomer.id };
		return null;
	});
</script>

{#if target}
	<form method="POST" action={target.action} class="dev-form">
		{#if target.as}<input type="hidden" name="as" value={target.as} />{/if}
		{#if target.customerId}<input type="hidden" name="customerId" value={target.customerId} />{/if}
		{#if orderId}<input type="hidden" name="orderId" value={orderId} />{/if}
		<!-- Icon only. The label spelled out which side you were on, which was worth
		     a whole button while the control was new and its two readings ("where I
		     am" vs "where this goes") were both live. Once you know what it does, the
		     words are a caption on a glyph that already says it — and this is dev
		     chrome sitting in a bar with real controls, so it should take the least
		     room that still reads. The title and the accessible name still say both
		     halves out loud, and the lit dot rides the glyph so the status is not
		     lost with the text. -->
		<button
			type="submit"
			class="dev-switch"
			title="Development only — you are on the {side} side; switch to the {goesTo} side"
			aria-label="You are on the {side} side. Switch to the {goesTo} side."
		>
			<span class="dev-swap" aria-hidden="true">⇄</span>
			<span class="dev-dot" aria-hidden="true"></span>
		</button>
	</form>
{/if}

<style>
	.dev-form {
		display: contents;
	}
	/* Sits among real chrome and has to read as a status rather than a nav
	   control, so it borrows the bar's own tokens and stays quiet — the lit dot
	   and the swap glyph carry the two things it has to say. */
	.dev-switch {
		position: relative;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-control);
		background: var(--bar-wash, var(--surface-sunken));
		color: var(--bar-fg, var(--fg));
		font-family: inherit;
		cursor: pointer;
	}
	/* A lit dot, the way a status indicator reads. Says "this is what is
	   currently true" rather than "press me to make this true". */
	/* Pinned to the corner now that there is no label to sit beside. Still the
	   status half of this control: it says the side is live, the glyph says the
	   press swaps it. */
	.dev-dot {
		position: absolute;
		top: -2px;
		right: -2px;
		width: 6px;
		height: 6px;
		flex: none;
		border-radius: 999px;
		background: var(--brand);
		/* Empty and decorative, so this never renders. Declared anyway because the
		   fill and its foreground must not be separable — the same rule
		   `.rail-glide` follows, enforced by theme.contrast.test.ts. */
		color: var(--on-brand);
		box-shadow: 0 0 6px var(--brand-glow);
	}
	/* The affordance. Without it the label alone is a caption, which is exactly
	   how the old wording got misread. */
	.dev-swap {
		font-size: 1rem;
		line-height: 1;
		color: var(--bar-fg-dim, var(--fg-muted));
	}
	.dev-switch:hover {
		border-color: var(--brand);
		box-shadow: 0 0 0 1px var(--brand-glow);
	}
	.dev-switch:hover .dev-swap {
		color: var(--brand);
	}
	.dev-switch:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
</style>
