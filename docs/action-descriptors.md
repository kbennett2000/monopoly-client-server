# Action descriptor contract — proposal

> **Status:** proposal + skeleton implementation. The contract is wired into
> the framework and implemented for Battleship as proof-of-concept; Yahtzee
> and Risk migrate in follow-up sessions.

## Background

[docs/renderer-contract.md](renderer-contract.md) has tracked an open question
since the Yahtzee session: `getValidActions(state, userId) → string[]` returns
action *identifiers* only, but several renderers need richer per-action
information (dynamic labels, disabled-reason hints, score previews, etc.) to
drive UI without reimplementing rule logic.

The third instance of this pattern surfaced in the Battleship renderer
debrief, which is enough evidence (per the "wait for a third sighting" rule in
the renderer-contract doc) to propose a concrete contract. The three pressure
points:

- **Yahtzee** — every unscored category button needs a dynamic preview score
  ("Score 18 in Three of a Kind"). The renderer currently mirrors the server's
  `scoreFor` function in [client/js/games/yahtzee/score-sheet.js](../client/js/games/yahtzee/score-sheet.js).
- **Risk** — the "Trade cards" button is enabled only when the player's hand
  contains a valid 3-card set. The renderer would need to hand-roll the
  set-detection logic the server uses; today the button is always shown and
  the server rejects invalid attempts.
- **Battleship** — the Ready button's label, enabled state, and the setup
  status line all depend on phase + `me.ready` + placement count. The renderer
  computes this locally in [client/js/games/battleship/setup-phase.js](../client/js/games/battleship/setup-phase.js)
  via a small `if me.ready / else` block.

In every case the renderer is doing rule arithmetic that the server is the
authoritative source for. The mirror code can drift.

## The contract

A new **optional** method on the GameLogic interface:

```js
/**
 * Optional. Returns enriched action descriptors for the named player.
 *
 * Each descriptor describes one action the renderer might surface, including
 * its dynamic label, enabled state, and any data the renderer needs to
 * render the action without reimplementing rule logic.
 *
 * If a game does not implement this method, the framework falls back to
 * getValidActions(state, userId) → string[]. Renderers consuming the
 * descriptor API should check for its presence and degrade gracefully.
 *
 * The renderer is still responsible for visual style — labels are content,
 * not styling. The renderer is also responsible for action dispatch; this
 * method is read-only, it describes actions, it does not perform them.
 *
 * MUST be safe to call on pre-`initGame` waiting-room states (return [] is
 * always acceptable). Matches the convention `getStateForPlayer` follows.
 *
 * @param {GameState} state - Current game state (already filtered for this player)
 * @param {string} userId - The player to describe actions for
 * @returns {ActionDescriptor[]} - Zero or more descriptors
 */
function getActionDescriptors(state, userId) { ... }

/**
 * @typedef {Object} ActionDescriptor
 * @property {string}  action  - The action identifier (matches applyAction dispatch)
 * @property {string}  label   - Human-readable button label or affordance text
 * @property {boolean} enabled - Whether the action can currently be performed
 * @property {string}  [hint]  - Optional tooltip / sublabel / disabled-reason.
 *                                Renderers may use this as a button title
 *                                attribute, as a status-line caption, or
 *                                both — it carries human-readable context
 *                                that explains why the action is enabled/
 *                                disabled or what it will do.
 * @property {object}  [data]  - Optional structured data the renderer needs
 *                                (e.g. score previews, valid targets). Shape
 *                                is game-specific and documented per-game.
 */
```

### Required vs optional fields

- **Required:** `action`, `label`, `enabled`.
- **Optional:** `hint`, `data`.

A renderer that doesn't recognise a `data` shape should ignore it; the
required three fields are enough to render a labeled, enable/disable-aware
button without any game-specific knowledge.

### What `data` is for

`data` is the escape hatch that lets game-specific richness flow through a
generic contract. Each game documents its own shape. Examples:

- **Yahtzee `scoreCategory` descriptor:** `data: { category: 'fullHouse', previewScore: 25 }` — one
  descriptor per unscored category; the renderer reads `previewScore` to
  render the "→ 25" preview next to each row.
- **Risk `tradeCards` descriptor:** `data: { validSets: [['cardA','cardB','cardC']] }` — pre-computed
  valid sets so the renderer can show which combinations are tradeable.
- **Battleship `commitPlacement` descriptor:** `data: { shipsPlaced: 3, shipsRequired: 5 }` —
  derivable from state by the renderer too; including it lets the renderer
  display the progress without re-counting `me.ships.length`.

The `data` field is untyped at the interface level. The cost is that
generic framework code can't introspect it; the benefit is that no game is
constrained by the contract.

### Multiple descriptors per action: when?

