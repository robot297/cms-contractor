import { describe, expect, it } from 'vitest';
import {
	MAX_SCAN_BYTES,
	extractIdFromImage,
	idScanVisionConfigured,
	isIdScanDevToolsEnabled,
	isIdScanVisionConfigured,
	parseImageDataUrl
} from './id-scan.server';

/**
 * The model is never called here. What's worth testing on this side is what
 * happens before the SDK is reached: whether the fallback is on at all, and
 * whether a value that arrived from a browser is an image we're willing to send
 * to a paid API.
 *
 * What the model actually returns is covered in id-scan.test.ts, against the
 * schema and the payload→ScannedId mapping — the parts that are ours.
 */

/** A one-pixel PNG, as a browser canvas would hand it over. */
const PNG_PIXEL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('idScanVisionConfigured', () => {
	it('is on when a key is set', () => {
		expect(idScanVisionConfigured('sk-ant-test')).toBe(true);
	});

	it('is off with no key', () => {
		// The barcode path needs nothing, so "off" means the scanner offers only
		// that — not that scanning is broken.
		expect(idScanVisionConfigured(undefined)).toBe(false);
		expect(idScanVisionConfigured('')).toBe(false);
	});

	it('does not count whitespace as configuration', () => {
		expect(idScanVisionConfigured('   ')).toBe(false);
	});
});

describe('isIdScanVisionConfigured', () => {
	it('answers for this deployment without asserting which answer', () => {
		// Not asserting true or false: it depends on whether whoever runs the suite
		// has a key set, and a test that fails on a teammate's machine because they
		// configured something is a bad test. The rule is covered above.
		expect(typeof isIdScanVisionConfigured()).toBe('boolean');
	});
});

describe('isIdScanDevToolsEnabled', () => {
	it('is off unless the value is exactly "true"', () => {
		// It lets a signed-in contractor fabricate a scan result, so anything
		// short of an explicit opt-in has to read as off.
		expect(isIdScanDevToolsEnabled()).toBe(process.env.ID_SCAN_DEV_TOOLS === 'true');
	});
});

describe('parseImageDataUrl', () => {
	it('accepts a PNG data URL and reports its size', () => {
		const image = parseImageDataUrl(PNG_PIXEL);
		expect(image).not.toBeNull();
		expect(image!.mediaType).toBe('image/png');
		expect(image!.bytes).toBeGreaterThan(0);
		expect(image!.bytes).toBeLessThan(200);
	});

	it('accepts the other formats a canvas produces', () => {
		expect(parseImageDataUrl('data:image/jpeg;base64,AAAA')?.mediaType).toBe('image/jpeg');
		expect(parseImageDataUrl('data:image/webp;base64,AAAA')?.mediaType).toBe('image/webp');
	});

	it('refuses a media type the model does not take', () => {
		expect(parseImageDataUrl('data:image/svg+xml;base64,AAAA')).toBeNull();
		expect(parseImageDataUrl('data:application/pdf;base64,AAAA')).toBeNull();
	});

	it('refuses anything that is not a base64 data URL', () => {
		expect(parseImageDataUrl('https://example.com/card.png')).toBeNull();
		expect(parseImageDataUrl('data:image/png,not-base64')).toBeNull();
		expect(parseImageDataUrl('')).toBeNull();
	});

	it('measures padded base64 correctly', () => {
		// 4 chars with two '=' is one byte — the size guard has to agree with the
		// bytes actually sent, not with the string length.
		expect(parseImageDataUrl('data:image/png;base64,QQ==')!.bytes).toBe(1);
		expect(parseImageDataUrl('data:image/png;base64,QUE=')!.bytes).toBe(2);
		expect(parseImageDataUrl('data:image/png;base64,QUJD')!.bytes).toBe(3);
	});
});

describe('extractIdFromImage — refusals that never reach the provider', () => {
	it('rejects something that is not an image', async () => {
		const result = await extractIdFromImage('https://example.com/card.png');
		expect(result).toEqual({ ok: false, reason: 'invalid', detail: 'Not a supported image.' });
	});

	it('rejects an oversized photo before it costs anything', async () => {
		const oversized = `data:image/jpeg;base64,${'A'.repeat(MAX_SCAN_BYTES * 2)}`;
		const result = await extractIdFromImage(oversized);
		expect(result).toEqual({ ok: false, reason: 'invalid', detail: 'That photo is too large.' });
	});

	it('reports unconfigured rather than failing when there is no key', async () => {
		// Only meaningful on a machine without a key — where there is one, the size
		// and format guards above are what this file covers.
		if (isIdScanVisionConfigured()) {
			expect(isIdScanVisionConfigured()).toBe(true);
			return;
		}
		const result = await extractIdFromImage(PNG_PIXEL);
		expect(result).toEqual({ ok: false, reason: 'unconfigured' });
	});
});
