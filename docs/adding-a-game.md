# Adding a New Game

> Step-by-step guide for extending LAN Games with a new game module.
> No framework code changes are required — only new files. See
> [Architecture](architecture.md) for how the framework is structured,
> and [Action Descriptors](action-descriptors.md) for the optional
> rich-action interface.

The framework is intentionally game-agnostic. Adding a new game requires three steps:

## 1. Create `server/games/<your-game>/`

```
server/games/my-game/
├── game-logic.js
└── config/
    └── settings.json   (or however many config files you need)
```

## 2. Implement the GameLogic interface

`game-logic.js` must export all **required** methods. See [`server/src/game-logic-interface.js`](../server/src/game-logic-interface.js) for the full JSDoc contract. Verify compliance at load time with `validateImplementation`:

```js
'use strict';

const {
  validateImplementation,
  defaultGetStateForPlayer, // use for perfect-information games; see below
} = require('../../src/game-logic-interface');

// Bump when the GameState shape changes incompatibly (see "State versioning" below).
const STATE_VERSION = 1;

// ... your game logic ...

module.exports = {
  // ── Required ──────────────────────────────────────────────────────
  initGame,            // (gameId, name, players, config) → GameState
  createInitialPlayer, // (user, existingPlayers, config) → PlayerObject
  applyAction,         // (state, userId, action, payload) → ActionResult
  skipTurn,            // (state, userId) → ActionResult
  getCurrentPlayer,    // (state) → { userId, username } | null
  isTurnTimerBlocked,  // (state) → boolean
  getValidActions,     // (state, userId) → string[]
  getGameMetadata,     // () → { name, minPlayers, maxPlayers, description, icon }
  loadConfig,          // () → config object
  getConfigCopy,       // () → deep-cloned config object
  getStateForPlayer,   // (state, userId) → player-specific view — see below

  // ── Optional ──────────────────────────────────────────────────────
  STATE_VERSION,       // number — current state schema version
  migrate,             // (oldState) → newState — see "State versioning" below
};

// Throws if any required method is missing
validateImplementation(module.exports);
```

`initGame` must stamp `stateVersion: STATE_VERSION` on the returned object so the framework can detect future schema drift.

### getStateForPlayer and hidden information

`getStateForPlayer(state, userId)` is called before every socket emission so that each client receives only the information it is allowed to see.  You **must** implement it for every game.

| Game type | What to do |
|-----------|-----------|
| **Perfect information** (Monopoly, Connect Four, Tic-Tac-Toe, Checkers, Yahtzee) — every player sees the whole board | Use `defaultGetStateForPlayer` exported by the interface module |
| **Hidden information** (Battleship, Risk) — players have private board state or private cards | Write a real filter that masks other players' private fields |

```js
// ✓ Perfect-information game — one line, done.
getStateForPlayer: defaultGetStateForPlayer,

// ✓ Hidden-information game — mask every other player's hand.
function getStateForPlayer(state, userId) {
  return {
    ...state,
    players: state.players.map(p =>
      p.userId === userId
        ? p
        : { ...p, hand: p.hand.map(() => 'HIDDEN') }
    ),
  };
}
```

Using `defaultGetStateForPlayer` in a hidden-information game leaks every player's private data to every other player — it is only safe when there is nothing to hide.

### State versioning

Every `GameState` carries a `stateVersion` field.  When you save a game and later change the state schema, previously persisted games may no longer match your new code.  The framework handles this automatically:

1. On load, `game-manager.js` compares `state.stateVersion` to `STATE_VERSION` exported by the game module.
2. If they differ and the module exports `migrate`, `migrate(state)` is called and the result is written back to the database.
3. If they differ and no `migrate` is exported, the framework logs a warning and loads the state as-is.
4. If `migrate` throws, the game is treated as unloadable and `null` is returned to the caller.

**When to bump `STATE_VERSION`:** any time you add, rename, or remove a field that existing saved games rely on (e.g. adding a required field with no default, changing the type of a field, restructuring a nested object).  Pure logic changes that don't touch the shape of state do not require a bump.

