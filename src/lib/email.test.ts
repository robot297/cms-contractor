import { describe, expect, it } from 'vitest';
import { escapeHtml, renderEmail } from './email';

const BRANDING = { businessName: "Daniel's Decks", signature: 'Thanks so much,\n{{contractor}}' };
const VARS = {
	customer: 'Jordan Rivera',
	contractor: "Daniel's Decks",
	project: 'Backyard Pergola'
};

const render = (subject: string, body: string, branding = BRANDING) =>
	renderEmail({ subject, body }, VARS, branding);

describe('email rendering', () => {
	it('resolves placeholders in both parts', () => {
		const { subject, html, text } = render('{{project}} update', 'Hi {{customer}}, all set.');
		expect(subject).toBe('Backyard Pergola update');
		expect(text).toContain('Hi Jordan Rivera, all set.');
		expect(html).toContain('Hi Jordan Rivera, all set.');
		expect(html).not.toContain('{{customer}}');
	});

	it('sends the same message in the text part that mailto would carry', () => {
		const { text } = render('Follow-up', 'Hi Jordan,\n\nJust checking in.');
		// composeEmail's output, signature appended — unchanged by HTML rendering.
		expect(text).toBe("Hi Jordan,\n\nJust checking in.\n\nThanks so much,\nDaniel's Decks");
	});

	it('escapes HTML in the message rather than rendering it', () => {
		const { html } = render('Hi', 'Quote for <b>deck & rails</b> is ready.');
		expect(html).toContain('Quote for &lt;b&gt;deck &amp; rails&lt;/b&gt; is ready.');
		expect(html).not.toContain('<b>deck');
	});

	it('escapes the business name, subject and signature too', () => {
		const { html } = render('A & B', 'Body', {
			businessName: 'Bob & Sons <Builders>',
			signature: 'Cheers, <Bob>'
		});
		expect(html).toContain('Bob &amp; Sons &lt;Builders&gt;');
		expect(html).toContain('<title>A &amp; B</title>');
		expect(html).toContain('Cheers, &lt;Bob&gt;');
	});

	it('makes a blank line a paragraph and a single newline a line break', () => {
		const { html } = render('Hi', 'First para.\nSecond line.\n\nNew para.');
		expect(html).toContain('First para.<br />Second line.');
		expect(html).toContain('New para.');
		// Two body paragraphs, plus whatever the signature block contributes.
		expect(html.match(/font-size: 16px/g)).toHaveLength(2);
	});

	it('links bare URLs but leaves trailing punctuation outside the link', () => {
		const { html } = render('Hi', 'Track it at https://example.com/orders/7.');
		expect(html).toContain('href="https://example.com/orders/7"');
		expect(html).toContain('>https://example.com/orders/7</a>.');
	});

	it('does not link other schemes', () => {
		const { html } = render('Hi', 'Run javascript:alert(1) at ftp://files.example.com');
		expect(html).not.toContain('<a href="javascript:');
		expect(html).not.toContain('<a href="ftp:');
	});

	it('renders a full document that can be sent or previewed in an iframe', () => {
		const { html } = render('Hi', 'Body');
		expect(html.startsWith('<!doctype html>')).toBe(true);
		expect(html).toContain('name="color-scheme"');
		expect(html).toContain('max-width: 600px');
	});

	it('carries the first line as the preheader', () => {
		const { html } = render('Hi', 'Your deck is scheduled.\n\nMore detail here.');
		const preheader = html.slice(html.indexOf('display: none'), html.indexOf('<table'));
		expect(preheader).toContain('Your deck is scheduled.');
	});

	it('drops the masthead and footer when there is no business name', () => {
		const { html } = render('Hi', 'Body', { businessName: '  ', signature: '' });
		expect(html).not.toContain('Sent by');
		expect(html).toContain('Body');
	});

	it('renders an empty body without collapsing the shell', () => {
		const { html } = render('Hi', '');
		expect(html).toContain('max-width: 600px');
		expect(html).toContain('&nbsp;');
	});
});

describe('escapeHtml', () => {
	it('escapes the five characters that matter in markup', () => {
		expect(escapeHtml(`<a href="x" data-x='y'>&</a>`)).toBe(
			'&lt;a href=&quot;x&quot; data-x=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
		);
	});
});
