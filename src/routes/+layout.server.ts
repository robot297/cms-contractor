import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

/**
 * Expose a canonical absolute origin so the root layout can build absolute
 * og:image / og:url URLs (social scrapers like iMessage require absolute URLs).
 * Prefers the configured ORIGIN (correct behind a reverse proxy) and falls back
 * to the request origin — mirroring how auth resolves its base URL.
 */
export const load: LayoutServerLoad = ({ url }) => {
	const origin = env.ORIGIN ?? url.origin;

	// Behind a TLS-terminating proxy without ORIGIN set, url.origin comes back as
	// http://… — and Apple's link presentation (iMessage, Messages on macOS) will
	// silently drop a card whose image is insecure. Localhost stays as-is so local
	// dev doesn't advertise an https URL it can't serve.
	const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin);

	return {
		canonicalOrigin: isLocal ? origin : origin.replace(/^http:\/\//, 'https://')
	};
};
