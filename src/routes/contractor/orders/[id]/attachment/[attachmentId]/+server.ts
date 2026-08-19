import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Superseded by `/documents/[documentId]`, which authorizes every role through
 * one rule instead of each surface carrying its own copy.
 *
 * Kept as a redirect for one release: these URLs are in browser history and in
 * any tab a contractor left open. 307 rather than 301 so nothing caches a
 * permanent mapping we intend to delete — see tasks 7.3.
 */
export const GET: RequestHandler = ({ params, url }) => {
	redirect(307, `/documents/${params.attachmentId}${url.search}`);
};
