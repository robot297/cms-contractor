import { composeEmail, type TemplateVars } from './crm';

/**
 * Rendering a contractor's message into a sendable email.
 *
 * Two parts come out of one input: the HTML a mail client shows, and the plain
 * text it falls back to (and that `mailto:` still uses while sending is not
 * configured). They are generated together, from the same string, so they cannot
 * drift — see docs/adr/0007-the-app-sends-email-mailto-is-the-fallback.md.
 *
 * Templates stay plain text on purpose. Contractors author a message, not markup;
 * the design lives here, in one shell, where it can be fixed for everyone at once.
 *
 * The HTML is written to email rules rather than web rules: tables for layout,
 * every style inlined, a fixed 600px column, no web fonts and no external assets.
 * Gmail strips <style> blocks in some contexts and Outlook renders through Word,
 * so anything clever here is something that breaks in someone's inbox.
 */

/** Branding the shell draws on. No logo field exists yet, so the header is type. */
export type EmailBranding = {
	businessName: string;
	signature: string;
};

export type RenderedEmail = {
	subject: string;
	/** Full document, suitable both for sending and for an <iframe srcdoc>. */
	html: string;
	/** The plain-text alternative part — identical to what `mailto:` would carry. */
	text: string;
};

// The app's palette, pinned as literals: an email has no CSS variables, no theme
// toggle and no access to app.css. Yellow keeps dark text in every context for the
// same reason it does in the app — it stays light whatever the client does.
const YELLOW = '#ffcc00';
const INK = '#14171c';
const BODY_FG = '#1f2328';
const MUTED_FG = '#57606a';
const PAGE_BG = '#f6f8fa';
const CARD_BG = '#ffffff';
const LINE = '#e2e6ea';

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Escape text for HTML. Everything below runs on already-escaped strings. */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Turn bare http(s) URLs into links. Deliberately narrow: only those two schemes,
 * and trailing sentence punctuation is left outside the link so "see https://x.com."
 * doesn't produce a dead URL. Runs after escaping, so the match can't span markup.
 */
function linkify(escaped: string): string {
	return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
		const trimmed = url.replace(/[.,;:!?)\]}'"]+$/, '');
		const trailing = url.slice(trimmed.length);
		return `<a href="${trimmed}" style="color: ${BODY_FG}; text-decoration: underline;">${trimmed}</a>${trailing}`;
	});
}

/**
 * Plain text to HTML paragraphs: a blank line starts a new paragraph, a single
 * newline is a line break inside one. That is how people actually type a message,
 * and it means the same source reads correctly in both parts.
 */
function paragraphs(text: string, style: string): string {
	return text
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter(Boolean)
		.map(
			(block) => `<p style="${style}">${linkify(escapeHtml(block)).replace(/\n/g, '<br />')}</p>`
		)
		.join('\n');
}

/**
 * Render a template into a sendable email.
 *
 * `body`/`subject` are resolved against `vars` and the signature appended by
 * `composeEmail`, so the text part is exactly what the composer sends today. The
 * signature is then split back out for the HTML part, where it sits under a rule
 * rather than after two blank lines.
 */
