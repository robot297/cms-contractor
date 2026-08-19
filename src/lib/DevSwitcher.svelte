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
		<button type="submit" class="dev-switch" title="Development only — open the {other} side">
			Switch view
		</button>
	</form>
{/if}

<style>
	.dev-form {
		display: contents;
	}
	/* Amber, in neither side's palette, so it cannot be mistaken for real chrome —
	   but quiet, because it sits among controls that are. */
	.dev-switch {
		flex-shrink: 0;
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--yellow-deep);
		border-radius: 999px;
		background: color-mix(in srgb, var(--yellow) 22%, transparent);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.dev-switch:hover {
		background: var(--yellow);
		color: var(--on-yellow);
	}
</style>
