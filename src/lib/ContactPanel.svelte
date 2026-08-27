<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ContactComposer from '$lib/ContactComposer.svelte';
	import MessageComposer from '$lib/MessageComposer.svelte';
	import MessageThread from '$lib/MessageThread.svelte';
	import { toast } from '$lib/toast.svelte';
	import type { PortalInfo } from '$lib/crm';

	/**
	 * The one way to reach somebody, wherever the app offers it.
	 *
	 * Four channels on a single tab strip — chat, email, text, call — over the
	 * three arrangements that grew up separately: a bare `ContactComposer` on the
	 * customers, orders and subcontractors pages, the same thing in a popover on
	 * the order workspace, and a thread-plus-composer stack on the dashboard. They
	 * drifted, as parallel implementations of one idea do: only one of them could
	 * show the conversation, and only one set the thread's participant colours.
	 *
	 * Every customer gets the same four channels. Chat is the conversation once
	 * they're on the portal, and the invite to it before then — so an unlinked
	 * customer sees a prompt to invite (or the sent/expired status) rather than a
	 * missing tab. Text and call appear only where there is a phone number; an
	 * offered channel that cannot work costs a click to discover, which is worse
	 * than not offering it.
	 */

	type Message = { id: string; body: string; authorRole: string; createdAt: Date | string };

	/**
	 * One job's conversation. A thread belongs to an ORDER, not to a person — the
	 * customer portal shows a customer their jobs, each with its own history — so
	 * a panel opened on somebody who has three jobs in flight has three
	 * conversations to choose between rather than one merged inbox.
	 */
	type Conversation = { orderId: string; projectName: string | null; thread: Message[] };

	let {
		contact,
		project = null,
		orderId = null,
		conversations = [],
		canChat = false,
		replyAction = '?/replyToCustomer',
		customerId = null,
		portal = null,
		inviteAction = '?/sendInvite',
		revokeAction = '?/revokeInvite',
		rows = 2,
		onsent,
		onclose,
		oninvited
	}: {
		contact: { name: string; email: string; phone: string | null; preferredContact: string };
		project?: string | null;
		/** Order to attribute an EMAIL to, where the surface has one in hand. */
		orderId?: string | null;
		/** Jobs that can be chatted about, newest first. Empty means no thread yet. */
		conversations?: Conversation[];
		/** Whether there is a portal to deliver a reply to. */
		canChat?: boolean;
		/** Form action the reply posts to — surfaces differ on whether it takes an id. */
		replyAction?: string;
		/** The customer to invite, when the Chat tab should offer a portal invite. */
		customerId?: string | null;
		/** Where the customer stands with the portal — drives the Chat tab for the
		 *  not-yet-linked case (prompt to invite, or the sent/expired status). */
		portal?: PortalInfo | null;
		/** Form action the invite posts to. */
		inviteAction?: string;
		/** Form action for withdrawing a pending invite. */
		revokeAction?: string;
		rows?: number;
		onsent?: () => void;
		/** When provided, the panel shows a header with a close (✕) button. */
		onclose?: () => void;
		/** Fired after an invite is sent, so the opener can react (close, etc.). */
		oninvited?: () => void;
	} = $props();

	type Tab = 'chat' | 'email' | 'text' | 'call';

	// Linked = they have a portal login. `portal` is authoritative when given;
	// `canChat` is the older per-surface flag kept for callers that don't pass one.
	const linked = $derived(portal ? portal.state === 'linked' : canChat);
	const chatAvailable = $derived(linked && conversations.length > 0);
	// The Chat tab can also be an invite: shown for a not-yet-linked customer we can
	// invite, so every customer gets the same four channels — chat is just an invite
	// prompt until they join.
	const canInvite = $derived(customerId != null && portal != null && portal.state !== 'linked');
	const showChatTab = $derived(chatAvailable || canInvite);

	let inviting = $state(false);
	function fmtDate(d?: Date | string): string {
		return d ? new Date(d).toLocaleDateString() : '';
	}
	const inviteEnhance: SubmitFunction = () => {
		inviting = true;
		const name = contact.name;
		// Any invite that already has an id is a re-send (pending or expired); only a
		// first invite (state 'none') is a fresh send.
		const resending = !!portal?.inviteId;
		return async ({ result, update }) => {
			inviting = false;
			await update();
			if (result.type === 'success') {
				toast.success(resending ? `Invite re-sent to ${name}` : `Invite sent to ${name}`, {
					detail: 'They’ll get an email with a link to their portal.'
				});
				oninvited?.();
			} else if (result.type === 'failure') {
				const msg = result.data?.message;
				toast.error(typeof msg === 'string' ? msg : 'That invite could not be sent');
			}
		};
	};
	const revokeEnhance: SubmitFunction = () => {
		const name = contact.name;
		return async ({ result, update }) => {
			await update();
			if (result.type === 'success') {
				toast.success(`Invite to ${name} withdrawn`);
				oninvited?.();
			} else if (result.type === 'failure') {
				toast.error('That invite could not be withdrawn');
			}
		};
	};

	/** Which job is being talked about. Defaults to the first, which is the newest. */
	let pickedOrderId = $state<string | null>(null);
	const conversation = $derived(
		conversations.find((c) => c.orderId === pickedOrderId) ?? conversations[0] ?? null
	);
	/** Step to the previous/next job when there are too many to show as tabs. */
	function stepProject(dir: 1 | -1) {
		if (!conversation) return;
		const i = conversations.findIndex((c) => c.orderId === conversation.orderId);
		const n = conversations.length;
		pickedOrderId = conversations[(i + dir + n) % n].orderId;
	}
	/** Emails are attributed to the job on show when there is one to attribute to. */
	const composerOrderId = $derived(conversation?.orderId ?? orderId);

	// Replies sent this session, shown in place beneath the loaded thread. The chat
	// composer doesn't reload on send (that would drop the dashboard card the panel
	// lives in), so the message appears here optimistically instead — you see it land,
	// then choose to head back rather than being thrown out the moment you hit send.
	let localReplies = $state<Message[]>([]);
	let justSent = $state(false);
	$effect(() => {
		// Reset the optimistic tail whenever the shown conversation changes.
		void conversation?.orderId;
		untrack(() => {
			localReplies = [];
			justSent = false;
		});
	});
	function onReplySent(text: string) {
		localReplies = [
			...localReplies,
			{
				id: `local-${localReplies.length}`,
				body: text,
				authorRole: 'contractor',
				createdAt: new Date()
			}
		];
		justSent = true;
	}
	const closePanel = () => (onclose ?? onsent)?.();

	const tabs = $derived.by(() => {
		const list: { id: Tab; label: string; icon: string }[] = [];
		if (showChatTab) list.push({ id: 'chat', label: 'Chat', icon: '💬' });
		// Only offer a channel that can actually work — an email tab for someone with
		// no address on file just leads to a dead compose box.
		if (contact.email) list.push({ id: 'email', label: 'Email', icon: '✉️' });
		if (contact.phone) {
			list.push({ id: 'text', label: 'Text', icon: '📱' });
			list.push({ id: 'call', label: 'Call', icon: '📞' });
		}
		return list;
	});
	// No email and no phone (and nothing to chat about) — there is simply no way to
	// reach them from here, so the panel says so instead of an empty composer.
	const noChannels = $derived(tabs.length === 0);

	let chosen = $state<Tab | null>(null);
	/**
	 * The tab on show: whatever was picked, unless that channel isn't on offer for
	 * this person — which is what happens when the panel is pointed at somebody
	 * else while it is open.
	 */
	const tab = $derived.by(() => {
		const fallback: Tab = tabs[0]?.id ?? 'email';
		if (!chosen) return fallback;
		return tabs.some((t) => t.id === chosen) ? chosen : fallback;
	});
