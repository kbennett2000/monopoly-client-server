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

- `#players-panel` — roster card chrome (colour swatch, username + token,
  AFK badge, active-turn highlight, `.bankrupt`/dimmed styling). The
  game-specific contents of each card (money/cash, status badges,
  subtext) flow in via the optional `getPlayerCardData(player, state)`
  renderer hook. See the "Resolved" section below.
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

> **Status (resolved — implementation complete):** This question is
> answered by the optional `getActionDescriptors` contract in
> [docs/action-descriptors.md](action-descriptors.md). All three
> pressuring games (Battleship, Risk, Yahtzee) have migrated to consume
> descriptors; the action-label arithmetic mirrors in their renderers
> are gone. See the design doc's "Migration status" section for the
> commit history and the patterns that emerged. The original framing
> below is preserved as historical context — it documents how the
> problem looked before the proposal, which is useful for understanding
> why the proposal took the shape it did.

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

## Resolved: spectator mode and the `isSpectator` init flag

Spectator mode added a non-player viewer concept. The framework had no
distinction between players and spectators before this session; the
addition pressured the renderer interface in one specific place:
`init(container, state, myUserId, emitAction)`.

**Resolution.** A fifth optional parameter — an `options` object — was
added to `init`:

```js
renderer.init(container, state, myUserId, emitAction, { isSpectator: false })
```

Renderers MUST honor `options.isSpectator`:

- Skip click handlers that would call `emitAction` for a game action.
- Hide any "your turn" affordances (the spectator has no turn).
- Render the board as read-only — no drag-and-drop, no cell hover that
  implies interactability.

Two implementation patterns emerged across the seven renderers:

| Pattern | Used by | Mechanic |
|---|---|---|
| Explicit gate in each click handler | Tic-Tac-Toe, Connect Four, Yahtzee | `if (_isSpectator) return;` at the top of each click handler; also gate `canHold` / `cell.disabled` derivations. |
| Wrapped `_emit` + `pointer-events: none` | Battleship, Risk, Life | Wrap `emitAction` so it's a no-op for spectators; set `wrapper.style.pointerEvents = 'none'` so visual interactions never fire. Sub-modules need no changes. |
| Implicit gate (framework hides the surface) | Monopoly | All action buttons live inside `#action-section` which `UIManager.applySpectatorChrome` hides; modal `canManage` gates fail when the viewer isn't in `state.players`. The renderer adds the plumbing for symmetry but no new click gates were required. |

The right pattern depends on how a renderer's interactive surfaces are
structured — single-purpose cell clicks call for explicit gates; multi-
sub-module renderers benefit from the wrapped-emit approach. There's no
contract opinion on which to use; both produce correct behavior.

**Server-side gate is the security boundary.** The client-side gates are
UX only — a spectator's click shouldn't appear to do anything. The
server's `socket-handler.js` rejects any `game:action` originating from a
registered spectator with a `game:error`. A spectator with a manipulated
client cannot affect game state.

**State filter bypass.** Spectators receive *unfiltered* state — the
opposite of every other recipient. The bypass lives in `filteredFor`
(socket-handler.js) and is keyed on the runtime `gameSpectators` map.
See `docs/state-emission-audit.md` for the addendum tracking this change.

## Resolved: getPlayerCardData hook (player roster cards)

The third instance of the "framework chrome with renderer-supplied
display content" cohering pattern resolved by extracting an optional
renderer-side hook.

Pre-refactor, `ui-manager.updatePlayerPanels` had five `state.gameType
=== 'monopoly'` gates plus direct reads of game-specific player fields
(`player.money`, `player.cash`, `player.inJail`, `player.isBankrupt`,
`player.jailCards`, `player.retired`) plus a fallback chain (`money ??
cash ?? null`) trying to unify Monopoly's and Life's naming. The
framework was accumulating game knowledge in a place that's supposed
to be game-agnostic.

**Extraction shape.** Each renderer optionally implements:

```js
getPlayerCardData(player, state) → {
  primaryValue?: string,    // headline number, e.g. "$1500"
  badges?: PlayerBadge[],   // status pills like JAIL / OUT / RETIRED
  subtext?: string,         // secondary line, e.g. "5 properties · 1 jail card"
  dimmed?: boolean,         // apply the `.bankrupt` dimmed visual
}
```

The framework owns the visual treatment (color dot, username, AFK
badge, active-turn highlight) and consumes whatever the hook returns
for the in-card game-specific content. Default fallback is
`{ primaryValue: '', badges: [], subtext: '', dimmed: false }` — the
right shape for games whose roster card has no game-specific content
(Tic-Tac-Toe, Connect Four, Yahtzee, Battleship, Risk).

Migrated: Monopoly, Life. The other five games degrade to the default.

**Why not unify with action descriptors?** The two hooks return
fundamentally different shapes — descriptors are per-action and carry
action-specific `data`; player-card data is per-player and carries
display content. A unified "describe-X" hook would over-generalize.
Each surface gets the contract that fits it locally.

**Companion cleanup.** The Monopoly-only sidebar 2d6 pip display
(`#dice-display` with pip-slot children) also moved into the Monopoly
renderer in the same session. ui-manager.updateTurnIndicator no longer
gates on `gameType === 'monopoly'`; the dice element stays hidden by
default and Monopoly's `update()` toggles its visibility.

