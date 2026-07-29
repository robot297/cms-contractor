export type Theme = 'light' | 'dark';

/**
 * Shared light / dark state.
 *
 * The initial value is applied pre-paint by the inline script in app.html, so this
 * store's job is only to read that back (so every toggle on the page agrees on the
 * current theme) and to write the user's choice to <html data-theme> + localStorage.
 *
 * It lives here rather than in the contractor layout because signed-out pages — the
 * landing page and the login screen — need the toggle too.
 */
class ThemeStore {
	current = $state<Theme>('light');

	/** Read the pre-paint value back. Safe to call from any component's onMount. */
	sync() {
		this.current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
	}

	set(next: Theme) {
		this.current = next;
		document.documentElement.dataset.theme = next;
		try {
			localStorage.setItem('theme', next);
		} catch {
			/* storage may be unavailable (private mode) — the toggle still works for the session */
		}
	}

	toggle() {
		this.set(this.current === 'dark' ? 'light' : 'dark');
	}
}

export const theme = new ThemeStore();
