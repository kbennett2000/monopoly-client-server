# Architecture

> Technical architecture of the LAN Games platform: component layout,
> data flow, database schema, and the common GameState shape. To add
> your own game to this architecture, see
> [Adding a New Game](adding-a-game.md). Back to [README](../README.md).

## Component overview

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (Client)                    │
│  api.js ──── REST calls ────────────────────────────┐   │
│  socket-client.js ── Socket.io ──────────────────┐  │   │
│  games/<type>/renderer.js (via renderer-registry)│  │   │
│  ui-manager.js · app.js · game-state.js          │  │   │
└──────────────────────────────────────────────────┼──┼───┘
                                                   │  │
                         WebSocket (Socket.io)     │  │  HTTP REST
                                                   ▼  ▼
┌─────────────────────────────────────────────────────────┐
│                    Node.js Server                       │
│                                                         │
│  socket-handler.js                                      │
│    └── game-manager.applyAction()                       │
│           └── game-registry.getGameLogic(gameType)      │
│                  └── game-logic.applyAction()  ◄──────  │
│                        (pure function)                  │
│                                                         │
│  game-manager.js ──── persist ───► database.js (SQLite) │
│  auth.js (bcrypt + JWT)                                 │
│  routes/ (Express REST)                                 │
└─────────────────────────────────────────────────────────┘
```

## Data flow for a game action

```
1. Player clicks a button
      ↓
2. socket-client.js emits:  game:action  { action: 'rollDice' }
      ↓
3. socket-handler.js receives the event
      ↓
4. game-manager.applyAction(gameId, userId, 'rollDice', payload)
      ↓
5. game-registry.getGameLogic(state.gameType)  →  returns the correct module
      ↓
6. gameLogic.applyAction(state, userId, 'rollDice', payload)
      →  returns { state: newState, events: [...] }   (pure, no side effects)
      ↓
7. game-manager stores newState in memory + SQLite
      ↓
8. socket-handler broadcasts to the game room:
      io.to(gameId).emit('game:update', { state: newState, events })
      ↓
9. Every client's socket-client.js receives game:update
      ↓
10. UI updates: board, player panels, action buttons, game log, sounds
```

## Database schema

```sql
users (
  id            TEXT PRIMARY KEY,   -- UUID
  username      TEXT UNIQUE,
  password_hash TEXT,               -- bcrypt, 12 rounds
  created_at    INTEGER             -- Unix ms
)

games (
  id          TEXT PRIMARY KEY,     -- UUID
  name        TEXT,
  game_type   TEXT DEFAULT 'monopoly',
  status      TEXT,                 -- waiting | playing | paused | finished
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER,
  updated_at  INTEGER,
  state       TEXT,                 -- JSON-serialised GameState
  config      TEXT                  -- JSON-serialised config (snapshot at game start)
)

game_players (
  game_id   TEXT REFERENCES games(id) ON DELETE CASCADE,
  user_id   TEXT REFERENCES users(id),
  joined_at INTEGER,
  PRIMARY KEY (game_id, user_id)
)
```

## GameState shape (common fields)

Every game state object carries these top-level fields, regardless of game type:

```js
{
  id:         string,         // UUID — matches games.id
  name:       string,         // human-readable game name
  gameType:   string,         // 'monopoly' | 'connect-four' | …
  createdBy:  string,         // userId of the host
  status:     'waiting' | 'playing' | 'paused' | 'finished',
  config:     object,         // full config snapshot (game-specific shape)
  minPlayers: number,         // from getGameMetadata() — used by the waiting-room UI
  maxPlayers: number,
  players:    PlayerObject[], // game-specific player records
  turnState:  object,         // game-specific turn tracking
  winner:     string | string[] | null,  // userId, or array of userIds for ties (Yahtzee, Life); null for draw; undefined for in-progress Monopoly-style games
  log:        LogEntry[],     // [{ message, type, timestamp }]
}
```
