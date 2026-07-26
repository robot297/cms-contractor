<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Social-share (Open Graph / Twitter) card defaults for the whole site. Pages
	// keep their own <title>; these give a nice preview when a link is shared.
	const SITE_NAME = 'Contractor CRM';
	const OG_TITLE = 'Contractor CRM — run every job from lead to last invoice';
	const OG_DESCRIPTION =
		'A CRM built for contractors: customers, orders, subcontractors, and follow-ups tracked from first inquiry to final invoice.';

	const origin = $derived(data.canonicalOrigin);
	const ogImage = $derived(`${origin}/og.png`);
	const ogUrl = $derived(`${origin}${page.url.pathname}`);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />

	<!-- Open Graph (used by iMessage, Slack, Facebook, LinkedIn…) -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:title" content={OG_TITLE} />
	<meta property="og:description" content={OG_DESCRIPTION} />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:image:type" content="image/png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta
		property="og:image:alt"
		content="Contractor CRM — run every job from lead to last invoice"
	/>

	<!-- Twitter / X large-image card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={OG_TITLE} />
	<meta name="twitter:description" content={OG_DESCRIPTION} />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>

{@render children()}
