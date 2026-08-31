import { error, redirect } from '@sveltejs/kit';
import { getDocumentBytes, viewerFromLocals } from '$lib/server/documents.server';
import type { RequestHandler } from './$types';

/**
 * The one endpoint that serves a Document's bytes, for every role.
 *
 * It replaces a contractor endpoint and a customer endpoint that each carried
 * their own copy of "may this person see this file?" — and had drifted apart, as
 * duplicated authorization does. Here the viewer is resolved from `locals` and
 * the decision is `documentAccess`'s alone; this handler contains no rule of its
 * own beyond "signed out means the login page".
 *
 * The document id is enough on its own: it identifies the Order, so putting the
 * Order in the path would only add a second thing to keep consistent.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) redirect(302, '/login');
	const viewer = viewerFromLocals(locals);
	if (!viewer) error(403);

	const found = await getDocumentBytes(viewer, params.documentId);
	// Deliberately 404 rather than 403: a document this viewer may not reach
	// should not be confirmed to exist.
	if (!found) error(404, 'Document not found');
	const { meta, data } = found;

	// Quote-safe filename for the Content-Disposition header.
	const safeName = meta.filename.replace(/["\\]/g, '');
	// `?dl` forces a save rather than a render. The default stays `inline` because
	// the viewer embeds this URL in an <img> or <object>, which a download
	// disposition breaks.
	const disposition = url.searchParams.has('dl') ? 'attachment' : 'inline';
	// Wrap the Buffer in a plain Uint8Array so it's a valid Response body type.
	return new Response(new Uint8Array(data), {
		headers: {
			'Content-Type': meta.mimeType,
			'Content-Length': String(meta.size),
			'Content-Disposition': `${disposition}; filename="${safeName}"`,
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
