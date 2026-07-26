import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

/**
 * Expose a canonical absolute origin so the root layout can build absolute
 * og:image / og:url URLs (social scrapers like iMessage require absolute URLs).
 * Prefers the configured ORIGIN (correct behind a reverse proxy) and falls back
 * to the request origin — mirroring how auth resolves its base URL.
 */
export const load: LayoutServerLoad = ({ url }) => {
	return { canonicalOrigin: env.ORIGIN ?? url.origin };
};
