import { error } from '@sveltejs/kit';
import { getAttachment } from '$lib/server/crm.server';
import type { RequestHandler } from './$types';

/** Serve an attachment's bytes, scoped to the owning contractor and order. */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || locals.user.role !== 'contractor') error(403);
	const att = await getAttachment(params.attachmentId, locals.user.id);
	if (!att || att.orderId !== params.id) error(404, 'Attachment not found');

	// Quote-safe filename for the Content-Disposition header.
	const safeName = att.filename.replace(/["\\]/g, '');
	// Wrap the Buffer in a plain Uint8Array so it's a valid Response body type.
	return new Response(new Uint8Array(att.data), {
		headers: {
			'Content-Type': att.mimeType,
			'Content-Length': String(att.size),
			'Content-Disposition': `inline; filename="${safeName}"`,
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
