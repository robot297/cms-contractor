import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Support folded into the Account tabs.
 *
 * Kept as a redirect for the same reason `/contractor/support` is: this route
 * was in the portal's nav for the whole of the app's life, so it is bookmarked,
 * it is what the emailed footer links to, and it is where a back button lands.
 * 308 because the move is permanent.
 */
export const load: PageServerLoad = () => {
	redirect(308, '/customer/account?tab=support');
};