**How to write `migrate`:** chain `if (state.stateVersion < N)` blocks, one per version step, each producing a new state object and stamping the next version.  Throw at the end if the version is still not current (guards against states too old to migrate).

```js
function migrate(state) {
  let s = state;

  if (s.stateVersion < 2) {
    // v1 → v2: players gained an `energy` field defaulting to 10.
    s = {
      ...s,
      players:      s.players.map(p => ({ ...p, energy: 10 })),
      stateVersion: 2,
    };
  }

  if (s.stateVersion < 3) {
    // v2 → v3: top-level `deck` array replaced the old `hand` field.
    s = { ...s, deck: s.hand ?? [], stateVersion: 3 };
    delete s.hand;
  }

  if (s.stateVersion !== STATE_VERSION) {
    throw new Error(`No migration path from v${s.stateVersion} to v${STATE_VERSION}`);
  }

  return s;
}
```

**Key contracts:**

| Rule | Detail |
|------|--------|
| Pure functions | No I/O, no global mutation, no side effects |
| Immutable input | Never mutate `state` — always return a **new** object |
| In-band errors | Return `{ state, events: [], error: 'reason' }` instead of throwing |
| JSON-safe | `state` must survive `JSON.stringify` → `JSON.parse` |

### Pending-state shape (optional convention)

The framework doesn't mandate how a game models "the player owes the server a follow-up action" — each game does what fits. Two shapes have emerged across the bundled games:

- **Phase-specific state machinery** (Battleship, Risk, Monopoly) — `turnState.phase` plus per-phase fields encode where the player is in a multi-step turn. Each phase has its own valid action set.
- **Discriminated-union pending field** (Life) — a single `player.pending = { type, options } \| null` field on each player record, where `type` is one of `'fork'`, `'career-draw'`, `'salary-draw'`, etc. The acting player's `getValidActions` switches on `pending.type`.

Pick whichever maps cleanly to your game. Life chose the union because it had four mutually-exclusive pending types (start fork, career draw, salary draw, retirement fork, house draw) that all shared the same "offer N options, player picks one" shape — the union expressed that uniformity. Battleship's phases are more divergent (setup is drag-and-drop, firing is click-to-shoot) so the phase enum carries more weight.

## 3. Register in `game-registry.js`

```js
// server/src/game-registry.js
const registry = {
  monopoly:      require('../games/monopoly/game-logic'),
  'connect-four': require('../games/connect-four/game-logic'),
  'my-game':     require('../games/my-game/game-logic'),  // ← add this line
};
```

That's it. The framework automatically:
- Exposes the game in `GET /api/games/types`
- Adds it to the client's game-type dropdown
- Routes all `game:action` socket events through your `applyAction`
- Saves and resumes game state via SQLite
- Runs the 30-second disconnect / turn-skip timer

## 4. (Optional) Add a client renderer

Create `client/js/games/<your-game>/renderer.js` implementing the `GameRenderer` interface defined in [`client/js/games/renderer-interface.js`](../client/js/games/renderer-interface.js) — at minimum `init`, `update`, and `destroy`. Self-register at the bottom of the file:

```js
GameRendererRegistry.register('your-game', YourGameRenderer);
```

Add one `<script>` tag to `client/index.html`. No `app.js` or `socket-client.js` changes — the framework dispatches to the renderer via the registry based on `state.gameType`.

## 5. (Recommended) Implement `getActionDescriptors`

If your game has dynamic action labels, score previews, or enabled-state logic that depends on game rules (the renderer would otherwise have to mirror server-side rule logic), implement the `getActionDescriptors(state, userId)` method. Five of the eight bundled games (Battleship, Checkers, Risk, Yahtzee, Life) adopt it; only the two trivially-small action surfaces (Connect Four, Tic-Tac-Toe) skip it. See [`action-descriptors.md`](action-descriptors.md) for the contract. The framework attaches the descriptor list to `state.actionDescriptors` on every socket emit when the method is present. Games that don't implement it stay on the simpler `getValidActions` contract.
