import { ENV } from 'varlock/env';
import { buildFeedbackIssue, type Feedback } from '$lib/crm';

/**
 * Files contractor feedback from the support page as GitHub issues on the repo
 * configured in the (varlock) env — `GITHUB_REPO` + `GITHUB_TOKEN`, with the
 * label applied per feedback type. See `.env.schema`.
 */

/** Raised for any failure filing the issue; carries a user-safe message. */
export class SupportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SupportError';
	}
}

/** True when the repo + token are both configured, so the form can accept input. */
export function isSupportConfigured(): boolean {
	return Boolean(ENV.GITHUB_REPO?.trim() && ENV.GITHUB_TOKEN?.trim());
}

// ------------------------------------------------------------ Bot protection

/** True when Cloudflare Turnstile keys are configured (challenge is enforced). */
export function isCaptchaConfigured(): boolean {
	return Boolean(ENV.TURNSTILE_SITE_KEY?.trim() && ENV.TURNSTILE_SECRET_KEY?.trim());
}

/** The public Turnstile site key to render client-side, or null when disabled. */
export function captchaSiteKey(): string | null {
	return isCaptchaConfigured() ? ENV.TURNSTILE_SITE_KEY!.trim() : null;
}

/**
 * Verify a Turnstile token with Cloudflare. Returns true when the challenge
 * passes — or when captcha is not configured, so the form still works without
 * keys (the honeypot guard stays active regardless). Never throws.
 */
export async function verifyCaptcha(token: string | null, remoteip?: string): Promise<boolean> {
	if (!isCaptchaConfigured()) return true;
	if (!token) return false;
	try {
		const body = new URLSearchParams();
		body.set('secret', ENV.TURNSTILE_SECRET_KEY!.trim());
		body.set('response', token);
		if (remoteip) body.set('remoteip', remoteip);
		const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			body
		});
		const data = (await res.json()) as { success?: boolean };
		return data.success === true;
	} catch {
		return false;
	}
}

/** The label to tag an issue with, per feedback type (env-overridable). */
function labelFor(type: Feedback['type']): string {
	if (type === 'bug') return ENV.GITHUB_LABEL_BUG?.trim() || 'bug';
	return ENV.GITHUB_LABEL_FEATURE?.trim() || 'enhancement';
}

// ------------------------------------------------------------- Screenshots

/** Client and server both enforce this; GitHub's Contents API takes far more,
 *  but a support screenshot has no business being bigger. */
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB

export type SupportScreenshot = { name: string; type: string; bytes: Uint8Array };

/** Image types worth accepting from a screenshot picker. */
export function isAllowedScreenshotType(mime: string): boolean {
	return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime);
}

/**
 * Park the screenshot in the support repo (a `support-uploads/` folder, via the
 * Contents API) so the issue can reference it — the Issues API itself has no
 * supported way to attach an image. Returns the embed + link URLs, or null on
 * any failure: a screenshot that didn't stick must never cost the report.
 */
async function uploadScreenshot(
	repo: string,
	token: string,
	shot: SupportScreenshot
): Promise<{ imageUrl: string; linkUrl: string } | null> {
	// Sanitized original name, stamped so two "Screenshot.png"s never collide.
	const safeName =
		shot.name
			.replace(/[^a-zA-Z0-9._-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(-64) || 'screenshot.png';
	const path = `support-uploads/${Date.now()}-${safeName}`;
	try {
		const response = await fetch(
			`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`,
			{
				method: 'PUT',
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/vnd.github+json',
					'X-GitHub-Api-Version': '2022-11-28',
					'User-Agent': 'contractor-crm-support',
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					message: `Add support screenshot ${safeName}`,
					content: Buffer.from(shot.bytes).toString('base64')
				})
			}
		);
		if (!response.ok) {
			console.error(`[support] screenshot upload failed (${response.status})`);
			return null;
		}
		const data = (await response.json()) as {
			content?: { html_url?: string; download_url?: string };
		};
		if (!data.content?.html_url) return null;
		return {
			imageUrl: data.content.download_url ?? data.content.html_url,
			linkUrl: data.content.html_url
		};
	} catch (error) {
		console.error('[support] screenshot upload error:', error);
		return null;
	}
}

export type FiledIssue = { url: string; number: number };

/**
 * Create a GitHub issue for the feedback, labelled by type. Returns the new
 * issue's URL + number. Throws SupportError with a friendly message on any
 * misconfiguration or API failure (details are logged server-side).
 */
export async function submitFeedback(
	feedback: Feedback,
	submittedBy?: { name?: string | null; email?: string | null },
	screenshot?: SupportScreenshot | null
): Promise<FiledIssue> {
	const repo = ENV.GITHUB_REPO?.trim();
	const token = ENV.GITHUB_TOKEN?.trim();
	if (!repo || !token) {
		throw new SupportError('The support form is not configured yet. Please contact your admin.');
	}
	if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
		console.error(`[support] GITHUB_REPO is malformed: "${repo}" (expected "owner/repo")`);
		throw new SupportError('The support form is misconfigured. Please contact your admin.');
	}

	// Best-effort: a failed upload files the issue without the image rather than
	// bouncing the whole report.
	const uploaded = screenshot ? await uploadScreenshot(repo, token, screenshot) : null;
	const { title, body } = buildFeedbackIssue(feedback, submittedBy, uploaded);

	let response: Response;
	try {
		response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'contractor-crm-support',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ title, body, labels: [labelFor(feedback.type)] })
		});
	} catch (error) {
		console.error('[support] network error reaching GitHub:', error);
		throw new SupportError('Could not reach GitHub. Please try again in a moment.');
	}

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		console.error(`[support] GitHub issue create failed (${response.status}): ${detail}`);
		if (response.status === 401 || response.status === 403) {
			throw new SupportError(
				'The support form is misconfigured (auth). Please contact your admin.'
			);
		}
		if (response.status === 404) {
			throw new SupportError(
				'The support repository could not be found. Please contact your admin.'
			);
		}
		throw new SupportError('Something went wrong filing your feedback. Please try again.');
	}

	const issue = (await response.json()) as { html_url?: string; number?: number };
	if (!issue.html_url || typeof issue.number !== 'number') {
		console.error('[support] unexpected GitHub response shape:', issue);
		throw new SupportError('Feedback was sent but the confirmation was unexpected.');
	}
	return { url: issue.html_url, number: issue.number };
}
