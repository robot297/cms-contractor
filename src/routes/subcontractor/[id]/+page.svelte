<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatBytes, MAX_ATTACHMENT_BYTES } from '$lib/crm';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const view = $derived(data.view);
</script>

<svelte:head><title>{view.projectName ?? 'Job'} · Subcontractor</title></svelte:head>

<div class="wrap">
	<a class="back" href="/subcontractor">← My jobs</a>

	<header class="head">
		<div>
			<h1>{view.projectName ?? 'Untitled job'}</h1>
			<span class="meta">{view.projectType ?? 'Project'}</span>
		</div>
		<span class="state">{view.customerVisibleState}</span>
	</header>

	{#if form?.message}
		<p class="err">{form.message}</p>
	{/if}

	<!-- Customer block: present only for Trusted; redacted (absent) for Guest -->
	{#if view.tier === 'trusted'}
		<section class="card">
			<h2>Customer</h2>
			{#if view.customer}
				<div class="rows">
					<div><span class="k">Name:</span> {view.customer.name}</div>
					<div><span class="k">Email:</span> {view.customer.email}</div>
					{#if view.customer.phone}<div><span class="k">Phone:</span> {view.customer.phone}</div>{/if}
					{#if view.customer.address}<div><span class="k">Address:</span> {view.customer.address}</div>{/if}
				</div>
			{:else}
				<p class="muted">No customer linked to this job.</p>
			{/if}
		</section>
	{:else}
		<section class="card guest-note">
			<h2>Customer</h2>
			<p class="muted">
				🔒 Customer contact details are hidden for Guest Contractors. You can still see the job’s
				work details and timeline below.
			</p>
		</section>
	{/if}

	<!-- Timeline: both tiers see the work timeline -->
	<section class="card">
		<h2>Timeline</h2>
		{#if view.timeline.length === 0}
			<p class="muted">No updates yet.</p>
		{:else}
			<ul class="timeline">
				{#each view.timeline as t (t.id)}
					<li>
						<div class="t-top">
							<strong>{t.title}</strong>
							<span class="author">{t.authorRole}</span>
						</div>
						{#if t.detail}<p>{t.detail}</p>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Write paths: Trusted only. Guest portal offers no write affordances. -->
	{#if view.canWrite}
		<section class="card">
			<h2>Post an update</h2>
			<form
				method="POST"
				action="?/addNote"
				use:enhance={() => async ({ update }) => update()}
			>
				<textarea name="note" rows="2" placeholder="Add a note for the contractor…" required></textarea>
				<button class="btn primary" type="submit">Add note</button>
			</form>

			<h2 style="margin-top:1rem;">Upload a job photo</h2>
			<form
				method="POST"
				action="?/uploadPhoto"
				enctype="multipart/form-data"
				use:enhance={() => async ({ update }) => update()}
			>
				<input type="file" name="file" accept="image/*,application/pdf" required />
				<button class="btn" type="submit">Upload</button>
				<span class="muted small">Max {formatBytes(MAX_ATTACHMENT_BYTES)}</span>
			</form>
		</section>
	{:else}
		<p class="muted read-only">Read-only access — Guest Contractors can’t post updates.</p>
	{/if}
</div>

<style>
	.wrap {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.25rem 1rem 3rem;
		display: grid;
		gap: 1rem;
	}
	.back {
		color: #0969da;
		text-decoration: none;
		font-weight: 600;
		font-size: 0.9rem;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
	}
	.meta {
		color: #555;
		font-weight: 600;
	}
	.state {
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		background: #ffcc00;
		border: 2px solid #111;
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
		white-space: nowrap;
	}
	.card {
		border: 3px solid #111;
		border-radius: 14px;
		background: #fff;
		box-shadow: 5px 5px 0 #111;
		padding: 0.9rem;
	}
	.card h2 {
		margin: 0 0 0.6rem;
		font-size: 1rem;
	}
	.guest-note {
		background: #f8fafc;
	}
	.rows {
		display: grid;
		gap: 0.3rem;
		font-size: 0.95rem;
	}
	.k {
		color: #57606a;
	}
	.muted {
		color: #777;
		margin: 0;
	}
	.muted.small {
		font-size: 0.8rem;
	}
	.read-only {
		text-align: center;
		font-weight: 600;
	}
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	.timeline li {
		border-left: 3px solid #111;
		padding: 0.1rem 0 0.1rem 0.7rem;
	}
	.t-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.author {
		font-size: 0.7rem;
		text-transform: uppercase;
		color: #888;
		font-weight: 800;
	}
	.timeline p {
		margin: 0.2rem 0 0;
	}
	textarea,
	input[type='file'] {
		width: 100%;
		padding: 0.5rem;
		border: 2px solid #111;
		border-radius: 8px;
		margin-bottom: 0.5rem;
		font-size: 0.95rem;
	}
	.btn {
		padding: 0.5rem 0.9rem;
		border: 2px solid #111;
		border-radius: 8px;
		background: #fff;
		font-weight: 800;
		cursor: pointer;
	}
	.btn.primary {
		background: #0969da;
		color: #fff;
	}
	.err {
		color: #cf222e;
		font-weight: 600;
		margin: 0;
	}
</style>
