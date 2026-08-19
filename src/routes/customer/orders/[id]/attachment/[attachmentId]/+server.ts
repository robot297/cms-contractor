import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Superseded by `/documents/[documentId]`. See the contractor sibling of this
 * file — the two endpoints having drifted apart is why there is now one.
 *
 * The scope this route used to apply (a customer reaches only their own uploads)
 * has not been dropped; it moved into `documentAccess`, which applies it to the
 * list and to a direct fetch alike.
 */
export const GET: RequestHandler = ({ params, url }) => {
	redirect(307, `/documents/${params.attachmentId}${url.search}`);
};
