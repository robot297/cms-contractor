<script lang="ts">
	import '../app.css';
	// Body text, one weight range, every theme.
	import '@fontsource/inter/400.css';
	import '@fontsource/inter/500.css';
	import '@fontsource/inter/600.css';
	import '@fontsource/inter/700.css';
	// The display faces, one per theme — headings only, and only the weights the
	// themes actually set (see --display-weight in app.css). Self-hosted rather
	// than pulled from a font CDN so the app keeps working offline and asks
	// nothing of a third party on first paint.
	import '@fontsource/chakra-petch/700.css'; // Voltage
	import '@fontsource/michroma/400.css'; // Outrun
	import '@fontsource/jetbrains-mono/700.css'; // Circuit
	import '@fontsource/orbitron/800.css'; // Overdrive
	import '@fontsource/rajdhani/700.css'; // Abyss
	import '@fontsource/syncopate/700.css'; // Vapor
	import '@fontsource/space-grotesk/700.css'; // Halogen, Blueprint
	import '@fontsource/oswald/700.css'; // High Vis
	import '@fontsource/bitter/700.css'; // Timber
	import '@fontsource/source-serif-4/700.css'; // Ledger
	import '@fontsource/playfair-display/700.css'; // Nocturne
	// Ember's own face, and the fallback every other palette's stack names — which
	// is why it belongs here rather than on the landing page, where it used to be
	// imported alone. A fallback that only loads on one route is not a fallback.
	import '@fontsource/archivo-black/400.css'; // Ember, and every stack's fallback
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { palette, theme } from '$lib/theme.svelte';
	import favicon from '$lib/assets/favicon.svg';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// The contractor app and the customer portal store their theme separately, and
	// a SvelteKit navigation never reloads the document — so the pre-paint stamp in
	// app.html only ever describes the page the tab was OPENED on. Without this,
	// walking from /contractor into the portal (or back out through the view
	// switcher) carried the other side's theme across with it.
	//
	// Here rather than in the two half-layouts: this one wraps both, so the rule
	// cannot drift between them, and it also covers the signed-out pages. Runs
	// after the first navigation too, which is harmless — it re-reads the same
	// value the pre-paint script just wrote.
	afterNavigate(() => {
		theme.adopt();
		palette.adopt();
	});

	// "System" has to keep meaning system. Without a live listener it would mean
	// "whatever the OS said when this tab loaded" — the one thing it must not
	// mean, since the reason to pick it is a machine that flips itself at sunset.
	// Mounted once here, for the same reason `afterNavigate` is: this layout wraps
	// both halves of the product and every signed-out page.
	onMount(() => theme.watchSystem());

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
