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
	type Conversation = {
		orderId: string;
		projectName: string | null;
		thread: Message[];
		/**
		 * Whether the job is still live. Optional, and absent counts as live: the
		 * three call sites that pass a SINGLE conversation are already on the job
		 * in question, and forcing them to answer a question the picker asks would
		 * be ceremony for a control they never render.
		 */
		active?: boolean;
	};

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
		/**
		 * Whether the panel draws the contact's name itself. Off inside
		 * `ContactDialog`, which puts the name in the modal's own header — two of
		 * them, one under the other, is what the orders list used to show.
		 */
		heading = true,
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
		heading?: boolean;
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

	const isLive = (c: Conversation) => c.active !== false;
	/** Open jobs and finished ones, each newest-first as the server sent them. */
	const liveConversations = $derived(conversations.filter(isLive));
	const pastConversations = $derived(conversations.filter((c) => !isLive(c)));

	/**
	 * Which job is being talked about.
	 *
	 * Defaults to the newest LIVE one rather than the newest full stop. A customer
	 * with four finished jobs and one in flight is being messaged about the one in
	 * flight — opening on a job that closed last spring means every reply starts
	 * with re-picking, and a reply sent without noticing goes onto a dead thread
	 * the customer has no reason to look at. Falls back to the newest of anything
	 * when nothing is live.
	 */
	let pickedOrderId = $state<string | null>(null);
	const conversation = $derived(
		conversations.find((c) => c.orderId === pickedOrderId) ??
			liveConversations[0] ??
			conversations[0] ??
			null
	);
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
	{#if heading}
		<div class="head">
			<span class="who">{contact.name}</span>
			{#if onclose}
				<button type="button" class="close" aria-label="Close" onclick={() => onclose?.()}>✕</button
				>
			{/if}
		</div>
	{/if}

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
			<!-- Which job the chat is about — a customer's threads are per order, so
			     the answer has to land on the right one.
			     
			     A select, and one control for every case. It used to be two: a tab
			     each for two or three jobs, and single-step ‹ › arrows beyond that.
			     Both broke on a phone. The tabs put three full project names in a row
			     inside a 338px panel, and the arrows made "the job from March" four
			     taps away with no way to see what you were stepping past.
			     
			     Grouped, because the grouping is the useful part: the open jobs are
			     what you are almost certainly writing about, and the finished ones
			     stay reachable underneath rather than being mixed in by date. -->
			{#if conversations.length > 1}
				<label class="proj-pick">
					<span class="sr-only">Which job to talk about</span>
					<select bind:value={() => conversation.orderId, (v) => (pickedOrderId = v)}>
						{#if pastConversations.length === 0}
							{#each liveConversations as c (c.orderId)}
								<option value={c.orderId}>{c.projectName ?? 'Untitled project'}</option>
							{/each}
						{:else}
							{#if liveConversations.length > 0}
								<optgroup label="Open">
									{#each liveConversations as c (c.orderId)}
										<option value={c.orderId}>{c.projectName ?? 'Untitled project'}</option>
									{/each}
								</optgroup>
							{/if}
							<optgroup label="Finished">
								{#each pastConversations as c (c.orderId)}
									<option value={c.orderId}>{c.projectName ?? 'Untitled project'}</option>
								{/each}
							</optgroup>
						{/if}
					</select>
				</label>
			{:else}
				<p class="proj-one">{conversation.projectName ?? 'Untitled project'}</p>
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
		/* A column rather than a grid: given a host with a height — which is every
		   host now, since the panel only ever opens inside `ContactDialog` — the
		   conversation takes what the tabs, the job picker and the composer leave,
		   instead of the thread being a fixed box with the reply field under it.
		   Where the host has no height of its own this collapses to the same stack
		   it always was. */
		display: flex;
		flex-direction: column;
		min-height: 0;
		/* The 0 floor, not just `min-width: 0`.
		
		   A grid's implicit column is `auto`, which sizes to MAX-CONTENT — so the
		   panel took its width from the widest thing in it (the four-channel tab
		   strip, ~476px) and then everything inside inherited that as the width to
		   truncate against. `min-width: 0` on the panel does not help: the panel was
		   never being squeezed, it was growing. The result was a 476px panel in a
		   364px popover, so the whole contact pane scrolled sideways on a phone and
		   `.proj-title`'s ellipsis never fired — it had 391px to play with.
		   
		   Same idiom, same reason as the order page's cards: see the note on `.main`
		   in the customer layout. The 0 floor has to hold at every level or the one
		   at the bottom never gets to truncate. */
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
	/* The job picker. A native select on purpose: it is the one control that gets
	   a phone-sized list of jobs right without any layout of its own — the OS
	   sheet handles the overflow, the grouping and the long names, none of which a
	   custom row of buttons managed inside a 338px panel. */
	.proj-pick {
		display: block;
		min-width: 0;
	}
	.proj-pick select {
		display: block;
		width: 100%;
		max-width: 100%;
		box-sizing: border-box;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--line-strong);
		border-radius: 10px;
		background: var(--surface-sunken);
		color: var(--fg);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 700;
		/* A select will not ellipsis its own text, so a long project name would set
		   the control's min-content width and push the panel wide again — the exact
		   failure this whole change is fixing. `width: 100%` plus this keeps it
		   inside whatever column it is given. */
		text-overflow: ellipsis;
	}
	.proj-pick select:focus-visible {
		outline: 2px solid var(--brand);
		outline-offset: 1px;
	}
	/* One job needs no picker, but the thread still has to say which job it is —
	   a reply must never be sent into an unlabelled conversation. */
	.proj-one {
		margin: 0;
		min-width: 0;
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Present for the screen reader, invisible to the eye — the select's own value
	   is what a sighted user reads. Not `display: none`, which would take it out
	   of the a11y tree along with the label it provides. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		border: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.chat {
		/* The conversation is the tall thing in the panel, so it is the thing that
		   flexes; `none` hands the sizing to the thread's own `flex: 1 1 auto`. The
		   14rem it used to stop at is the fallback for a host with no height to
		   give — the thread's own default is close enough that neither needs one. */
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		--thread-max-height: none;
		/* Who is who. Without these both sides fall back to `transparent` and every
		   bubble is the same colourless wash — the bug that made the dashboard's
		   thread look flat while the order page's did not. */
		--thread-mine-hue: var(--who-contractor);
		--thread-theirs-hue: var(--who-customer);
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
