import { Resend } from 'resend';
import { ENV } from 'varlock/env';
import { renderEmail } from '$lib/email';

/**
 * Everything that talks to the mail provider.
 *
 * The whole integration is one function. Calling code passes a rendered message
 * and gets back a result it can render; nothing outside this file names Resend or
 * imports a provider type, so swapping to Postmark or SES is an edit here and
 * nowhere else — see docs/adr/0007-the-app-sends-email-mailto-is-the-fallback.md.
 *
 * Sending degrades rather than fails. With no key configured the composer keeps
 * handing off to `mailto:` exactly as it did before, which is what makes this
 * safe to ship before any DNS work is done, and what keeps development, the demo
 * and self-hosters working with no mail account at all.
 */

export type SendEmailInput = {
	to: string;
	/** Where a reply goes — the contractor's own address, never the send domain. */
	replyTo: string;
	/** Display name on the From line. Blank sends from the bare address. */
	fromName: string;
	subject: string;
	html: string;
	text: string;
};

export type SendEmailResult =
	{ ok: true } | { ok: false; reason: 'unconfigured' | 'provider'; detail?: string };

let client: Resend | null = null;

/**
 * The configured-or-degrade rule, as a pure predicate.
 *
 * Both halves are required. A key with no verified from-address produces a
 * provider rejection on every single send — a feature that looks configured and
 * is broken. Treating that as unconfigured turns it back into the fallback, which
 * works. Split out from `isEmailConfigured` so the rule can be tested without
 * standing up varlock's env.
 */
export function emailConfigured(key: string | undefined, from: string | undefined): boolean {
	return Boolean(key?.trim() && from?.trim());
}

/** Whether mail can actually be sent, per this deployment's configuration. */
export function isEmailConfigured(): boolean {
	return emailConfigured(ENV.RESEND_API_KEY, ENV.EMAIL_FROM);
}

/**
 * Whether the composer may fake a send outcome. Off unless explicitly "true" —
 * the same shape as `isBillingDevToolsEnabled`, and for the same reason: it lets
 * any signed-in contractor claim a message went out.
 */
export function isEmailDevToolsEnabled(): boolean {
	return ENV.EMAIL_DEV_TOOLS === 'true';
}

/** What a simulated send should pretend happened. */
export type SimulatedOutcome = 'success' | 'failure';

export function asSimulatedOutcome(value: string | undefined): SimulatedOutcome | null {
	return value === 'success' || value === 'failure' ? value : null;
}

/** The Resend client, or null when sending isn't configured. */
function resendClient(): Resend | null {
	const key = ENV.RESEND_API_KEY;
	if (!key) return null;
	client ??= new Resend(key);
	return client;
}

/**
 * Quote a display name for a From header.
 *
 * Business names are contractor-authored, so they carry commas, quotes and the
 * occasional backslash. Unquoted, a comma alone turns one recipient into two in
 * a parser's eyes; RFC 5322 wants a quoted-string with `\` and `"` escaped.
 */
export function formatFrom(fromName: string, address: string): string {
	const name = fromName.trim();
	if (!name) return address;
	const quoted = name.replace(/([\\"])/g, '\\$1');
	return `"${quoted}" <${address}>`;
}

/**
 * The account-verification message — transactional, sent by the product itself
 * rather than composed by a contractor, so it lives here beside the provider.
 * Rendered through the same branded shell as every customer email (`renderEmail`),
 * with the product as the sender and a transactional footer in place of the
 * "just hit reply" line.
 *
 * Unconfigured installs log the link instead of sending: sign-up must never
 * dead-end because a self-hoster hasn't set up mail. (Verification is only
 * *enforced* where mail is configured — see `requireEmailVerification` in
 * auth.ts — so the log line is a dev convenience, not a security hole.)
 */
export async function sendVerificationEmail(to: string, name: string, url: string): Promise<void> {
	if (!isEmailConfigured()) {
		console.info(`[email] verification link for ${to}: ${url}`);
		return;
	}
	const first = name.trim().split(/\s+/)[0] || 'there';
	const rendered = renderEmail(
		{
			subject: 'Verify your email address',
			body: `Hi ${first},\n\nConfirm this address to finish setting up your Contractor CRM account:\n\n${url}\n\nIf you didn't create this account, you can ignore this message.`
		},
		// No placeholders in the body — the vars just satisfy the renderer.
		{ customer: name, contractor: 'Contractor CRM', project: '' },
		{ businessName: 'Contractor CRM', signature: '' },
		{ footerNote: 'Sent by Contractor CRM because this address was used to create an account.' }
	);
	const result = await sendEmail({
		to,
		// Replies to a verification mail have nowhere better to go than the
		// product's own address.
		replyTo: ENV.EMAIL_FROM ?? '',
		fromName: 'Contractor CRM',
		subject: rendered.subject,
		html: rendered.html,
		text: rendered.text
	});
	if (!result.ok) {
		// Thrown rather than swallowed: better-auth reports the failure to the
		// sign-up caller, which beats a silent "check your inbox" for mail that
		// never left.
		throw new Error(`Verification email failed: ${result.reason} ${result.detail ?? ''}`.trim());
	}
}

/**
 * Send one message. Never throws.
 *
 * A provider failure is an expected outcome here, not an exceptional one — the
 * contractor is sitting in front of the composer and needs to see it and choose
 * what to do. Returning it as a value means no caller can forget to handle it,
 * which a thrown error invites.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
	const resend = resendClient();
	const from = ENV.EMAIL_FROM;
	if (!resend || !from) return { ok: false, reason: 'unconfigured' };

	try {
		const { error } = await resend.emails.send({
			from: formatFrom(input.fromName, from),
			to: input.to,
			replyTo: input.replyTo,
			subject: input.subject,
			html: input.html,
			text: input.text
		});
		if (error) return { ok: false, reason: 'provider', detail: error.message };
		return { ok: true };
	} catch (err) {
		// Network refusal, DNS, a timeout — anything the SDK throws rather than
		// reports. Same outcome for the contractor either way.
		return {
			ok: false,
			reason: 'provider',
			detail: err instanceof Error ? err.message : undefined
		};
	}
}
