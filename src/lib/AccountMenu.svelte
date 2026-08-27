<script lang="ts">
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';

	/**
	 * The avatar in the nav bar, and everything behind it.
	 *
	 * One square in the bar; the signed-in name, the account links and sign-out all
	 * live in the menu it opens. That was built for the contractor bar — a name and
	 * a red SIGN OUT button sitting in the bar was the widest thing in it, and the
	 * first thing to collide with anything else once the rail tightened up — and the
	 * portal bar had none of it: a bare "Sign out" pill, no avatar, and no way at
	 * all to reach the account page above the phone breakpoint, where the bottom tab
	 * bar that used to carry it is hidden.
	 *
	 * Shared rather than copied, because the copy is the failure mode: the two bars
	 * had already drifted into two different answers to the same question, and a
	 * second hand-written menu would only have set the next drift up.
	 *
	 * COLOUR comes from the shell, not from here. Each half of the product has its
	 * own — the contractor's safety yellow, the portal's teal — so this reads
	 * `--bar-accent` / `--bar-accent-fg`, which each layout defines once on its
	 * `.shell`. Custom properties resolve where they are used, so a shell that
	 * points `--bar-accent` at a token which itself flips in dark mode still gets
	 * the flipped value here.
	 */
	type Item = {
		label: string;
		/**
		 * Already run through `resolve()` by the caller.
		 *
		 * Typed off `ResolvedPathname` rather than `string` so that is enforced by
		 * the compiler: this component cannot call `resolve()` itself, because the
		 * routes it links to belong to whichever bar mounted it.
		 *
		 * The query-string form is for tab destinations — the portal's Support entry
		 * points at `/customer/account?tab=support`, since Account holds several
		 * panes and landing on the wrong one is not the same as arriving. Still
		 * anchored to a resolved pathname, so a bare string is refused.
		 */
		href: ResolvedPathname | `${ResolvedPathname}?${string}`;
		/** Marks the section the user is currently in. */
		active?: boolean;
		/** Renders in the destructive tone, fenced off above by a rule. */
		danger?: boolean;
	};

	let {
		name,
		/** Small second line under the name — a trial countdown, a role, a plan. */
		subline,
		items = [],
		/**
		 * Whether to offer sign-out. False where there is no session of one's own to
		 * end — the portal's development view-as is somebody else's session being
		 * borrowed, and signing it out would sign out the contractor.
		 */
		canSignOut = true,
		/** Lets the surrounding bar close its own menu when a link here is followed. */
		onnavigate
	}: {
		name: string;
		subline?: string;
		items?: Item[];
		canSignOut?: boolean;
		onnavigate?: () => void;
	} = $props();

	let open = $state(false);

	/** Two letters at most — "Jo Bloggs" → JB, "testerooni" → T. */
	const initials = $derived(
		(name ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);

	// Close on navigation. The click handler below covers following a link to a
	// different page; this covers everything else that changes the route, including
	// the back button.
	$effect(() => {
		void page.url.pathname;
		open = false;
	});

	function follow() {
		open = false;
		onnavigate?.();
	}
</script>

<div class="user">
	<button
		type="button"
		class="avatar"
		class:on={open}
		aria-haspopup="menu"
		aria-expanded={open}
		title={name}
		aria-label="Account menu"
		onclick={() => (open = !open)}>{initials}</button
	>
	{#if open}
		<!-- Click-away. Without it the only way out is the avatar itself, which
		     reads as a stuck menu rather than a deliberate one. -->
		<button
			type="button"
			class="user-scrim"
			aria-label="Close account menu"
			onclick={() => (open = false)}
		></button>
		<div class="user-menu" role="menu">
			<div class="user-menu-head">
				<span class="user-menu-name">{name}</span>
				{#if subline}<span class="user-menu-sub">{subline}</span>{/if}
			</div>
			{#each items as item (item.href)}
				<!-- eslint-disable svelte/no-navigation-without-resolve --
				     `item.href` IS resolved: the type above is built from
				     `ResolvedPathname`, which only `resolve()` produces. The rule is
				     syntactic and looks for a literal call it cannot find here, so the
				     compiler holds the guarantee instead.

				     A block disable rather than `-next-line`: the rule reports on the
				     `href` attribute, not on the `<a` that follows the comment, so a
				     one-line exemption sat on the wrong line. It went unnoticed while
				     the type was exactly `ResolvedPathname` — the rule let that
				     through on its own and had nothing to report. -->
				<a
					class="user-menu-item"
					class:is-active={item.active}
					class:danger={item.danger}
					role="menuitem"
					href={item.href}
					onclick={follow}>{item.label}</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/each}
			{#if canSignOut}
				<form method="POST" action="/logout">
					<button type="submit" class="user-menu-item danger" role="menuitem">Sign out</button>
				</form>
			{/if}
		</div>
	{/if}
</div>

<style>
	.user {
		position: relative;
		flex: none;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border-radius: 999px;
		border: 1.5px solid var(--bar-edge);
		background: var(--bar-wash);
		color: var(--bar-fg);
		font-family: inherit;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.02em;
		line-height: 1;
		cursor: pointer;
	}
	.avatar:hover,
	.avatar.on {
		background: var(--bar-accent);
		border-color: var(--bar-accent);
		color: var(--bar-accent-fg);
	}
	.avatar:focus-visible {
		outline: 2px solid var(--bar-accent);
		outline-offset: 2px;
	}
	.user-scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		border: none;
		background: transparent;
		cursor: default;
	}
	.user-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		z-index: 100;
		box-sizing: border-box;
		min-width: 13rem;
		max-width: calc(100vw - 2rem);
		padding: 0.35rem;
		display: grid;
		gap: 0.1rem;
		/* The page's surface, not the bar's: this is a panel over the content, and
		   painting it in the bar's gradient made it read as part of the chrome. */
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: 12px;
		box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
	}
	.user-menu-head {
		display: grid;
		gap: 0.1rem;
		padding: 0.45rem 0.6rem 0.55rem;
		margin-bottom: 0.15rem;
		border-bottom: 1px solid var(--line);
	}
	.user-menu-name {
		font-size: 0.88rem;
		font-weight: 800;
		color: var(--fg);
		/* A name has no spaces to break at when it is one long word. */
		overflow-wrap: anywhere;
	}
	.user-menu-sub {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--fg-muted);
	}
	.user-menu-item {
		display: block;
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.6rem;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--fg);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.user-menu-item:hover {
		background: var(--surface-sunken);
	}
	.user-menu-item.is-active {
		color: var(--fg);
		background: color-mix(in srgb, var(--bar-accent) 22%, var(--surface));
	}
	.user-menu-item.danger {
		color: var(--danger);
	}
	.user-menu-item:focus-visible {
		outline: 2px solid var(--bar-accent);
		outline-offset: -2px;
	}
</style>
