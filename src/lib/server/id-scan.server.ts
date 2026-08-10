import Anthropic from '@anthropic-ai/sdk';
import { ENV } from 'varlock/env';
import {
	VISION_ID_JSON_SCHEMA,
	visionIdSchema,
	visionPayloadToScan,
	type ScannedId
} from '$lib/id-scan';

/**
 * The vision fallback for ID Scan — reading a card that has no barcode.
 *
 * The whole model integration is one function. Nothing outside this file names
 * Anthropic or imports a provider type, the same containment rule email.server
 * applies to Resend, so swapping providers is an edit here and nowhere else.
 *
 * Scanning degrades rather than fails. With no key configured the barcode path
 * still works in full — it is on-device and needs nothing — and the scanner
 * simply doesn't offer to read a card it can't decode. That is what makes this
 * safe to ship before anyone has an AI account, and what keeps development, the
 * demo and self-hosters working.
 *
 * The image is never written to disk, never inserted into a row, and never
 * logged. It exists for the length of the call and then it is gone
 * (openspec/changes/subcontractor-id-scan/design.md, Decision 4).
 */

export type IdScanResult =
	| { ok: true; scan: ScannedId }
	/** No key: the barcode path is the only one available on this deployment. */
	| { ok: false; reason: 'unconfigured' }
	/** The image reached the model and it wasn't a readable ID. */
	| { ok: false; reason: 'unreadable' }
	/** The image was rejected before the model — too large, or not an image. */
	| { ok: false; reason: 'invalid'; detail?: string }
	/** The provider or the network failed. */
	| { ok: false; reason: 'provider'; detail?: string };

/**
 * The largest photo worth sending. A phone camera frame downscaled for legible
 * text lands far under this; anything above it is a client bug or an attempt to
 * bill the deployment for someone else's upload.
 */
export const MAX_SCAN_BYTES = 4 * 1024 * 1024;

let client: Anthropic | null = null;

/**
 * The configured-or-degrade rule, as a pure predicate — split out from
 * `isIdScanVisionConfigured` so it can be tested without standing up varlock's
 * env.
 */
export function idScanVisionConfigured(key: string | undefined): boolean {
	return Boolean(key?.trim());
}

/** Whether a card with no barcode can be read on this deployment. */
export function isIdScanVisionConfigured(): boolean {
	return idScanVisionConfigured(ENV.ANTHROPIC_API_KEY);
}

/**
 * Whether the scanner may fabricate a scan. Off unless explicitly "true" — the
 * same shape as `isEmailDevToolsEnabled` and `isBillingDevToolsEnabled`, and for
 * the same reason: it lets any signed-in contractor claim a card said something
 * it didn't.
 */
export function isIdScanDevToolsEnabled(): boolean {
	return ENV.ID_SCAN_DEV_TOOLS === 'true';
}

/** The client, or null when the fallback isn't configured. */
function anthropicClient(): Anthropic | null {
	const key = ENV.ANTHROPIC_API_KEY;
	if (!key) return null;
	client ??= new Anthropic({ apiKey: key });
	return client;
}

const SYSTEM_PROMPT = `You read a single photographed identity or licence document and report the fields printed on it.

Report only what is legible on the card. Never infer, complete, or correct a value from what a name or number "should" be — a half-read licence number is worse than a null, because the contractor will save it. Use null for any field the document does not show or you cannot read with confidence.

Set documentType to "unknown" when the image is not an identity document or a trade/contractor licence, or when it is too dark, blurred, or cropped to read. You are not judging whether the document is genuine or current.`;

/** The media types a browser canvas actually produces. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/**
 * Split a `data:` URL into the parts the API wants, or return null when it
 * isn't one. Validated here rather than trusted because this value arrives from
 * the browser.
 */
export function parseImageDataUrl(
	dataUrl: string
): { mediaType: ImageType; base64: string; bytes: number } | null {
	const match = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
	if (!match) return null;
	const [, mediaType, base64] = match;
	if (!(IMAGE_TYPES as readonly string[]).includes(mediaType)) return null;
	// Base64 encodes 3 bytes per 4 characters; padding shaves off the remainder.
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return {
		mediaType: mediaType as ImageType,
		base64,
		bytes: Math.floor((base64.length * 3) / 4) - padding
	};
}

/**
 * Read a photographed card into a `ScannedId`.
 *
 * Returns a result rather than throwing, so the scanner can say what happened —
 * "not configured", "couldn't read that", "the service is down" are three
 * different things to the contractor holding the card, and only one of them is
 * worth retrying.
 */
export async function extractIdFromImage(dataUrl: string): Promise<IdScanResult> {
	const image = parseImageDataUrl(dataUrl);
	if (!image) return { ok: false, reason: 'invalid', detail: 'Not a supported image.' };
	if (image.bytes > MAX_SCAN_BYTES) {
		return { ok: false, reason: 'invalid', detail: 'That photo is too large.' };
	}

	const anthropic = anthropicClient();
	if (!anthropic) return { ok: false, reason: 'unconfigured' };

	let raw: unknown;
	try {
		const response = await anthropic.messages.create({
			model: 'claude-opus-5',
			max_tokens: 4096,
			system: SYSTEM_PROMPT,
			output_config: { format: { type: 'json_schema', schema: VISION_ID_JSON_SCHEMA } },
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'image',
							source: { type: 'base64', media_type: image.mediaType, data: image.base64 }
						},
						{ type: 'text', text: 'Report the fields printed on this document.' }
					]
				}
			]
		});

		// A safety decline is an outcome, not an exception — and `content` is empty
		// on one, so it has to be checked before the block is read.
		if (response.stop_reason === 'refusal') return { ok: false, reason: 'unreadable' };

		const text = response.content.find((block) => block.type === 'text');
		if (!text) return { ok: false, reason: 'unreadable' };
		raw = JSON.parse(text.text);
	} catch (err) {
		// Deliberately no image, and no model output, in the message that gets
		// logged upstream — only what went wrong.
		return { ok: false, reason: 'provider', detail: errorDetail(err) };
	}

	// Validated before it reaches the contractor: a malformed or imaginative
	// response fails as "couldn't read that" rather than arriving in the form.
	const parsed = visionIdSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, reason: 'unreadable' };

	const scan = visionPayloadToScan(parsed.data);
	return scan ? { ok: true, scan } : { ok: false, reason: 'unreadable' };
}

function errorDetail(err: unknown): string {
	if (err instanceof Anthropic.APIError) return `Provider error ${err.status ?? ''}`.trim();
	return err instanceof Error ? err.message : 'Unknown error';
}
