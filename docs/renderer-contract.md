# Renderer / framework DOM contract — open questions

> **Status:** memory aid, not a design doc. Written before Tic-Tac-Toe and
> before any non-board game (Yahtzee, Liar's Dice) is implemented. The
> decision below gets made *while writing the first non-board game*, not
> speculatively now.

## What the contract is today

Layout of the game screen (in [client/index.html](../client/index.html)):

```
┌────────────────────────────────────────┬──────────────────────────┐
│                                        │  PLAYERS panel           │
│         .board-wrapper                 │  Action title + buttons  │
│         (renderer-owned)               │  Auction panel (Monopoly)│
│                                        │  GAME LOG                │
│                                        │  CHAT                    │
└────────────────────────────────────────┴──────────────────────────┘
```

### Renderer owns

- **All DOM inside `.board-wrapper`.** Created in `init(container, …)`,
  removed in `destroy()`. The framework empties the wrapper between
  renderer swaps as a safety net.
- **`#action-buttons` and `#action-title`** — the active player's controls.
  Mechanism: the renderer's `update(state)` rebuilds them every tick.
- **Game-specific event reactions in `onEvent(event, state)`** — sound,
  flash animations, log entries beyond the framework's defaults.

See [client/js/games/renderer-interface.js](../client/js/games/renderer-interface.js)
for the full interface and lifecycle.

### Framework owns

- `#players-panel` — player list, colour swatches, status badges.
- `#game-turn-indicator` — whose turn it is.
- `#chat-panel` — chat input + message stream.
- `#game-log` — log entries for generic events.
- `#game-over-modal` — shown on `status === 'finished'`.

Framework code that touches these lives in
[client/js/ui-manager.js](../client/js/ui-manager.js) and
[client/js/socket-client.js](../client/js/socket-client.js).

## What's currently ambiguous

`ui-manager.js` is doing **game-aware rendering outside `.board-wrapper`**:

| Function | What it does | Monopoly-specific? |
|---|---|---|
| `updateActionPanel` | Builds the action buttons | Yes — knows about `rollDice`, `payJailFine`, `buyProperty`, the auction panel, etc. |
| `showPropertyModal` | Detail view for one property | Yes — entire Monopoly concept |
| `showMyPropertiesModal` | Player's owned properties | Yes |
| `openTrade` / `closeTrade` | Trade offer modal | Yes |
| `showIncomingTrade` | Incoming trade prompt | Yes |
| The auction sub-panel | Bidding UI | Yes |
| `updatePlayerPanels` | Sidebar player cards | Mostly framework; touches `money`, `isBankrupt`, jail status. |

The question is: are these "framework chrome that happens to know about
Monopoly", or are they "renderer leaks that should be inside the Monopoly
renderer"?

Today the Monopoly renderer treats UIManager as a Monopoly toolkit and
calls into it; the Risk renderer ignores UIManager entirely and does its
own action-panel work. Connect Four uses a small subset. So the seam is
already drawn — informally — between "Monopoly-specific UI primitives
that live in the framework directory" and "everything else."

That's fine while only Monopoly needs modals, but it pushes a forcing
function in front of every new game: either reuse the Monopoly modals
(and inherit their styling, their button classes, their assumptions about
money/properties), or skip them and rebuild from scratch.

## The open question for the next non-board game

Yahtzee has a **score sheet** — a wide tabular UI per player, persistent
through the whole game, not a board. Liar's Dice has a **hidden-dice
display** — each player's own five dice are visible only to them.

Neither fits cleanly inside the current `.board-wrapper` box.

Three plausible places to put them:

### (a) Inside `.board-wrapper`

The renderer crams everything (score sheet + dice-roll area + action
controls) into the single existing container. Simplest, requires zero
framework changes. Risk for Yahtzee specifically: the score sheet wants
to be tall and tabular, the action area wants to be compact and at the
bottom — packing both into one box gets visually awkward, especially on
narrow viewports.

### (b) A second framework-owned region the renderer can populate

Introduce something like `.secondary-board-area` that the framework owns
the existence of but the renderer fills. Two slots, both managed by the
renderer, with the framework guaranteeing layout. More invasive — every
game needs to know whether it's a one-slot or two-slot game — but gives
games like Yahtzee a natural home.

### (c) Renderer-owned overlay; framework makes space

The renderer adds DOM outside `.board-wrapper` (e.g. a popover dice tray
that floats over the sidebar). Framework just promises not to layer over
it. Most flexible, least structured. Probably the answer for ephemeral
displays (dice mid-roll) but wrong for persistent state (Yahtzee's score
sheet, which is the *primary* game interface).

## When this gets decided

When Yahtzee or Liar's Dice (whichever is first) is being written. The
implementer will hit the seam organically — they'll try to fit a score
sheet into the current model and feel where it tears. Decide then, with
concrete pressure, not now in the abstract.

The harder question — whether `ui-manager.js`'s Monopoly-specific
helpers should move into `client/js/games/monopoly/ui/` — is a separate
refactor with a separate trigger (when a second game wants modals).
Don't bundle that with the layout question.

## Open question: action label contract

> **Status (resolved by proposal — migration in progress):** This question
> is now being answered by the optional `getActionDescriptors` contract
> proposed in [docs/action-descriptors.md](action-descriptors.md). The
> framework wiring and Battleship implementation landed in the skeleton
> commit; Yahtzee and Risk migrations land in separate sessions. The
> original framing below is preserved as historical context — it documents
> how the problem looked before the proposal, which is useful for
> understanding why the proposal took the shape it did.

Yahtzee surfaced the first real instance of a renderer needing
human-readable labels for actions returned by `getValidActions`.

**Current state:** actions are identifier strings — `'rollDice'`,
`'scoreCategory'`, `'placeReinforcement'`. The renderer owns the
translation to UI labels and decides which subset to surface as enabled
buttons. Works fine for static labels.

**The Yahtzee instance** that makes it interesting: a category button like
"Score 18 in Three of a Kind" is *dynamic* — the number depends on the
current dice. There's no static-string map from `'scoreCategory'` to a
label; the label is a function of state. The renderer ends up calling
back into Yahtzee's `scoreFor(category, dice, config)` to compute the
preview number. That works, but it means the renderer is doing rule
arithmetic — exactly the seam the renderer / game-logic split was meant
to enforce.

Two plausible future seams:

- **`describeAction(state, action, userId) → string`** as an optional
  interface method. Game-logic owns the label string; renderer just
  displays it. Cleanest but introduces another method to the contract
  and another thing every game has to opt into or skip.
- **Richer `getValidActions` return** — `{ action, label, enabled }[]`
  instead of `string[]`. Bundles "which actions" and "what they look
  like" in one trip. Backwards-incompatible to current consumers; would
  need a parallel migration path.

**Explicit non-decision:** not solving this until Liar's Dice and Coup
land. One game's worth of pressure isn't enough to pick a shape; both
of those will have their own opinions about action labels (bids in
Liar's Dice are inherently numeric and stateful; Coup's actions are
named cards). Decide once we have three data points, not one.

## Resolved: derived view fields stay client-side

Came up in session 1 while building Yahtzee: the temptation to push
`upperSubtotal`, `lowerTotal`, `grandTotal` onto the wire as a
"convenience" so the renderer doesn't have to recompute them.

**Decision: no.** Derived fields belong in the renderer, not the server.

Reasoning:

- The seam between game-logic and renderer is *rule logic* (which
  lives server-side where it's testable) vs *display logic* (which
  lives client-side). Upper-section subtotal is arithmetic over
  `scoreSheet` values — pure presentation, no rule is being duplicated.
- Adding derived fields to the wire format introduces a "derived field
  decorator" interface extension that would feel general but wouldn't
  pay rent. Every game would then have to declare what to derive, and
  every renderer would still have to display it, and the framework
  would acquire a third concept (state + decorators + UI) where two
  cover the actual need.
- The wire format stays minimal. Risk's continent bonuses (the
  obvious comparable case) are already computed client-side from
  `state.territories` and `state.config.board.continents` — same
  pattern, already established.

