/**
 * The contract between `EmailTemplatesPanel` and whichever route hosts it.
 *
 * Declared here rather than taken from a route's `./$types` because the panel is
 * a component now, not a page — it used to be `/contractor/settings/templates`
 * and moved into the account page. Naming its own inputs keeps it host-agnostic,
 * so moving it again is a matter of passing the same shape.
 */

export type EmailTemplateView = {
	id: string;
	name: string;
	subject: string;
	body: string;
};

export type EmailTemplatesData = {
	templates: EmailTemplateView[];
	signature: string;
	businessName: string;
	followUpDays: number;
	/** Loaded by the contractor layout, so it arrives on page data for free. */
	contractorTags: string[];
};

/**
 * What the panel's actions hand back. Every field is optional: a form result may
 * come from an action this panel doesn't own (the page hosting it has others), in
 * which case none of these are set and nothing renders.
 */
export type EmailTemplatesForm = {
	action?: string;
	message?: string;
	saved?: string;
} | null;
