<script lang="ts">
	// Only reachable when the customer has no orders at all — the load redirects
	// to a project otherwise. The layout renders no order rail in this state.
</script>

<svelte:head><title>Your projects</title></svelte:head>

<section class="empty">
	<span class="mark" aria-hidden="true">◆</span>
	<h1>No project yet</h1>
	<p>
		Your contractor hasn’t started a project for you yet. When they do, it’ll show up here with its
		status, updates, and a place to message them.
	</p>
</section>

<style>
	.empty {
		display: grid;
		justify-items: center;
		gap: 0.6rem;
		text-align: center;
		padding: 2.5rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 16px;
		box-shadow: var(--card-shadow);
	}
	.mark {
		font-size: 1.6rem;
		color: var(--accent);
	}
	h1 {
		margin: 0;
		font-size: 1.25rem;
		color: var(--fg);
	}
	p {
		margin: 0;
		max-width: 44ch;
		color: var(--fg-muted);
		font-size: 0.95rem;
		line-height: 1.55;
	}
</style>