</script>

<div class="panel">
	<div class="head">
		<span class="who">{contact.name}</span>
		{#if onclose}
			<button type="button" class="close" aria-label="Close" onclick={() => onclose?.()}>✕</button>
		{/if}
	</div>

	{#if tabs.length > 1}
		<div class="tabs" role="tablist" aria-label="How to reach them">
			{#each tabs as t (t.id)}
				<button
					type="button"
					role="tab"
					aria-selected={tab === t.id}
					class="tab"
					class:on={tab === t.id}
					onclick={() => (chosen = t.id)}
				>
					<span aria-hidden="true">{t.icon}</span>
					<span class="tab-label">{t.label}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if noChannels}
		<!-- Nothing to reach them on. Better to say it than to show a composer that
		     can't send anywhere. -->
		<p class="no-channels">
			No email or phone on file for {contact.name}. Add contact details to message them.
		</p>
	{:else if tab === 'chat'}
		{#if chatAvailable && conversation}
			<!-- Which job the chat is about — a customer's threads are per order, so the
			     answer has to land on the right one. Two or three jobs get a tab each;
			     more than that steps through with arrows. Either way the project is
			     always named, so a reply is never sent into an unlabelled thread. -->
			{#if conversations.length > 1 && conversations.length <= 3}
				<div class="proj-tabs" role="tablist" aria-label="Which job to talk about">
					{#each conversations as c (c.orderId)}
						<button
							type="button"
							role="tab"
							aria-selected={c.orderId === conversation.orderId}
							class="proj-tab"
							class:on={c.orderId === conversation.orderId}
							onclick={() => (pickedOrderId = c.orderId)}
						>
							{c.projectName ?? 'Untitled project'}
						</button>
					{/each}
				</div>
			{:else}
				<div class="proj-nav" class:has-arrows={conversations.length > 3}>
					{#if conversations.length > 3}
						<button
							type="button"
							class="proj-arrow"
							aria-label="Previous project"
							onclick={() => stepProject(-1)}>‹</button
						>
					{/if}
					<span class="proj-title">{conversation.projectName ?? 'Untitled project'}</span>
					{#if conversations.length > 3}
						<button
							type="button"
							class="proj-arrow"
							aria-label="Next project"
							onclick={() => stepProject(1)}>›</button
						>
					{/if}
				</div>
			{/if}
			<div class="chat">
				<MessageThread
					messages={[...conversation.thread, ...localReplies]}
					mineRole="contractor"
					otherName={contact.name}
					empty="No messages yet — say the first thing."
				/>
			</div>
			<MessageComposer
				action={replyAction}
				placeholder="Reply"
				hidden={{ orderId: conversation.orderId }}
				onsent={onReplySent}
			/>
			{#if justSent}
				<div class="sent-bar">
					<span class="sent-ok"><span aria-hidden="true">✓</span> Sent to {contact.name}</span>
					{#if onclose || onsent}
						<button type="button" class="sent-done" onclick={closePanel}>Done</button>
					{/if}
				</div>
			{/if}
		{:else}
			<!-- Not on the portal yet: the Chat channel is where they're invited to it. -->
			{@render invitePanel()}
		{/if}
	{:else}
		<ContactComposer
			customer={contact}
			{project}
			orderId={composerOrderId}
			{rows}
			channel={tab}
			{onsent}
		/>
	{/if}
</div>

{#snippet invitePanel()}
	<div class="invite">
		{#if portal?.state === 'pending'}
			<!-- Invite already out: the status, then the two things you can do with it —
			     send the link again, or take it back. -->
			<div class="invite-sent">
				<span class="invite-sent-mark" aria-hidden="true">✓</span>
				<span class="invite-sent-lines">
					<strong>Invite sent</strong>
					<span class="invite-sent-sub">Expires {fmtDate(portal.expiresAt)}</span>
				</span>
			</div>
			<div class="invite-actions">
				<form method="POST" action={inviteAction} use:enhance={inviteEnhance}>
					<input type="hidden" name="customerId" value={customerId} />
					{#if portal.inviteId}<input type="hidden" name="inviteId" value={portal.inviteId} />{/if}
					<button type="submit" class="invite-mini" disabled={inviting}>
						{inviting ? 'Sending…' : 'Resend'}
					</button>
				</form>
				{#if portal.inviteId}
					<form method="POST" action={revokeAction} use:enhance={revokeEnhance}>
						<input type="hidden" name="inviteId" value={portal.inviteId} />
						<button type="submit" class="invite-mini danger">Withdraw</button>
					</form>
				{/if}
			</div>
		{:else}
			<p class="invite-lede">
				{contact.name} isn't on the portal yet — invite them to message you here.
			</p>
			<form method="POST" action={inviteAction} use:enhance={inviteEnhance} class="invite-form">
				<input type="hidden" name="customerId" value={customerId} />
				{#if portal?.state === 'expired' && portal.inviteId}
					<input type="hidden" name="inviteId" value={portal.inviteId} />
				{/if}
				<button type="submit" class="invite-send" disabled={inviting}>
					{#if inviting}
						Sending…
					{:else if portal?.state === 'expired'}
						Resend invite
					{:else}
						Send app invite
					{/if}
				</button>
				{#if portal?.state === 'expired'}
					<span class="invite-note">The previous invite expired.</span>
				{/if}
			</form>
		{/if}
	</div>
{/snippet}

<style>
	.panel {
		display: grid;
		gap: 0.6rem;
		min-width: 0;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.who {
		font-size: 0.92rem;
		font-weight: 800;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.close {
		flex: none;
		border: none;
		background: none;
		padding: 0.1rem 0.2rem;
		font-size: 1.05rem;
		line-height: 1;
		color: var(--fg-muted);
		cursor: pointer;
	}
	.close:hover {
		color: var(--fg);
	}

	/* A rail with segments inside it, like the app's other segmented controls —
	   not four loose buttons, which is what a row of chips reads as once one of
	   them is highlighted. */
	.tabs {
		display: flex;
		gap: 0.15rem;
		padding: 0.2rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--surface-sunken);
	}
	.tab {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-width: 0;
		padding: 0.4rem 0.3rem;
		border: none;
		border-radius: 999px;
		background: none;
		color: var(--fg-muted);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: none;
		letter-spacing: normal;
		white-space: nowrap;
		cursor: pointer;
	}
	.tab:hover {
		color: var(--fg);
	}
	.tab.on {
		background: var(--brand);
		/* Pinned dark: yellow stays light in both themes. */
		color: var(--on-brand);
		box-shadow: var(--pop-shadow-sm);
	}
	.tab:focus-visible {
		outline: 2px solid var(--fg);
		outline-offset: 1px;
	}
	/* Below this the four labels stop fitting; the glyphs still say which is which
	   and the selected tab keeps its word. */
	@media (max-width: 420px) {
		.tab:not(.on) .tab-label {
			display: none;
		}
	}

	/* Which job the chat is about. Two or three get a tab each; more step with arrows. */
	.proj-tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0.2rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-sunken);
	}
	.proj-tab {
		flex: 1;
		min-width: 0;
		padding: 0.35rem 0.5rem;
		border: none;
		border-radius: 7px;
		background: none;
		color: var(--fg-muted);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The active job is coloured in with the app accent, matching the channel tabs —
	   a subtle raised tint didn't read clearly as "this is the one you're viewing". */
	.proj-tab.on {
		background: var(--brand);
		color: var(--on-brand);
		box-shadow: var(--pop-shadow-sm);
	}
	.proj-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.proj-nav.has-arrows {
		padding: 0.25rem 0.3rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-sunken);
	}
	.proj-title {
		flex: 1;
		min-width: 0;
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.proj-nav.has-arrows .proj-title {
		text-align: center;
	}
	.proj-arrow {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.8rem;
		height: 1.8rem;
		border: 1px solid var(--line-strong);
		border-radius: 8px;
		background: var(--surface);
		color: var(--fg);
		font-size: 1.05rem;
		line-height: 1;
		cursor: pointer;
	}
	.proj-arrow:hover {
		border-color: var(--fg-muted);
	}

	.chat {
		--thread-max-height: 14rem;
		/* Who is who. Without these both sides fall back to `transparent` and every
		   bubble is the same colourless wash — the bug that made the dashboard's
		   thread look flat while the order page's did not. */
		--thread-mine-hue: var(--who-contractor);
		--thread-theirs-hue: var(--who-customer);
	}
	/* The phone modal is a tall centred card, so the thread gets to use that height
	   instead of stopping at the popover's 14rem and leaving the card half empty. */
	@media (max-width: 480px) {
		.chat {
			--thread-max-height: 48vh;
		}
	}

	/* After a reply lands: a quiet confirmation and a way back, so a send doesn't
	   silently yank the panel away. */
	.sent-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-sunken);
	}
	.sent-ok {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--fg);
	}
	.sent-done {
		flex: none;
		padding: 0.35rem 0.9rem;
		border: none;
		border-radius: 999px;
		background: var(--brand);
		color: var(--on-brand);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.sent-done:hover {
		background: var(--brand-deep);
	}

	/* The Chat tab for a customer who isn't on the portal yet: a short reason to
	   invite them, then either the send button or the sent-status. */
	.invite {
		display: grid;
		gap: 0.7rem;
		padding: 0.15rem 0.1rem;
	}
	.invite-lede {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.45;
		color: var(--fg-muted);
	}
	/* No way to reach the customer at all. */
	.no-channels {
		margin: 0;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-sunken);
		color: var(--fg-muted);
		font-size: 0.88rem;
		line-height: 1.45;
	}
	/* Resend / Withdraw beneath the sent status. */
	.invite-actions {
		display: flex;
		gap: 0.4rem;
	}
	.invite-mini {
		padding: 0.4rem 0.85rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: var(--surface);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
	}
	.invite-mini:hover:not(:disabled) {
		border-color: var(--fg-muted);
	}
	.invite-mini:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.invite-mini.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
	.invite-mini.danger:hover {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
	}
	/* Pending: one tidy row — a check, then "Invite sent" over its expiry. */
	.invite-sent {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--surface-sunken);
	}
	.invite-sent-mark {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 999px;
		/* Pinned dark: yellow stays light in both themes. */
		background: var(--brand);
		color: var(--on-brand);
		font-size: 0.85rem;
		font-weight: 800;
	}
	.invite-sent-lines {
		display: grid;
		gap: 0.05rem;
		line-height: 1.25;
	}
	.invite-sent-lines strong {
		font-size: 0.9rem;
		color: var(--fg);
	}
	.invite-sent-sub {
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.invite-form {
		display: grid;
		gap: 0.35rem;
		justify-items: start;
	}
	.invite-note {
		font-size: 0.78rem;
		color: var(--fg-muted);
	}
	.invite-send {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.55rem 1rem;
		border: none;
		border-radius: 999px;
		background: var(--brand);
		color: var(--on-brand);
		font-family: inherit;
		font-size: 0.88rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: var(--pop-shadow-sm);
	}
	.invite-send:hover:not(:disabled) {
		background: var(--brand-deep);
	}
	.invite-send:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
