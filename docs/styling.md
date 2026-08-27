# Styling conventions

Everything here lives in `src/app.css`. Two of the rules below are enforced by
tests rather than by review, because both had already been broken more than once.

## The one rule that keeps biting

**Never put a colour token that flips between themes on a fill that doesn't.**

The brand yellow is light in _both_ themes. `--ink`, `--fg`, `--muted`, and every
other surface token are dark on light and near-white on dark. So this:

```css
background: var(--yellow);
color: var(--ink); /* WRONG */
```

looks correct while you build it in light mode and renders white-on-yellow the
moment anyone flips the theme. It has shipped four separate times — the
dashboard's waiting badge, the orders list's unread badge, an order's document
button, the dev role switcher.

Use the token that exists for exactly this:

```css
background: var(--yellow);
color: var(--on-yellow); /* right */
```

`--on-yellow` is defined once, at `:root`, and is deliberately **never**
overridden in the dark block. That is the whole point of it.

Inheriting is the same bug wearing a disguise — a yellow pill with no `color` of
its own picks up the shell's text colour, which flips. State the foreground.

`src/lib/theme.contrast.test.ts` fails the build on both mistakes.

## Tokens over literals

If you are typing a hex code into a component, check whether it already has a
name. The status palette in particular was typed out as raw literals in about ten
files, which is how the same "Active" pill ended up a slightly different green
depending on the screen.

| Group       | Tokens                                     | For                                 |
| ----------- | ------------------------------------------ | ----------------------------------- |
| Brand       | `--yellow`, `--yellow-deep`, `--on-yellow` | Accent fills and their text         |
| Surfaces    | `--surface`, `--surface-sunken`, `--paper` | Cards, wells, page ground           |
| Text        | `--fg`, `--fg-muted`, `--ink`, `--muted`   | Primary and secondary copy          |
| Lines       | `--line`, `--line-strong`, `--pop-line`    | Borders and hairlines               |
| Fields      | `--field-bg`, `--field-border`             | Inputs                              |
| On track    | `--ok-bg`, `--ok-line`, `--ok-fg`          | Done, active, linked, trusted       |
| Waiting     | `--wait-bg`, `--wait-line`, `--wait-fg`    | Quote out, deposit due, on hold     |
| Stopped     | `--stop-bg`, `--stop-line`, `--stop-fg`    | Cancelled, failed, expired          |
| Destructive | `--danger`                                 | Delete/archive controls, error text |

Status tokens are named for what they **mean**, not what colour they are, so a
palette change doesn't turn every call site into a lie.

`--danger` is for destructive actions and errors only. It is deliberately _not_
used for counts of things waiting on you — see
[ADR-0009](adr/0009-waiting-counts-use-the-accent-not-danger.md).

## Shared classes

Reach for these before writing a new rule or an inline style. Each one replaced
the same treatment copied across two to four files.

| Class          | What it is                                                       |
| -------------- | ---------------------------------------------------------------- |
| `.card`        | The standard panel. Token-driven, so dark mode needs nothing.    |
| `.count-badge` | "N waiting on you" — nav, dashboard, orders list.                |
| `.status-pill` | How a job is doing. Add a tone: `.ok`, `.wait`, `.stop`.         |
| `.menu-item`   | A row in a card's ⋯ menu. Add `.danger` for the destructive row. |
| `.field-input` | The plain bordered input used in cards and inline forms.         |
| `.icon-btn`    | Icon buttons. Size stays inline; it varies per use.              |

Call sites should add only what is genuinely local — a margin against a nav
label, a `flex: 1` in a row. If you find yourself restating the fill, the radius
or the type, the shared rule is the thing to change.

## Inline styles and the interception layer

Much of the app styles through inline `style="…"` attributes, and `app.css`
compensates with a block of attribute selectors that match on colour literals
(`[style*='background: #fff']`) and rewrite them for dark mode. It works, but it
is a workaround, not a pattern to extend: it only fires for the exact literals
listed, which is why a new inline style can silently miss dark mode entirely.

Prefer a class. `.field-input` exists because two files had inline
`border: 1px solid #d0d7de` purely so that interception layer could catch it —
as a class it reads from the field tokens directly and needs no interception at
all.

## No raw control characters in source

Spell them as backslash-u escapes, never as the byte itself. A literal control
character makes the whole file register as **binary** to `grep` and `ripgrep`,
which then skip it silently — a 46KB module at the centre of the app returned
nothing for any search until this was found. They are also invisible in review
and easy for an editor or a formatter to mangle.

Three places had picked them up legitimately — a regex range in `safeFilename`,
a NUL separator in `guide.server.ts`, and AAMVA separators in an ID-scan
fixture — and all three now use escapes. Same bytes at runtime, none of the
cost.

`src/lib/source-hygiene.test.ts` enforces it.

## A note on CSP

The app sets baseline security headers in `src/hooks.server.ts` but **no full
Content-Security-Policy**, and that is a decision rather than an oversight: with
this much inline styling, a real policy needs `style-src 'unsafe-inline'` plus
nonces for SvelteKit's hydration scripts, and can't be shipped without checking
every surface in a browser. Moving styling off inline attributes is what would
make a strict CSP practical.
