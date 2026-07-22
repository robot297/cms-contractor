import { env } from '$env/dynamic/private';
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
	return Boolean(env.GITHUB_REPO?.trim() && env.GITHUB_TOKEN?.trim());
}

/** The label to tag an issue with, per feedback type (env-overridable). */
function labelFor(type: Feedback['type']): string {
	if (type === 'bug') return env.GITHUB_LABEL_BUG?.trim() || 'bug';
	return env.GITHUB_LABEL_FEATURE?.trim() || 'enhancement';
}

export type FiledIssue = { url: string; number: number };

/**
 * Create a GitHub issue for the feedback, labelled by type. Returns the new
 * issue's URL + number. Throws SupportError with a friendly message on any
 * misconfiguration or API failure (details are logged server-side).
 */
export async function submitFeedback(
	feedback: Feedback,
	submittedBy?: { name?: string | null; email?: string | null }
): Promise<FiledIssue> {
	const repo = env.GITHUB_REPO?.trim();
	const token = env.GITHUB_TOKEN?.trim();
	if (!repo || !token) {
		throw new SupportError('The support form is not configured yet. Please contact your admin.');
	}
	if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
		console.error(`[support] GITHUB_REPO is malformed: "${repo}" (expected "owner/repo")`);
		throw new SupportError('The support form is misconfigured. Please contact your admin.');
	}

	const { title, body } = buildFeedbackIssue(feedback, submittedBy);

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