A natural question is whether `getActionDescriptors` returns one descriptor
per action *type* (e.g. one `placeShip` descriptor) or one descriptor per
*instance* (e.g. one descriptor per unplaced ship). The answer depends on
what the server can meaningfully say about each instance.

> **Rule of thumb:** descriptors describe what the *server* can tell the
> renderer. They don't enumerate every possible payload the renderer might
> emit. If the server has instance-specific data worth reporting (a preview
> score, a validity check, a label), return one descriptor per instance.
> If the action is "the renderer drives the choice and the server validates
> the payload," return one generic descriptor.

Applied to the three games:

| Action | Shape | Why |
|---|---|---|
| Yahtzee `scoreCategory` | **One per unscored category** | The server can preview each category's score for the current dice — instance-specific data. |
| Risk `tradeCards` | **One descriptor**, `data.validSets` enumerates options | The server can enumerate valid sets, but they're variants of one action with one button. |
| Risk `placeReinforcement` | **One descriptor**, `data.armiesRemaining: 3` | The renderer drives which territory; the server reports how many armies are left to place. |
| Risk `attackTerritory` | **One descriptor**, `enabled` gates the phase | The renderer drives from/to selection; no per-territory descriptors. |
| Battleship `placeShip` | **One descriptor** | The renderer drives the drag; the server validates. No instance enumeration. |
| Battleship `fireShot` | **One descriptor** | Same — renderer drives the cell click. |
| Battleship `commitPlacement` | **One descriptor** | The action itself is enable/disable-binary. |

The Yahtzee `scoreCategory` case is the only "one descriptor per instance"
shape across the three games. That's intentional — Yahtzee's previewable
scores are genuinely instance-specific and the renderer needs them all
displayed simultaneously.

### `commitPlacement` and `uncommitPlacement` as separate descriptors

Battleship's setup has two actions whose UI surfaces in the same button slot
("Ready" / "Unready" / "Waiting for opponent…"). Two ways to model them:

1. One descriptor with the label flipping based on state.
2. Two descriptors (one per action), with `enabled: true` only on whichever
   applies at the moment.

**Choice: two descriptors.** Rationale:

- The server has two distinct actions; the descriptor list should reflect
  the server's action surface, not pre-merge them for the renderer.
- The renderer can still pick the active one ("the descriptor whose
  `enabled === true`") with one line of code; the cost of two descriptors
  is one extra array entry, not extra renderer complexity.
- Future renderers might want to show both buttons in disabled states
  (e.g. for debugging or accessibility). Two descriptors preserves that
  option; one merged descriptor closes it off.

The same argument applies to other action pairs (Risk's `endReinforcePhase`
vs `endAttackPhase` vs `endTurn`): one descriptor per action, the renderer
picks which to surface.

## Examples

### Battleship — setup, no ships placed, not ready

```js
[
  { action: 'placeShip', label: 'Drag a ship onto your grid', enabled: true,
    hint: 'Place your ships — 0 of 5 placed.' },
  { action: 'removeShip', label: 'Pick up a placed ship', enabled: false,
    hint: 'No ships placed yet.' },
  { action: 'commitPlacement', label: 'Ready', enabled: false,
    hint: 'Place all 5 ships first.' },
  { action: 'uncommitPlacement', label: 'Unready', enabled: false,
    hint: "You haven't committed yet." },
]
```

### Battleship — setup, 3 ships placed, not ready

```js
[
  { action: 'placeShip', label: 'Drag a ship onto your grid', enabled: true,
    hint: 'Place your ships — 3 of 5 placed.' },
  { action: 'removeShip', label: 'Pick up a placed ship', enabled: true },
  { action: 'commitPlacement', label: 'Ready', enabled: false,
    hint: 'Place all 5 ships first (2 remaining).' },
  { action: 'uncommitPlacement', label: 'Unready', enabled: false,
    hint: "You haven't committed yet." },
]
```

### Battleship — setup, all 5 placed, not ready

```js
[
  { action: 'placeShip', label: 'Drag a ship onto your grid', enabled: true,
    hint: 'All 5 placed — click Ready when you\'re set.' },
  { action: 'removeShip', label: 'Pick up a placed ship', enabled: true },
  { action: 'commitPlacement', label: 'Ready', enabled: true,
    hint: 'Click to commit your placement.' },
  { action: 'uncommitPlacement', label: 'Unready', enabled: false,
    hint: "You haven't committed yet." },
]
```

### Battleship — setup, ready, opponent not ready

```js
[
  { action: 'placeShip', label: 'Drag a ship onto your grid', enabled: false,
    hint: "You've committed — un-ready to rearrange." },
  { action: 'removeShip', label: 'Pick up a placed ship', enabled: false,
    hint: "You've committed — un-ready to rearrange." },
  { action: 'commitPlacement', label: 'Ready', enabled: false,
    hint: 'Already committed.' },
  { action: 'uncommitPlacement', label: 'Unready', enabled: true,
    hint: 'Take back your commitment.' },
]
```

### Battleship — firing, my turn

```js
[
  { action: 'fireShot', label: 'Fire at the opponent\'s waters', enabled: true,
    hint: 'Click an unshot cell.' },
]
```

### Battleship — firing, opponent's turn

```js
[
  { action: 'fireShot', label: 'Fire at the opponent\'s waters', enabled: false,
    hint: "Opponent's turn." },
]
```

## Framework integration

`state.actionDescriptors` is attached by the same wrapper in
[socket-handler.js](../server/src/socket-handler.js) that already attaches
`state.validActions`. The shape mirrors the existing pattern:

```js
function filteredFor(state, userId) {
  if (!state) return state;
  const view = filterStateForUser(state, userId, gameRegistry);
  const logic = gameRegistry.getGameLogic(state.gameType);
  if (userId && typeof logic.getValidActions === 'function') {
    view.validActions = logic.getValidActions(view, userId);
  }
  if (userId && typeof logic.getActionDescriptors === 'function') {
    view.actionDescriptors = logic.getActionDescriptors(view, userId);
  }
  return view;
}
```

Three behaviours fall out of this:

- **Game implements both:** the view carries both `validActions` and
  `actionDescriptors`. Renderers consuming descriptors use those; the
  `validActions` array stays as a safety-net for code that hasn't migrated.
- **Game implements only `getValidActions`:** view carries only
  `validActions`. Renderers checking for `actionDescriptors` see undefined
  and degrade to the older API.
- **Game implements only `getActionDescriptors`:** view carries only
  `actionDescriptors`. Not the intended shape — every game has
  `getValidActions` because it's required — but the framework handles it
  gracefully.

REST routes deliberately don't attach either field (matches the existing
pattern; the rejoin client computes its own action set from state). The
descriptor attachment is a socket-only convenience.

