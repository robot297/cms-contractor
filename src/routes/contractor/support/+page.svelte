<script lang="ts">
	import { enhance } from '$app/forms';
	import { FEEDBACK_TYPES, feedbackTypeLabel, type FeedbackType } from '$lib/crm';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let type = $state<FeedbackType>('bug');
	// Cleared to true after a successful submit so the "thanks" panel shows.
	let sent = $derived(form?.success === true);

	const fieldErr = (name: string) =>
		form && 'field' in form && form.field === name ? form.message : null;
</script>

<svelte:head><title>Support · Contractor CRM</title></svelte:head>

<div class="wrap">
	<header>
		<h1>Support &amp; feedback</h1>
		<p class="sub">
			Found a bug or have an idea? Send it straight to our team — it becomes a tracked issue we can
			follow up on.
		</p>
	</header>

	{#if !data.configured}
		<div class="notice">
			<strong>Feedback isn’t set up yet.</strong>
			<p>
				The support form needs a GitHub repository and token configured (<code>GITHUB_REPO</code> /
				<code>GITHUB_TOKEN</code>). Ask your administrator to add them, then this form will start
				filing issues.
			</p>
		</div>
	{:else if sent && form?.success}
		<div class="notice success">
			<strong
				>Thanks — your {form.type === 'bug' ? 'bug report' : 'feature request'} is in! 🎉</strong
			>
			<p>
				We filed it as
				<a href={form.issueUrl} target="_blank" rel="noopener">issue #{form.issueNumber}</a>. You
				can follow along there.
			</p>
			<button class="btn" type="button" onclick={() => location.reload()}>Send more feedback</button
			>
		</div>
	{:else}
		<form
			method="POST"
			action="?/submit"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="card"
		>
			<fieldset class="type">
				<legend>What kind of feedback is this?</legend>
				<div class="segmented">
					{#each FEEDBACK_TYPES as t (t)}
						<label class:selected={type === t}>
							<input type="radio" name="type" value={t} bind:group={type} />
							<span class="emoji">{t === 'bug' ? '🐞' : '💡'}</span>
							{feedbackTypeLabel(t)}
						</label>
					{/each}
				</div>
			</fieldset>

			<label class="field">
				Summary
				<input
					name="title"
					maxlength="140"
					placeholder={type === 'bug'
						? 'e.g. Order status won’t save on mobile'
						: 'e.g. Let me export orders to CSV'}
					required
				/>
				{#if fieldErr('title')}<span class="err">{fieldErr('title')}</span>{/if}
			</label>

			<label class="field">
				Details
				<textarea
					name="detail"
					rows="6"
					placeholder={type === 'bug'
						? 'What happened, what you expected, and steps to reproduce it.'
						: 'What would you like to do, and what problem would it solve?'}
					required></textarea>
				{#if fieldErr('detail')}<span class="err">{fieldErr('detail')}</span>{/if}
			</label>

			{#if form && 'message' in form && !('field' in form)}
				<p class="err block">{form.message}</p>
			{/if}

			<div class="actions">
				<button class="btn primary" type="submit">
					{type === 'bug' ? 'Report bug' : 'Request feature'}
				</button>
				<span class="hint">Sent to our team as a tracked issue.</span>
			</div>
		</form>
	{/if}
</div>

<style>
	.wrap {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}
	header h1 {
		margin: 0 0 0.3rem;
		font-size: 1.6rem;
	}
	.sub {
		margin: 0 0 1.25rem;
		color: #555;
		font-weight: 600;
	}
	.card {
		border: 3px solid #111;
		border-radius: 16px;
		background: #fff;
		box-shadow: 6px 6px 0 #111;
		padding: 1.25rem;
		display: grid;
		gap: 1rem;
	}
	.type {
		border: none;
		padding: 0;
		margin: 0;
	}
	.type legend {
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #444;
		margin-bottom: 0.5rem;
		padding: 0;
	}
	.segmented {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.segmented label {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.7rem;
		border: 2px solid #111;
		border-radius: 10px;
		font-weight: 700;
		cursor: pointer;
		background: #fff;
		user-select: none;
	}
	.segmented label.selected {
		background: #ffcc00;
		box-shadow: 2px 2px 0 #111;
	}
	.segmented input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.emoji {
		font-size: 1.1rem;
	}
	.field {
		display: grid;
		gap: 0.3rem;
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: #444;
	}
	.field input,
	.field textarea {
		padding: 0.6rem;
		border: 2px solid #111;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 500;
		text-transform: none;
		letter-spacing: normal;
		color: #111;
	}
	.field textarea {
		resize: vertical;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-wrap: wrap;
	}
	.hint {
		font-size: 0.8rem;
		color: #777;
		font-weight: 600;
	}
	.btn {
		padding: 0.6rem 1.1rem;
		border: 2px solid #111;
		border-radius: 8px;
		background: #fff;
		font-weight: 800;
		cursor: pointer;
		font-size: 0.95rem;
	}
	.btn.primary {
		background: #0969da;
		color: #fff;
	}
	.err {
		color: #cf222e;
		font-weight: 600;
		text-transform: none;
		letter-spacing: normal;
		font-size: 0.82rem;
	}
	.err.block {
		margin: 0;
	}
	.notice {
		border: 2px solid #111;
		border-radius: 12px;
		padding: 1rem 1.1rem;
		background: #fffbe6;
	}
	.notice.success {
		background: #eefbf0;
		border-color: #1a7f37;
	}
	.notice p {
		margin: 0.4rem 0 0.8rem;
	}
	.notice code {
		background: #fff;
		border: 1px solid #d0d7de;
		border-radius: 5px;
		padding: 0.05rem 0.35rem;
		font-size: 0.85em;
	}
	.notice a {
		color: #0969da;
		font-weight: 700;
	}
</style>
