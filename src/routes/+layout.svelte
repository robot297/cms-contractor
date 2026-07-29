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
	const OG_TITLE = 'Contractor CRM — manage client relationships with ease';
	const OG_DESCRIPTION =
		'Simple, powerful contractor enablement. Focus more on your projects and less on the tedium.';
	const OG_IMAGE_ALT = 'Contractor CRM — manage client relationships with ease';

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
	<!-- Apple's link presentation drops the card if the image isn't advertised over
	     https, so the secure URL is declared explicitly rather than inferred. -->
	<meta property="og:image:secure_url" content={ogImage} />
	<meta property="og:image:type" content="image/png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={OG_IMAGE_ALT} />

	<!-- Twitter / X large-image card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={OG_TITLE} />
	<meta name="twitter:description" content={OG_DESCRIPTION} />
	<meta name="twitter:image" content={ogImage} />
	<meta name="twitter:image:alt" content={OG_IMAGE_ALT} />
</svelte:head>

{@render children()}