## Migration plan

1. Add `getActionDescriptors` to the interface JSDoc; add to `OPTIONAL_METHODS`
   in `validateImplementation` (no enforcement — required absence is fine).
2. Update `filteredFor` to attach `actionDescriptors` when implemented.
3. Implement `getActionDescriptors` for Battleship. Update Battleship's
   renderer to consume it.
4. Implement for Risk. Update Risk's renderer.
5. Implement for Yahtzee. Update Yahtzee's renderer.

**Steps 1–3 are this session.** Steps 4 and 5 land in separate sessions —
each game's migration is small enough to fit one focused commit and large
enough that bundling two would muddy the diff.

Connect Four and Tic-Tac-Toe deliberately don't migrate. Their action
surfaces are trivial enough (`dropPiece`, `markCell`) that
`getValidActions` covers them; the descriptor contract would be ceremony
without payoff. If they ever need richer affordances, they can implement
the optional method then.

## Open questions

The proposal deliberately leaves these unresolved. Future sessions
should address them only when forced by concrete pressure, not
speculatively.

- **Should `validateImplementation` eventually require `getActionDescriptors`?**
  Probably not — Connect Four and Tic-Tac-Toe don't benefit and forcing
  them to implement a no-op method adds noise. Revisit if and when every
  game ends up with one anyway.
- **Should the framework provide a default implementation that wraps
  `getValidActions`?** E.g. `getValidActions().map(a => ({ action: a, label: a, enabled: true }))`.
  Probably not — the defaults would be wrong (raw action ids as labels) and
  using the default would hide the fact that the game hasn't really opted
  in. Better to leave `actionDescriptors` undefined than to fake it.
- **How does this interact with future server-driven UI hints?** (Animation
  cues, tooltip prompts, voice-over text, accessibility metadata.) The
  `hint` field is already a half-step toward this; if the pattern grows,
  `hint` may eventually be a structured object rather than a string. Open
  question for the day that pressure materialises.
- **Should `data` be schema-validated per game?** Each game's
  `getActionDescriptors` documents its own `data` shape; the framework
  itself is shape-agnostic. If schema drift between server-side production
  and client-side consumption becomes a real source of bugs, a per-game
  TypeScript interface or JSDoc typedef would help. Not pressing today.

## What this doesn't change

The descriptor is *data* about actions, not a description of UI. The
renderer remains responsible for:

- **Visual styling** — colours, button shapes, hover treatments. Descriptors
  carry text; the renderer styles it.
- **Action dispatch** — `emitAction(action, payload)` still flows through
  the existing socket pipeline. The descriptor describes *that* an action
  is available; the renderer's click handler decides *when* to send it
  and *what* payload to attach.