`finalizeGame` does compute totals server-side, but only because they're
needed for winner determination and the `GAME_OVER` event payload — a
genuine rule decision, not display sugar. Renderers asking for them
mid-game compute their own.

## Open question: game-over modal richness

Yahtzee session 2 surfaced the second instance of a framework display
surface that loses game-specific richness when the renderer tries to use
it. The framework's modal API is `UIManager.showGameOver(winnerName)` —
it takes a single string and renders "🎉 {name} wins!" or "🤝 It's a
draw!". That works for two-player games with one winner.

**The Yahtzee instance:** ties produce a shared-winner array of userIds,
and the final scores (each player's grandTotal, upper subtotal, bonus
status) are interesting enough that players want to see them in the
game-over moment. The current API can't express either.

**The workaround in v1:** the renderer's `onEvent('GAME_OVER')` writes
the rich version (`🤝 Tie! Alice & Bob all win`) via
`UIManager.appendLog` and accepts that the modal itself shows just the
first winner's name. The log entry survives long enough to read; the
modal is functionally correct (someone did win, the modal does say so).

**Plausible future shapes:**

- **`describeGameOver(state) → string`** as an optional game-logic
  method, parallel to the action-label candidates below. Modal calls it
  if present, falls back to the current single-winner string otherwise.
