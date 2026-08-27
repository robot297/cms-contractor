/** The RESOLVED theme — what is actually stamped on <html> and painted. */
export type Theme = 'light' | 'dark';

/**
 * What the user picked, which is not the same thing.
 *
 * `system` resolves to one of the two above and follows the OS live, so the
 * choice and the result have to be stored apart: a machine on auto-dark that
 * had `dark` written back at sunset would still be dark at breakfast.
 */
export type ThemeChoice = Theme | 'system';

/** The cycle a single control walks, in order. */
export const THEME_CHOICES = ['light', 'dark', 'system'] as const;

export const THEME_LABELS: Record<ThemeChoice, string> = {
	light: 'Light',
	dark: 'Dark',
	system: 'System'
};

function isChoice(value: string | null | undefined): value is ThemeChoice {
	return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * The label of whatever comes next in the cycle, for a control's accessible name.
 *
 * Lower-cased on purpose: it is read inside a sentence ("Switch to system"), not
 * as a heading. THEME_LABELS keeps the capitalised form for the button's face.
 */
export function nextThemeLabel(from: ThemeChoice): string {
	const i = THEME_CHOICES.indexOf(from);
	return THEME_LABELS[THEME_CHOICES[(i + 1) % THEME_CHOICES.length]].toLowerCase();
}

/**
 * The candidate palettes, while one is being chosen.
 *
 * Every one of them sets the same token names in src/app.css, so nothing in the
 * app branches on which is active — this is a stamp on <html>, not a code path.
 * Once a palette is picked, the losing blocks and this switcher come out and the
 * winner collapses back into the base `:root`.
 */
export const PALETTES = [
	'voltage',
	'outrun',
	'circuit',
	'overdrive',
	'abyss',
	'vapor',
	'halogen',
	'blueprint',
	// Round two. The first eight all landed on the same idea — a neon accent over
	// a near-black ground — so these were added to give the choice something to be
	// a choice BETWEEN: two warm, one site-safety, two deliberately quiet.
	'ember',
	'timber',
	'highvis',
	'ledger',
	'nocturne'
] as const;
export type Palette = (typeof PALETTES)[number];

/**
 * Name and one-line thesis for each, shown in the switcher.
 *
 * The blurb is not decoration — a column of swatches all read as "a colour" at
 * 10px, and the name alone does not say what you are about to look at.
 */
export const PALETTE_LABELS: Record<Palette, string> = {
	voltage: 'Voltage',
	outrun: 'Outrun',
	circuit: 'Circuit',
	overdrive: 'Overdrive',
	abyss: 'Abyss',
	vapor: 'Vapor',
	halogen: 'Halogen',
	blueprint: 'Blueprint',
	ember: 'Ember',
	timber: 'Timber',
	highvis: 'High Vis',
	ledger: 'Ledger',
	nocturne: 'Nocturne'
};

export const PALETTE_BLURBS: Record<Palette, string> = {
	voltage: 'Electric azure on blue-black',
	outrun: 'Magenta and cyan over an indigo horizon',
	circuit: 'Acid mint traces on carbon',
	overdrive: 'Electric violet bloom on plum',
	abyss: 'Bioluminescence at depth',
	vapor: 'Lavender and rose at dusk',
	halogen: 'Cold light on graphite',
	blueprint: 'Cyanotype drafting paper',
	ember: 'Forge orange over cooling iron',
	timber: 'Pine and cedar on kraft paper',
	highvis: 'Safety orange on wet asphalt',
	ledger: 'Ink and rule on accounting paper',
	nocturne: 'Brass on midnight plum'
};

/**
 * The two accents of each theme's DARK mode, for the switcher's swatches.
 *
 * Duplicated from app.css on purpose and the only place in the app that is:
 * a swatch has to show the theme it offers, not the one currently applied, so
 * it cannot read `var(--brand)`. Keep in step with the palette blocks.
 */
export const PALETTE_SWATCHES: Record<Palette, [string, string]> = {
	voltage: ['#2ec9ff', '#8b6cff'],
	outrun: ['#ff4ecd', '#2de2e6'],
	circuit: ['#2ff2a8', '#38bdf8'],
	overdrive: ['#a97bff', '#4ce0ff'],
	abyss: ['#22e0d0', '#4d8bff'],
	vapor: ['#c9a7ff', '#ff9ecd'],
	halogen: ['#d6ecff', '#5f7d92'],
	blueprint: ['#7fdbff', '#ffffff'],
	ember: ['#ff7a2f', '#ffc14d'],
	timber: ['#7fca8d', '#e0a15f'],
	highvis: ['#ff8a1f', '#d6ff3d'],
	ledger: ['#4fce8f', '#ff8a80'],
	nocturne: ['#e8c07a', '#c48cd8']
};

function isPalette(value: string | null | undefined): value is Palette {
	return (PALETTES as readonly string[]).includes(value ?? '');
}

/**
 * Which half of the product a preference belongs to.
 *
 * The contractor and their customer are two different people looking at two
 * different apps through one browser profile — most often the SAME browser,
 * because the contractor previews the portal from their own session. One stored
 * theme meant whichever of them last touched a switch redecorated the other's
 * app, and it meant the portal could not have a default of its own.
 *
 * 'app' covers the contractor side AND every signed-out page, so the marketing
 * pages, the login screen and the dashboard agree with each other.
 */
export type ThemeScope = 'app' | 'portal';

/** The portal is a path, not a role: `/customer/**` is the customer's half. */
export function scopeForPath(pathname: string): ThemeScope {
	return pathname === '/customer' || pathname.startsWith('/customer/') ? 'portal' : 'app';
}

/**
 * Storage keys. The 'app' scope keeps the bare names it has always used, so a
 * contractor's saved preference survives this change; the portal takes suffixed
 * ones. Mirrored by the pre-paint script in src/app.html — change both together.
 */
function storageKey(base: 'theme' | 'palette', scope: ThemeScope): string {
	return scope === 'portal' ? `${base}:portal` : base;
}

/** The scope of the page currently on screen. Server-side there is no URL. */
function activeScope(): ThemeScope {
	return typeof location === 'undefined' ? 'app' : scopeForPath(location.pathname);
}

function read(base: 'theme' | 'palette'): string | null {
	try {
		return localStorage.getItem(storageKey(base, activeScope()));
	} catch {
		return null;
	}
}

function write(base: 'theme' | 'palette', value: string) {
	try {
		localStorage.setItem(storageKey(base, activeScope()), value);
	} catch {
		/* storage may be unavailable (private mode) — the choice still holds for the session */
	}
}

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
	/** What is painted. Every consumer that asks "is it dark right now" wants this. */
	current = $state<Theme>('light');
	/** What the user picked. Only the controls that OFFER the choice want this. */
	choice = $state<ThemeChoice>('system');

	/** Read the pre-paint value back. Safe to call from any component's onMount. */
	sync() {
		this.current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
		const stored = read('theme');
		// Nothing stored IS system — it is what the app has always done with an
		// absent preference, so every existing install lands on the new third
		// option rather than being told it picked something it never picked.
		this.choice = isChoice(stored) ? stored : 'system';
	}

	/**
	 * Re-stamp <html> from the stored preference for the page now on screen.
	 *
	 * The pre-paint script does this for the FIRST page. Every page after it is a
	 * client-side navigation, which never reloads the document — so crossing from
	 * /contractor to /customer left the contractor's stamp in place and the portal
	 * wearing someone else's theme. Called from the root layout on every
	 * navigation; a no-op when the scope has not changed.
	 */
	adopt() {
		const stored = read('theme');
		// Stamped, not `set`. A scope nobody has chosen for yet follows the OS, and
		// writing that back would freeze today's OS setting in as a deliberate
		// choice. Only an actual pick persists anything.
		this.choice = isChoice(stored) ? stored : 'system';
		this.stamp(resolve(this.choice));
	}

	/** Apply to <html> and to every control on the page, without persisting. */
	private stamp(next: Theme) {
		this.current = next;
		document.documentElement.dataset.theme = next;
	}

	set(next: ThemeChoice) {
		this.choice = next;
		this.stamp(resolve(next));
		write('theme', next);
	}

	/** Light → Dark → System → Light. What every one-button control does. */
	cycle() {
		const i = THEME_CHOICES.indexOf(this.choice);
		this.set(THEME_CHOICES[(i + 1) % THEME_CHOICES.length]);
	}

	/**
	 * Follow the OS while `system` is the choice.
	 *
	 * Without this, `system` would mean "whatever the OS said when this tab
	 * loaded" — which is the one thing it must not mean, since the whole reason
	 * to pick it is a machine that flips itself at sunset. Called once from the
	 * root layout; returns its own teardown.
	 */
	watchSystem(): () => void {
		let mq: MediaQueryList;
		try {
			mq = matchMedia('(prefers-color-scheme: dark)');
		} catch {
			return () => {};
		}
		const onChange = () => {
			if (this.choice === 'system') this.stamp(resolve('system'));
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}
}

/** A choice, reduced to the theme it paints. */
function resolve(choice: ThemeChoice): Theme {
	return choice === 'system' ? systemTheme() : choice;
}

/** What the OS asks for — what `system` resolves to. */
function systemTheme(): Theme {
	try {
		return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	} catch {
		return 'light';
	}
}

export const theme = new ThemeStore();

/**
 * Which candidate palette is on.
 *
 * Same shape as the theme store and for the same reason: the value is applied
 * pre-paint by app.html, and this only reads it back so every control on the
 * page agrees, then writes the choice to <html data-palette> + localStorage.
 */
class PaletteStore {
	current = $state<Palette>('voltage');

	sync() {
		const stamped = document.documentElement.dataset.palette;
		this.current = isPalette(stamped) ? stamped : 'voltage';
	}

	/** Re-stamp from the stored choice for this side. See ThemeStore.adopt. */
	adopt() {
		const stored = read('palette');
		this.stamp(isPalette(stored) ? stored : 'voltage');
	}

	/** Apply to <html> and to every control on the page, without persisting. */
	private stamp(next: Palette) {
		this.current = next;
		document.documentElement.dataset.palette = next;
	}

	set(next: Palette) {
		this.stamp(next);
		write('palette', next);
	}

	/** Step to the next candidate, wrapping. */
	cycle() {
		const i = PALETTES.indexOf(this.current);
		this.set(PALETTES[(i + 1) % PALETTES.length]);
	}
}

export const palette = new PaletteStore();