export function renderEmail(
	template: { subject: string; body: string },
	vars: TemplateVars,
	branding: EmailBranding,
	opts?: {
		/**
		 * The grey line under the card. Defaults to the contractor-message footer
		 * ("just hit reply…"); transactional mail from the product itself passes its
		 * own sentence, and `null` drops the footer entirely. Inserted as HTML —
		 * product-authored copy only, never user input.
		 */
		footerNote?: string | null;
		/**
		 * A rendered HTML block dropped in under the message, before the signature —
		 * the invoice table is the only thing that uses it today. Inserted as HTML,
		 * so the same rule as `footerNote` applies and is stricter here because this
		 * one carries figures: PRODUCT-AUTHORED markup only, built by a renderer
		 * that escapes its own inputs (see `renderInvoiceBlockHtml`). A template
		 * body must never reach this slot — that is what `body` is for, and it is
		 * escaped on the way through.
		 *
		 * The text part gets no such slot: whatever this block says has to be said
		 * in `body` too, or the plain-text alternative would be missing figures the
		 * HTML shows. `sendFinalInvoiceEmail` does exactly that.
		 */
		blockHtml?: string;
		/**
		 * The same block as plain text, dropped into the text part in the same place.
		 * Passed alongside `blockHtml` rather than derived from it, because turning a
		 * layout table back into readable lines is a worse job than rendering both
		 * from the figures — which is what `invoice.ts` does.
		 *
		 * NOT run through placeholder resolution: it is already-rendered output, and
		 * a contractor's payment note that happens to contain `{{project}}` should
		 * reach the customer as they typed it.
		 */
		blockText?: string;
	}
): RenderedEmail {
	const { subject } = composeEmail(template, vars, branding.signature);

	// Re-render the two halves separately for the HTML part. Composing again rather
	// than parsing the text back apart: a signature that happens to appear in the
	// body would make that split guess wrong.
	const message = composeEmail({ subject: '', body: template.body }, vars, null).body;
	const signature = composeEmail({ subject: '', body: '' }, vars, branding.signature).body;
	// The text part is assembled from the same three pieces the HTML uses, in the
	// same order, so the block lands between the message and the signature in both
	// — rather than after the signature, which is where appending it to the
	// template body would have put it. With no block this is exactly what
	// `composeEmail(template, vars, signature)` returns.
	const text = [message, opts?.blockText?.trim(), signature].filter(Boolean).join('\n\n');
	const businessName = branding.businessName.trim();
	const footerNote =
		opts?.footerNote === undefined
			? businessName
				? `Sent by ${escapeHtml(businessName)}. Just hit reply — it goes straight to them.`
				: ''
			: (opts.footerNote ?? '');

	const bodyStyle = `margin: 0 0 14px; font-family: ${FONT}; font-size: 16px; line-height: 1.55; color: ${BODY_FG};`;
	const signatureStyle = `margin: 0 0 6px; font-family: ${FONT}; font-size: 15px; line-height: 1.5; color: ${MUTED_FG};`;

	const html = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<!-- Opt out of client-side dark-mode inversion: the shell already pins its
		     own light surfaces, and a client re-colouring them mid-flight is how
		     dark text ends up on a dark card. -->
		<meta name="color-scheme" content="light" />
		<meta name="supported-color-schemes" content="light" />
		<title>${escapeHtml(subject)}</title>
	</head>
	<body style="margin: 0; padding: 0; background: ${PAGE_BG};">
		<!-- Preheader: the grey line a client shows next to the subject. Kept out of
		     sight in the message itself. -->
		<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
			${escapeHtml(firstLine(message))}
		</div>
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${PAGE_BG};">
			<tr>
				<td align="center" style="padding: 24px 12px;">
					<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; background: ${CARD_BG}; border: 1px solid ${LINE}; border-radius: 14px;">
						<!-- Masthead. Typographic while there's no logo to hang here;
						     the yellow bar is the brand's one loud element. -->
						<tr>
							<td style="height: 6px; background: ${YELLOW}; border-radius: 13px 13px 0 0; font-size: 0; line-height: 0;">&nbsp;</td>
						</tr>
						${
							businessName
								? `<tr>
							<td style="padding: 22px 28px 0;">
								<div style="font-family: ${FONT}; font-size: 18px; font-weight: 800; letter-spacing: -0.01em; color: ${INK};">${escapeHtml(businessName)}</div>
							</td>
						</tr>`
								: ''
						}
						<tr>
							<td style="padding: ${businessName ? '18px' : '26px'} 28px 8px;">
								${paragraphs(message, bodyStyle) || `<p style="${bodyStyle}">&nbsp;</p>`}
							</td>
						</tr>
						${
							opts?.blockHtml
								? `<tr>
							<td style="padding: 0 28px;">
								${opts.blockHtml}
							</td>
						</tr>`
								: ''
						}
						${
							signature
								? `<tr>
							<td style="padding: 0 28px 24px;">
								<div style="border-top: 1px solid ${LINE}; padding-top: 16px;">
									${paragraphs(signature, signatureStyle)}
								</div>
							</td>
						</tr>`
								: `<tr><td style="padding: 0 28px 24px;">&nbsp;</td></tr>`
						}
					</table>
					${
						footerNote
							? `<div style="max-width: 600px; padding: 14px 8px 0; font-family: ${FONT}; font-size: 12px; line-height: 1.5; color: ${MUTED_FG};">
						${footerNote}
					</div>`
							: ''
					}
				</td>
			</tr>
		</table>
	</body>
</html>`;

	return { subject, html, text };
}

/** First non-empty line, trimmed for the preheader. */
function firstLine(text: string): string {
	const line = text.split('\n').find((l) => l.trim() !== '') ?? '';
	return line.trim().slice(0, 140);
}
