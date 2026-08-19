import * as Sentry from '@sentry/sveltekit';

Sentry.init({
	dsn: 'https://ecce42c9070cf445560ae9299e00f3b7@o4508951216848896.ingest.us.sentry.io/4511915428478976',

	tracesSampleRate: 1.0,

	// Enable logs to be sent to Sentry
	enableLogs: true

	// uncomment the line below to enable Spotlight (https://spotlightjs.com)
	// spotlight: import.meta.env.DEV,
});