**Out of scope:** the Monopoly trade/property/auction modals still live
in ui-manager.js (they're complete Monopoly UIs, not framework chrome —
moving them is a larger surgery). The remaining `isMonopoly` gates in
ui-manager.js cluster around `updateActionPanel`, `showPropertyModal`,
`showMyPropertiesModal`, and `showTradeModal` — all functions that are
either entirely Monopoly-specific or operate on Monopoly's auction
panel. Acceptable for now; document if a non-Monopoly game ever wants
to repaint any of those surfaces.

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
were instances of the same shape:

|                          | Framework offers                          | Renderer wants                                         |
|--------------------------|-------------------------------------------|--------------------------------------------------------|
| **Action buttons**       | `getValidActions(state, userId) → string[]` | `{ action, label, enabled }[]` with dynamic labels    |
| **Game-over modal**      | `showGameOver(winnerName: string)`        | Rich text — tie summary, final scores, per-player breakdown |
| **Player roster cards**  | Hard-coded `JAIL / OUT / AFK` triad + `isMonopoly` gates for money/cash | Per-game money, badges, subtext, dimmed-state |

The pattern:

> The framework owns a UI surface that exposes a scalar/thin contract.
> The renderer needs to inject game-specific structured display content
> through that surface. The renderer works around the gap by maintaining
> a parallel channel — its own label map for action buttons; a log entry
> instead of (or alongside) the modal; an `isMonopoly` gate inside the
> framework for the player card.

The third instance arrived from the player-card direction predicted in
the bullet list below. With three sightings the shape is settled and the
extraction has happened — see "Resolved: getPlayerCardData hook" below.

**Action-label and game-over-modal extractions still wait.** Two of the
three instances were resolved differently:

- The **action-label** instance got its own dedicated contract —
  [docs/action-descriptors.md](action-descriptors.md). Implemented across
  four of seven games. Same pattern as `getPlayerCardData` (optional
  renderer hook returning structured display data), but each contract
  carries game-specific fields rather than being unified into a single
  abstract "describe-X" hook.
- The **game-over modal** instance hasn't been extracted yet. The
  pressure isn't strong enough — current renderers append rich game-over
  text to the log and let the modal stay a one-string element. Revisit
  if a future game needs richer modal content.

Each instance got the shape that fit it locally rather than a unified
"describe-X-returns-string" generic hook. The cohering pattern was
real (three sightings of "framework surface needs game-specific
content"); the resolution wasn't to write one generic hook but to write
focused hooks per surface.

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

## Life's contributions

The Game of Life shipped across four sessions and surfaced two patterns
worth recording. Neither warrants extraction yet — see notes below.

### Retired-but-still-in-game (single instance)

A player whose `retired === true` is skipped in turn rotation but stays
in `state.players`; the game ends only when every player is retired.
Implemented entirely game-locally: `getCurrentPlayer` returns `null`
when the current index lands on a retired player, and Life's
`advanceTurn` skips past retired players when rotating. The framework's
turn-timer and disconnect handling absorbed the `null` gracefully — no
framework code changed for this pattern.

This sits next to the simultaneous-actors gap and feels related, but
the two are structurally distinct:

|                                | Simultaneous-actors                       | Retired-but-still-in-game             |
|--------------------------------|-------------------------------------------|---------------------------------------|
| Who is the current player?     | Nobody — multiple players act in parallel | Exactly one — but some never can be  |
| Concrete instance              | Battleship setup phase                    | Life's CA/ME retirement               |
| Hypothetical extraction shape  | `getActivePlayers(state) → userId[]`      | `isPlayerSkippable(player) → boolean` |

Both feel like "the single-current-player model is too narrow," but
the abstractions that would fix them point in different directions —
parallel actors vs. graceful exit. The simultaneous-actors counter
stays at two instances (Battleship, hypothetical Coup). Life's retired
pattern stands alone for now. Watch for a second "graceful exit" sighting
(a future game with player elimination that keeps the eliminated player
present, perhaps as a kingmaker observer) before considering extraction.

### Deferred-resolution game-over (first instance)

Millionaire Estates retirees in Life have their win/loss status deferred
until every player has retired. At that moment, ME retirees compete on
cash; the highest-cash ME retiree wins outright and the others score
zero. A player can retire to ME on turn 12 and not learn whether they
won until turn 30.

This is the first time in the framework that a player's eventual
outcome is undetermined for an extended period. Battleship, Yahtzee,
Risk, and Connect Four all resolve game-over incrementally — at the
moment the last ship sinks, the last category is scored, the last
territory is captured, or the four-in-a-row is detected, the result is
known. Life's ME mechanic introduces a "pending judgment" model where
final outcomes are knowable only at terminal game state.

Implementation-wise this absorbed cleanly: `finalizeGame` computes the
zero-out of ME losers at the moment the last player retires, and the
`GAME_OVER` event carries the full `finalScores` map. The renderer's
reveal animation reads from the event payload — no mid-game prediction.

The renderer surfaces the deferred-judgment model to the player when
they pick ME: a confirmation prompt notes "outcome decided at game
over." Without that hint, the model is genuinely surprising — players
expect "I retired with the most cash, I won" to resolve immediately.

One instance is too few to extract a pattern. Watch for a second: a
future game with a hidden-victory-condition card revealed at game end,
or a betting mechanic that resolves at game over rather than
incrementally, would be the same shape.

## Do not refactor based on this note

Pure capture. Nothing in this document is a green light to move code.
