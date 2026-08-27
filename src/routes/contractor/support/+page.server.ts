import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Support folded into the Settings tabs.
 *
 * Kept as a redirect for the same reason `/contractor/crew`,
 * `/contractor/customers` and `/contractor/settings/templates` are: this route
 * was in the top-level nav for the whole of the app's life, so it is bookmarked
 * and it is where a back button lands. 308 because the move is permanent.
 */
export const load: PageServerLoad = () => {
	redirect(308, '/contractor/settings?tab=support');
};
