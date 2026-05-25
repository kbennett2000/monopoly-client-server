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

## Do not refactor based on this note

Pure capture. Nothing in this document is a green light to move code.