- **Layout and grouping** — where buttons go, which descriptors get
  grouped together, what's a button vs. a hover affordance. The descriptor
  list is unordered.
- **Visual gating** — disabling a button that the descriptor says is
  enabled (e.g. while a network request is in flight) is fine; the
  descriptor is the server's view of what's allowed, not the only
  constraint the renderer is allowed to apply.

## Status text and the `hint` field

A specific case worth flagging because it came up while implementing
Battleship's descriptors:

Setup phase has both a button (Ready) and a status line ("Place your
ships — 3 of 5 placed.") The status line's content tracks the same
information the button's hint does. Two reasonable shapes:

1. **Renderer derives status text from the active descriptor's `hint`.**
   The hint serves double duty: button tooltip *and* status text.
2. **Renderer derives status text independently from state.** Descriptor's
   hint stays purely about the button.

**Choice for Battleship: (1).** The status text and the button's
disabled-reason hint are the same kind of information ("here's what's
going on with this action right now"); one source is simpler. The
renderer pulls `commitPlacement.hint` (or `uncommitPlacement.hint` when
that's the active one) into the status line *and* uses it as the
button's tooltip.

This shape may not generalise — Yahtzee and Risk might want richer status
text that doesn't fit a single descriptor's hint. Each game's renderer
makes the call locally.

## Migration status (complete)

All three planned migrations have shipped without contract revisions:

- **Battleship** (commit `2d0c78e`) — skeleton implementation alongside
  the initial proposal. Established the per-action-type descriptor
  pattern with phase-state-rich `data` fields (e.g.
  `commitPlacement.data: { shipsPlaced, shipsRequired }`).
- **Risk** (commit `7e7745b`) — first player-visible upgrade: the
  Trade cards button now always appears in the reinforce phase with
  a disabled state and a rule-hint tooltip when no valid set exists.
  Introduced the `data.validSets: [[cardId, cardId, cardId]]` shape
  carrying multiple action *instances* inside a single descriptor.
  Also removed the drift-prone client-side `hasAnyValidCardSet`
  mirror and an older `validActions`-drift-detection helper.
- **Yahtzee** (commit `6bd1f2e`) — largest LOC change; deleted the
  ~58-line `scoreFor` mirror in `client/js/games/yahtzee/score-sheet.js`.
  Established the *many descriptors per action type* pattern (13
  `scoreCategory` descriptors at the start of a turn, discriminated
  by `data.category`).

### Patterns that emerged

A few patterns the three migrations established. Future descriptor
implementations should follow them:

- **Lookup helpers.** When a game emits multiple descriptors of the
  same action type, the renderer uses
  `state.actionDescriptors.find(d => d.action === X && d.data.Y === Z)`
  rather than `.find(d => d.action === X)`. A small
  `findFooDescriptor` helper at the top of the renderer module is
  the conventional shape — see `findScoreDescriptor` in
  `client/js/games/yahtzee/score-sheet.js` for an example.

- **Renderer-side label augmentation is fine.** Yahtzee's `rollDice`
  descriptor returns `"Roll 2 of 3"` but the renderer appends
  `" — N held"` from local DOM state. The boundary: rule logic
  lives in descriptors; pre-commit user-intent state stays in the
  renderer. The contract doesn't try to push pre-commit state into
  the descriptor — there's no way for the server to know it.

- **Descriptor absence is meaningful.** Descriptors are emitted for
  actions that are currently relevant. Game-over states emit zero
  descriptors; opponent's-turn states emit zero descriptors;
  Yahtzee's pre-roll state emits only `rollDice` and zero
  `scoreCategory`. The renderer's "no descriptor" rendering path
  (showing static status text like "Waiting for X…", or rendering
  unscored cells as `'—'`) is normal, not a fallback.

- **No defensive fallback to local rule computation.** If the server
  doesn't emit a descriptor — or descriptors are absent for any
  reason — the renderer renders without that affordance, full stop.
  The renderer does NOT reimplement the server's logic as backup.
  Two copies of authoritative logic was the bug we set out to fix;
  "two copies but one is a fallback" is the same bug with a slower
  drift cycle.

### Things this did not become

The proposal listed several open questions (whether
`validateImplementation` should eventually require descriptors,
whether the framework should provide a default implementation that
wraps `getValidActions`, whether `data` should be schema-validated
per game). After three migrations, the answer to all of them remains
"no, and the lack hasn't bitten us."

Connect Four and Tic-Tac-Toe deliberately don't implement
`getActionDescriptors`; their action set is small enough that
`getValidActions` covers it cleanly. This is the contract working —
games that benefit adopt it, games that don't, don't, and there is
no central registry forcing the choice either way.

## Do not refactor based on this note

This is a proposal + skeleton. The full migration happens in the
follow-up sessions; this document is the spec those sessions execute
against.
