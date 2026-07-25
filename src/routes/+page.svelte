<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let demoLoading = $state(false);

	const year = new Date().getFullYear();

	const features = [
		{
			icon: '🔒',
			title: 'Secure',
			body: 'Role-based access keeps customer details safe — trusted subcontractors see the job, guests never see personal info. Your data stays yours.'
		},
		{
			icon: '✨',
			title: 'Simple',
			body: 'No enterprise bloat. Search, tap, done — an interface that gets out of the way so you can get back to the work.'
		},
		{
			icon: '⚡',
			title: 'Streamlined',
			body: 'Customers, orders, subcontractors, and follow-ups in one flow — from the first inquiry to the final invoice.'
		}
	];
</script>

<svelte:head>
	<title>Contractor CRM — run every job from lead to last invoice</title>
	<meta
		name="description"
		content="A CRM built for contractors: customers, orders, subcontractors, and follow-ups tracked from first inquiry to final invoice."
	/>
</svelte:head>

<div class="landing">
	<!-- Hero -->
	<section class="hero">
		<div class="hero-inner">
			<h1 class="headline">
				Run every job from<br /><span class="accent">lead to last invoice.</span>
			</h1>
			<p class="subhead">
				Customers, orders, subcontractors, and follow-ups — tracked in one calm workspace built for
				the job site, not the boardroom.
			</p>

			<div class="cta-row">
				{#if data.demoEnabled}
					<form
						method="POST"
						action="/login?/demo"
						use:enhance={() => {
							demoLoading = true;
							return async ({ update }) => {
								await update();
								demoLoading = false;
							};
						}}
					>
						<button type="submit" class="btn primary" disabled={demoLoading}>
							{demoLoading ? 'Setting up…' : 'Demo'}
						</button>
					</form>
				{/if}
				<a class="btn ghost" href={resolve('/login')}>Sign in</a>
			</div>
		</div>
	</section>

	<!-- Features -->
	<section class="features">
		<div class="features-inner">
			<h2 class="section-title">Everything a working contractor actually needs</h2>
			<p class="section-sub">Focused tools, none of the enterprise bloat.</p>
			<div class="grid">
				{#each features as f (f.title)}
					<article class="card">
						<div class="card-icon">{f.icon}</div>
						<h3 class="card-title">{f.title}</h3>
						<p class="card-body">{f.body}</p>
					</article>
				{/each}
			</div>
		</div>
	</section>

	<!-- Closing CTA -->
	<section class="closing">
		<div class="closing-inner">
			<h2 class="closing-title">Ready to build?</h2>
			<p class="closing-sub">Take the full app for a spin with sample customers and orders.</p>
			{#if data.demoEnabled}
				<form
					method="POST"
					action="/login?/demo"
					use:enhance={() => {
						demoLoading = true;
						return async ({ update }) => {
							await update();
							demoLoading = false;
						};
					}}
				>
					<button type="submit" class="btn primary lg" disabled={demoLoading}>
						{demoLoading ? 'Setting up your demo…' : '▶  Explore the live demo'}
					</button>
				</form>
			{:else}
				<a class="btn primary lg" href={resolve('/login')}>Get started →</a>
			{/if}
		</div>
	</section>

	<footer class="foot">
		<span>© {year} Contractor CRM</span>
		<span class="dot">·</span>
		<span>Built for those who do</span>
	</footer>
</div>

<style>
	/* Keep padding inside every element's width so nothing overflows the
	   viewport on mobile (the app doesn't set a global border-box). */
	.landing,
	.landing *,
	.landing *::before,
	.landing *::after {
		box-sizing: border-box;
	}
	.landing {
		font-family: 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif;
		color: #1f2328;
		background: #fff;
		min-height: 100dvh;
		overflow-x: hidden;
	}

	/* ---------- Hero ---------- */
	.hero {
		position: relative;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 6rem clamp(1rem, 5vw, 3rem) 4rem;
		background:
			radial-gradient(1200px 600px at 70% -10%, rgba(255, 204, 0, 0.16), transparent 60%),
			radial-gradient(900px 500px at 0% 110%, rgba(139, 92, 246, 0.16), transparent 55%),
			linear-gradient(180deg, #16181d 0%, #101216 100%);
		overflow: hidden;
	}
	/* Thin job-site accent line at the very top. */
	.hero::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 4px;
		background: repeating-linear-gradient(
			-45deg,
			#ffcc00 0,
			#ffcc00 14px,
			#111 14px,
			#111 28px
		);
	}
	.hero-inner {
		position: relative;
		max-width: 780px;
		text-align: center;
		color: #fff;
	}
	.headline {
		margin: 0;
		font-size: clamp(2.2rem, 6vw, 3.6rem);
		line-height: 1.05;
		font-weight: 800;
		letter-spacing: -0.03em;
		text-transform: none;
		color: #fff;
		/* Opt out of the global chunky-yellow h1 treatment. */
		display: block;
		background: none;
		border: none;
		border-radius: 0;
		box-shadow: none;
		padding: 0;
	}
	.headline .accent {
		color: #ffcc00;
	}
	.subhead {
		margin: 1.2rem auto 0;
		max-width: 34rem;
		font-size: clamp(1rem, 2.3vw, 1.18rem);
		line-height: 1.55;
		color: rgba(255, 255, 255, 0.72);
		font-weight: 400;
	}
	.cta-row {
		margin-top: 2rem;
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		align-items: center;
		flex-wrap: wrap;
	}
	/* Let the demo form's button participate directly in the flex row so both
	   CTAs are treated as equal, centered siblings. */
	.cta-row form {
		display: contents;
	}
	.cta-row .btn {
		min-width: 8.5rem;
	}
	/* ---------- Buttons ---------- */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.85rem 1.5rem;
		border-radius: 12px;
		font-weight: 700;
		font-size: 0.98rem;
		cursor: pointer;
		text-decoration: none;
		border: 1px solid transparent;
		transition:
			transform 0.08s ease,
			background 0.15s ease,
			box-shadow 0.15s ease;
	}
	.btn.primary {
		background: #ffcc00;
		color: #1a1a1a;
		box-shadow: 0 8px 24px rgba(255, 204, 0, 0.28);
	}
	.btn.primary:hover:not(:disabled) {
		background: #ffd633;
		transform: translateY(-1px);
	}
	.btn.primary:disabled {
		opacity: 0.75;
		cursor: default;
	}
	.btn.ghost {
		background: rgba(255, 255, 255, 0.06);
		color: #fff;
		border-color: rgba(255, 255, 255, 0.22);
	}
	.btn.ghost:hover {
		background: rgba(255, 255, 255, 0.14);
	}
	.btn.lg {
		padding: 0.95rem 1.9rem;
		font-size: 1.05rem;
	}

	/* ---------- Features ---------- */
	.features {
		padding: clamp(3.5rem, 8vw, 6rem) clamp(1rem, 5vw, 3rem);
		background: #fafafa;
		border-bottom: 1px solid #eee;
	}
	.features-inner {
		max-width: 1080px;
		margin: 0 auto;
	}
	.section-title {
		margin: 0;
		text-align: center;
		font-size: clamp(1.5rem, 3.5vw, 2.1rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		text-transform: none;
		color: #1f2328;
	}
	.section-sub {
		margin: 0.6rem 0 2.5rem;
		text-align: center;
		color: #6b7280;
		font-size: 1.05rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
		gap: 1.1rem;
	}
	.card {
		background: #fff;
		border: 1px solid #ececf0;
		border-radius: 16px;
		padding: 1.5rem;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease,
			border-color 0.15s ease;
	}
	.card:hover {
		transform: translateY(-3px);
		box-shadow: 0 14px 30px rgba(17, 17, 17, 0.08);
		border-color: #e0d6fb;
	}
	.card-icon {
		width: 3rem;
		height: 3rem;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		border-radius: 12px;
		background: #f3eeff;
		margin-bottom: 1rem;
	}
	.card-title {
		margin: 0 0 0.4rem;
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		text-transform: none;
		color: #1f2328;
	}
	.card-body {
		margin: 0;
		color: #5b6370;
		font-size: 0.95rem;
		line-height: 1.55;
	}

	/* ---------- Closing CTA ---------- */
	.closing {
		padding: clamp(3.5rem, 8vw, 6rem) clamp(1rem, 5vw, 3rem);
		text-align: center;
		background: #fff;
	}
	.closing-title {
		margin: 0;
		font-size: clamp(1.6rem, 4vw, 2.3rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		text-transform: none;
		color: #1f2328;
	}
	.closing-sub {
		margin: 0.6rem 0 1.6rem;
		color: #6b7280;
		font-size: 1.05rem;
	}
	.closing form {
		display: inline-block;
	}

	/* ---------- Footer ---------- */
	.foot {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 2rem 1rem;
		background: #101216;
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.85rem;
		font-weight: 500;
	}
	.foot .dot {
		opacity: 0.5;
	}

	@media (max-width: 480px) {
		.cta-row {
			flex-direction: column;
			align-items: stretch;
		}
		.cta-row .btn {
			width: 100%;
		}
	}
</style>
