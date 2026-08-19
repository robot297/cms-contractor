# 9. A waiting count wears the accent, not danger

Date: 2026-08-14

## Status

Accepted

## Context

"How many customers are waiting on a reply" surfaces in four places: the nav's
Orders link, the dashboard's waiting list, each row of the orders list, and the
Messages tab inside an order. Each had grown its own rule, in its own file, and
the four had drifted into two different colours — red (`--danger`) in the nav and
the order workspace, brand yellow on the dashboard and the orders list.

Both colours had a comment defending them, written at different times:

> Deliberately the accent colour rather than a red alert — a waiting question is
> normal work, not a fault.

> The one count on this strip that is a notification rather than an inventory, so
> it is the only one that gets a notification's colour.

So the same number meant "routine" on one screen and "alarming" on the next, and
a contractor moving from the orders list into a job watched the badge change
colour without anything about the job changing. Neither argument was wrong on its
own; what was wrong was holding both.

Separately, `--danger` is what the app paints destructive actions and errors in —
delete buttons, failed sends, lapsed billing. Spending it on an inbox count that
is non-zero most of the working day both dilutes the signal and leaves nothing
louder in reserve for the cases that genuinely are alarming.

## Decision

Waiting counts use the brand accent. `--danger` stays reserved for destructive
actions and error states.

The pill itself is one shared `.count-badge` in `src/app.css`. Call sites add
only what is genuinely local to their context — the gap against a nav label, the
`flex-shrink: 0` that keeps it from being squeezed in a row — and never restate
the fill, the radius, or the type.

## Consequences

A count that means the same thing looks the same everywhere, and changing how
waiting reads across the whole product is a single edit rather than a hunt
through four files.

The nav badge is less shouty than it was. That is the intended trade: an
unanswered message is the contractor's normal work queue, and the dashboard's
waiting list is the surface that exists to make it actionable.

Because the fill is yellow, the pill's foreground must be `var(--on-yellow)` and
not a token that flips between themes — the trap documented at the top of
`src/app.css` and enforced by `src/lib/theme.contrast.test.ts`.