- **Richer `GAME_OVER` event payload** that the framework's modal handler
  knows how to read (`{ title, body, winners[] }`).
- **Renderer-supplied modal content hook** — the renderer's
  `onEvent('GAME_OVER')` returns a string or DOM fragment that the
  framework injects into the modal before showing it.

Don't pick yet. See the cohering-pattern note below.

## Cohering pattern: framework chrome with renderer-supplied display content

The "action label contract" and "game-over modal richness" notes above
are instances of the same shape:

|                          | Framework offers                          | Renderer wants                                         |
|--------------------------|-------------------------------------------|--------------------------------------------------------|
| **Action buttons**       | `getValidActions(state, userId) → string[]` | `{ action, label, enabled }[]` with dynamic labels    |
| **Game-over modal**      | `showGameOver(winnerName: string)`        | Rich text — tie summary, final scores, per-player breakdown |

Both fit this template:

> The framework owns a UI surface that exposes a scalar/thin contract.
> The renderer needs to inject game-specific structured display content
> through that surface. The renderer works around the gap by maintaining
> a parallel channel — its own label map for action buttons; a log entry
> instead of (or alongside) the modal.

If extracted, the obvious shape is an optional hook that returns display
text given context — `describeAction(state, action, userId) → string`
for the action side, `describeGameOver(state) → string | object` for the
modal side. Same pattern, two sites.

**Hold off until a third instance.** Two is enough to notice; three is
enough to know the shape. The natural candidates for a third sighting:

- **Liar's Dice** will exercise the action-label side hard — bids are
  numeric, stateful, and contested ("raise to 4×5s"). If the same
  hook-returning-a-string shape works for bids, that's three.
- **Some future card game** (Coup, Love Letter) may exercise the modal
  side with a "knocked out" or "reveal" moment that the current
  one-string modal can't carry.
- **Or a different framework surface entirely loses richness** — the
  turn indicator (currently "{name}'s turn"), player-panel badges
  (currently a static `JAIL` / `OUT` / `AFK` triad), the game log entry
  formatter. Any of those could become the third instance and shift the
  shape away from "describe-X-returns-string" toward something else.

Wait for the third sighting; don't extract from two. The action-label
note above already says this explicitly for its own case — this section
just acknowledges that the same caution applies across multiple notes
because they're the same underlying pattern.

**Two-instance pattern, waiting for a third before extraction.**

## Open question: simultaneous-actors gap

Battleship session 1 surfaced the first instance: the framework's
`getCurrentPlayer` model assumes a single player is "active" at any
moment. Fine for turn-based phases; less clean for phases where multiple
players act in parallel. Battleship's setup phase is the canonical
example — both players place ships simultaneously, neither is the
current player, and the phase transitions to firing on a barrier (both
ready) rather than via a turn.

The current workaround:

- `getCurrentPlayer` returns `null` during setup. Framework consumers
  in `socket-handler.js` already handle null gracefully (`cur?.userId`,
  `!cur` short-circuits).
- `isTurnTimerBlocked` returns `true` during setup so the 30-second
  auto-skip doesn't fire on either player.
- Each setup action validates "is this player allowed to act right now"
  inline (phase check + ready check + per-action specifics), rather than
  relying on a single framework-level current-player gate.

That works, but the validation is hand-rolled per action.

**The natural second instance:** Coup's role-assignment phase, when it
lands. Every player simultaneously receives two private role cards;
the same null-current-player / barrier-transition / per-action
validation pattern will apply.

**Don't extract from one instance.** A future second sighting (Coup,
Love Letter, any game with simultaneous private setup) would tell us
whether the right shape is e.g. `getActivePlayers(state) → userId[]`
(defaulting to `[getCurrentPlayer(state).userId]` for turn-based games)
or something else entirely. One instance plus a future hypothetical
isn't enough.

## Do not refactor based on this note

Pure capture. Nothing in this document is a green light to move code.
