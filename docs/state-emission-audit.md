# State-emission audit

> **Status:** point-in-time audit, commit `07881aa`. Scope: every server-side
> emission of game state through any channel (socket, REST). Goal: confirm
> every state-bearing emit goes through `getStateForPlayer` (or has been
> verified to contain no hidden information).
>
> Trigger: the Battleship session 1 debrief flagged that the implementation
> trusts the existing emit pipeline without independent verification; Risk
> has been depending on the same pipeline for several sessions also without
> an audit. This document closes that gap.

## Methodology

Performed the following greps inside `server/src/` (production code only;
`/test/` excluded):

```
grep -rn "\.emit("       server/src/
grep -rn "io\.to"        server/src/
grep -rn "socket\.emit"  server/src/
grep -rn "io\.emit"      server/src/
grep -rn "getGameSnapshot\|peekGame"  server/src/
```

REST routes were audited in [server/src/routes/game.routes.js](../server/src/routes/game.routes.js)
by inspecting every `res.json(...)` call that returns game state. Both
channels (socket + REST) carry state to the client, so both must filter.

Each site was classified into one of:

| Classification | Meaning |
|---|---|
| **FILTERED** | Routes through `filteredFor` (`socket-handler.js:50`) or otherwise calls `logic.getStateForPlayer` before emission. |
| **NO STATE** | Payload contains no game state — errors, lobby pings, chat, save acknowledgements, turn-warning timestamps. |
| **DIRECT** | State in payload; not run through `getStateForPlayer`. Investigated individually. |

Events arrays (the `events` field of `game:update`) and connection-time
state paths were audited separately per Steps 5 and 6 of the audit plan.

## Inventory

### Socket emissions (server/src/socket-handler.js)

| File:line | Event | Payload | Recipient | Classification |
|---|---|---|---|---|
| [socket-handler.js:71](../server/src/socket-handler.js#L71) | *(via `emitToSocket`)* — every state-bearing event | `{ state: filteredFor(state, userId), ...extra }` | one socket | **FILTERED** — canonical helper |
| [socket-handler.js:79-88](../server/src/socket-handler.js#L79-L88) | *(via `emitToRoom`)* — every room broadcast | per-socket `filteredFor` | every socket in room | **FILTERED** — delegates to `emitToSocket` |
| [socket-handler.js:101](../server/src/socket-handler.js#L101) | `game:turn_warning` | `{ username, deadlineTimestamp }` | room | **NO STATE** |
| [socket-handler.js:142](../server/src/socket-handler.js#L142) | `lobby:update` | *(no payload)* | all sockets | **NO STATE** |
| [socket-handler.js:159](../server/src/socket-handler.js#L159) | `auth:error` | `{ message }` | one socket | **NO STATE** |
| [socket-handler.js:214](../server/src/socket-handler.js#L214) | `game:state` (via `emitToSocket`) | `{ state: filtered }` | joining socket | **FILTERED** |
| [socket-handler.js:217-232](../server/src/socket-handler.js#L217-L232) | `game:update` after join (via `emitToRoom`) | `{ state: filtered, events }` | room except joiner | **FILTERED** |
| [socket-handler.js:251](../server/src/socket-handler.js#L251) | `game:update` on leave (via `emitToRoom`) | `{ state: filtered, events }` | room | **FILTERED** |
| [socket-handler.js:281](../server/src/socket-handler.js#L281) | `game:update` on disconnect (via `emitToRoom`) | `{ state: filtered, events }` | room | **FILTERED** |
| [socket-handler.js:306](../server/src/socket-handler.js#L306) | `game:error` (no game id) | `{ message }` | one socket | **NO STATE** |
| [socket-handler.js:309](../server/src/socket-handler.js#L309) | `game:error` (startGame failure) | `{ message }` | one socket | **NO STATE** |
| [socket-handler.js:311](../server/src/socket-handler.js#L311) | `game:update` after start (via `emitToRoom`) | `{ state: filtered, events }` | room | **FILTERED** |
| [socket-handler.js:329](../server/src/socket-handler.js#L329) | `game:update` after lobby:join (via `emitToRoom`) | `{ state: filtered, events }` | room | **FILTERED** |
| [socket-handler.js:340](../server/src/socket-handler.js#L340) | `lobby:join` ack | `{ success: true, state: filteredFor(...) }` | one socket | **FILTERED** |
| [socket-handler.js:348](../server/src/socket-handler.js#L348) | `game:error` (missing action) | `{ message }` | one socket | **NO STATE** |
| [socket-handler.js:354](../server/src/socket-handler.js#L354) | `game:error` (no game) | `{ message }` | one socket | **NO STATE** |
| [socket-handler.js:361](../server/src/socket-handler.js#L361) | `game:error` (action failure) | `{ message }` | one socket | **NO STATE** |
| [socket-handler.js:365](../server/src/socket-handler.js#L365) | `game:update` after action (via `emitToRoom`) | `{ state: filtered, events }` | room | **FILTERED** |
| [socket-handler.js:372](../server/src/socket-handler.js#L372) | `trade:incoming` | `{ from, payload: data }` | trade recipient | **NO STATE** — `data` is the original action payload (offered properties, money, jail cards), not game state |
| [socket-handler.js:385](../server/src/socket-handler.js#L385) | `game:error` (save failure) | `{ message }` | one socket | **NO STATE** |
| [socket-handler.js:389](../server/src/socket-handler.js#L389) | `game:saved` | `{ savedBy }` | room | **NO STATE** |
| [socket-handler.js:403](../server/src/socket-handler.js#L403) | `chat:message` | `{ username, text, timestamp }` | room | **NO STATE** |

**Socket emit total:** 19 distinct call sites. **0 DIRECT.**

### REST emissions (server/src/routes/game.routes.js)

REST responses are equally part of the wire surface. Every `res.json({ state, ... })`
carrying a `GameState` object is an emit by another channel.

| File:line | Endpoint | Body | Classification |
|---|---|---|---|
| [game.routes.js:61](../server/src/routes/game.routes.js#L61) | `GET /api/games` | `{ games: listOpenGames() }` | **NO STATE** — DB query returns metadata only (`id, name, game_type, status, created_at, created_by, host_username, player_count`); no `state` column |
| [game.routes.js:73](../server/src/routes/game.routes.js#L73) | `GET /api/games/saved` | `{ games: listSavedGamesForUser(...) }` | **NO STATE** — same metadata-only shape |
| [game.routes.js:85](../server/src/routes/game.routes.js#L85) | `GET /api/games/mine` | `{ games: listActiveGamesForUser(...) }` | **NO STATE** — same metadata-only shape |
| [game.routes.js:101](../server/src/routes/game.routes.js#L101) | `GET /api/games/types` | `{ types: [{ key, ...metadata }] }` | **NO STATE** — game-type registry metadata |
| [game.routes.js:114](../server/src/routes/game.routes.js#L114) | `GET /api/games/types/:type/config` | `{ config: getConfigCopy() }` | **NO STATE** — game-config snapshot; no per-player data |
| [game.routes.js:134](../server/src/routes/game.routes.js#L134) | `POST /api/games/types/:type/config/reload` | `{ success, config }` | **NO STATE** — admin-only; config snapshot |
| [game.routes.js:150](../server/src/routes/game.routes.js#L150) | `GET /api/games/config/default` | `{ config }` | **NO STATE** |
| [game.routes.js:184](../server/src/routes/game.routes.js#L184) | `POST /api/games` (create) | `{ gameId, state }` | **DIRECT** — but state at this point is the placeholder waiting-room state with empty `players: []`; no hidden information exists. Logged for completeness. |
| [game.routes.js:198](../server/src/routes/game.routes.js#L198) | **`GET /api/games/:id`** | `{ state: getGameSnapshot(...) }` | **DIRECT — REAL LEAK** (see Findings) |
| [game.routes.js:209](../server/src/routes/game.routes.js#L209) | `POST /api/games/:id/join` | `{ state: addPlayerToLobby(...).state }` | **DIRECT** — but `addPlayerToLobby` errors out unless `status === 'waiting'`, so the returned state is always pre-`initGame`; no hidden information exists. Logged for completeness. |
| [game.routes.js:217](../server/src/routes/game.routes.js#L217) | **`POST /api/games/:id/start`** | `{ state: startGame(...).state }` | **DIRECT — possibly concerning** (see Findings) |
| [game.routes.js:225](../server/src/routes/game.routes.js#L225) | `POST /api/games/:id/save` | `{ success: true }` | **NO STATE** |
| [game.routes.js:234](../server/src/routes/game.routes.js#L234) | `DELETE /api/games/:id` | `{ success: true }` | **NO STATE** |

**REST total:** 13 endpoints. **3 DIRECT** (one real leak, one possibly concerning, one currently-safe-but-unfiltered-by-pattern).

### Combined totals

| Classification | Count |
|---|---|
| FILTERED | 12 socket sites (the 2 helpers cover every `game:state` / `game:update` / `lobby:join` ack) |
| NO STATE | 11 socket sites + 9 REST endpoints = 20 |
| DIRECT | 3 REST endpoints |
| **Total** | **32 distinct emission sites** |

## Findings

### Real leak: `GET /api/games/:id` returns unfiltered state

**Site:** [server/src/routes/game.routes.js:194-199](../server/src/routes/game.routes.js#L194-L199)

```js
router.get('/:id', (req, res) => {
  const state = gameManager.getGameSnapshot(req.params.id);
  if (!state) return res.status(404).json({ error: 'Game not found' });
  res.json({ state });
});
```

**What's leaked.** The full canonical `GameState` for any game the caller can
name. Specifically:

- **Risk:** `state.players[*].hand` for *every* player — full card identities,
  not just `handCount`. `state.deck` contents (every remaining card). `state.discardPile`.
- **Battleship:** `state.players[*].ships` for *every* player — every ship's
  `origin`, `orientation`, `cells`, and `hits` array. This is the entire
  fleet placement of every player, including the requesting player's opponent.
- **Any future hidden-information game** (Coup roles, Stratego pieces, etc.)
  — by default, until the game implements its own filter, *and that filter
  only runs on the socket path.*

**Who calls it.** Confirmed: the client's "Rejoin" flow in
[client/js/app.js:225](../client/js/app.js#L225) calls `API.getGame(gameId)`,
which hits this endpoint. Any player who joins/rejoins an in-progress game
goes through this path. The client also uses it on first-load detection
of a "playing" status to populate the game screen before the socket sync.

**Authentication.** The endpoint is authenticated (`router.use(auth.requireAuth)`),
so a random outsider can't read your game. But the authenticated caller
includes the opponents — and the opponents are exactly the people who must
*not* see the hidden state.

**Severity.** Critical for both currently-shipped hidden-info games:

- A malicious Battleship player can win every game with certainty by hitting
  this endpoint after Alice commits her placement. The placements are not
  re-shuffled mid-game, so a single read at any point gives the attacker
  every cell.
- A malicious Risk player can read every opponent's card hand at any time,
  enabling perfect anticipation of card trade-ins.

**Why the socket path is safe but the REST path isn't.** The socket pipeline
goes through `emitToSocket` / `emitToRoom`, both of which call `filteredFor`,
which calls `logic.getStateForPlayer`. The REST handler bypasses all of
that — it calls `getGameSnapshot` (which is just `structuredClone(peekGame(...))`)
and `res.json` straight to the wire.

The doc comment on `getGameSnapshot` at
[game-manager.js:185-193](../server/src/game-manager.js#L185-L193) even calls
this out implicitly:

> Returns a structuredClone() of the game's state, safe to hand to game-logic
> code or to return over the wire.

"Safe to return over the wire" is *technically* true (it's a defensive copy
so the caller can't mutate the canonical state) but **does not imply
filtered**. This wording invites the bug it didn't cause.

### Possibly concerning: `POST /api/games/:id/start` returns unfiltered state

**Site:** [server/src/routes/game.routes.js:214-218](../server/src/routes/game.routes.js#L214-L218)

```js
router.post('/:id/start', (req, res) => {
  const result = gameManager.startGame(req.params.id, req.user.sub);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ state: result.state });
});
```

**Currently safe.** Verified: at the moment `initGame` returns for the two
hidden-info games currently shipped:

- **Risk:** every player's `hand` is `[]` (initialized empty; cards are
  drawn later when a player conquers a territory). No leak at the start
  moment.
- **Battleship:** every player's `ships` is `[]` (placement happens after
  the game transitions to `playing`/`setup`). No leak at the start moment.

**Why it's still concerning.** This site is unfiltered by pattern. A future
game that puts hidden information in `initGame` — Coup deals roles at game
start; Stratego allows pre-placement during setup, then init; a card game
that deals opening hands at init — will leak through this endpoint the
moment it's added, with no signal that anything has gone wrong.

**Recommendation:** filter this too, even though it's currently safe. Same
mechanical fix as the `GET /:id` path. Cheap to do; eliminates the future
trap.

### Logged for completeness: `POST /api/games` (create)

**Site:** [server/src/routes/game.routes.js:184](../server/src/routes/game.routes.js#L184)

Returns `{ gameId, state }` where `state` is the placeholder waiting-room
state (`status: 'waiting'`, `players: []`). No hidden information exists
because no players have joined and `initGame` hasn't run. Safe-by-construction;
no filter needed.

### Logged for completeness: `POST /api/games/:id/join`

**Site:** [server/src/routes/game.routes.js:209](../server/src/routes/game.routes.js#L209)

Returns `{ state: result.state }`. `addPlayerToLobby` rejects with
`Game already in progress` if the status is anything other than `waiting`,
so the returned state is always pre-`initGame`. No hidden information.
Safe-by-construction.

## `getGameSnapshot` / `peekGame` callers

Per Step 4 of the audit plan, every caller of these two functions was
checked for what they do with the result.

| Caller | What it does with the snapshot | Verdict |
|---|---|---|
| [routes/game.routes.js:196](../server/src/routes/game.routes.js#L196) | `res.json({ state })` direct | **LEAK** (covered above) |
| [socket-handler.js:110](../server/src/socket-handler.js#L110) | Reads `state.status`, `state.players`, etc. for turn-timer logic; never emits | **OK** (internal logic only) |
| [socket-handler.js:175](../server/src/socket-handler.js#L175) | `peekGame` for status check; mutation happens later via `applyAction`; emit at line 217-232 goes through `emitToRoom` | **OK** |
| [socket-handler.js:211](../server/src/socket-handler.js#L211) | Snapshot then `emitToSocket` (line 214) and `emitToRoom` (line 217-232) | **OK — emits filter** |
| [socket-handler.js:251](../server/src/socket-handler.js#L251) | `emitToRoom(io, gameId, 'game:update', gameManager.getGameSnapshot(gameId), ...)` | **OK — `emitToRoom` filters per-socket** |
| [socket-handler.js:280](../server/src/socket-handler.js#L280) | Snapshot then `emitToRoom` (line 281) | **OK** |

All socket callers route the snapshot through `emitToRoom` / `emitToSocket`,
which apply per-recipient filtering. The single REST caller is the leak.

## Events-array audit

Per Step 5 of the audit plan, every `events.push(...)` site in
[server/games/risk/game-logic.js](../server/games/risk/game-logic.js) and
[server/games/battleship/game-logic.js](../server/games/battleship/game-logic.js)
was inspected. Events are broadcast identically to every player (the `events`
field of `game:update` is not filtered per-recipient), so any hidden field
appearing in an event payload is a leak via that channel.

### Risk events

| Event | Payload | Verdict |
|---|---|---|
| `PLACE_REINFORCEMENT` | `username, territoryId, count` | OK (territory ownership is public) |
| `CARDS_TRADED` | `username, cardIds, bonusArmies, setNumber, territoryBonus, bonusTerritoryId` | **OK by game rule** — Risk requires the trader to show their set. The cards are now public knowledge by the act of trading. |
| `PHASE_CHANGED` | `phase, username` | OK |
| `DICE_ROLLED` *(Risk variant)* | `from, to, attackerRolls, defenderRolls, attackerLosses, defenderLosses` | OK (attack is initiated by the attacker, target is public) |
| `TERRITORY_CONQUERED` | `username, from, to, armiesMovedIn` | OK (territory ownership is public) |
| `PLAYER_ELIMINATED` | `username, eliminatedBy` | OK — note: when a player is eliminated their cards transfer to the conqueror. The card identities are NOT included in this event; the conqueror's increased hand count appears in the next filtered state push as `handCount`, never as card IDs. |
| `CARD_DRAWN` | `username` only | **CORRECT** — opponent sees only that you drew, not the card identity |
| `CONTINENT_HELD` | `username, continent, bonus` | OK (territory ownership is public) |
| `GAME_OVER` | `winner: username` | OK |
| `TURN_SKIPPED` | `username` | OK |

No Risk events leak any field that `getStateForPlayer` is masking.

### Battleship events

| Event | Payload | Verdict |
|---|---|---|
| `SHIP_PLACED` | `username, shipId` | **CORRECT** — no position fields. Regression test asserts JSON contains no `x:`/`y:`/`origin`/`cells`/`orientation`. |
| `SHIP_REMOVED` | `username, shipId` | **CORRECT** — same regression test |
| `PLAYER_READY` | `username` | OK |
| `PLAYER_UNREADY` | `username` | OK |
| `SETUP_COMPLETE` | `firstPlayer: username` | OK |
| `TURN_STARTED` | `username` | OK |
| `SHOT_FIRED` | `shooter, target, cell, result` | OK — the cell is the shooter's own choice; both players can see where the shot landed. Result is `'hit' | 'miss' | 'sunk'` (no ship identity for hit/miss). |
| `SHIP_SUNK` | `owner, shipId, shipName, length, cells` | **OK by game rule** — sunk ships are no longer hidden; the cells are intentionally revealed so the renderer can mark the full footprint. |
| `GAME_OVER` | `winner: userId, winnerUsername` | OK |
| `TURN_SKIPPED` | `username` | OK |

No Battleship events leak any field that `getStateForPlayer` is masking.

## Connection-time state audit

Per Step 6 of the audit plan: when a player connects or reconnects, the
framework sends them current game state. Verified the paths:

- **First socket join:** [socket-handler.js:214](../server/src/socket-handler.js#L214)
  uses `emitToSocket(socket, 'game:state', latestState)` → **filtered.**
- **Disconnect:** [socket-handler.js:281](../server/src/socket-handler.js#L281)
  uses `emitToRoom(io, gameId, 'game:update', state, ...)` → **filtered**
  (the disconnected client doesn't receive it; the remaining clients do,
  each getting their own filtered view).
- **Reconnect:** the client's `reconnect` handler in
  [client/js/socket-client.js:68-76](../client/js/socket-client.js#L68-L76)
  re-emits `join_game`, which goes through the same path as a first join →
  **filtered.**
- **Auto-resume of paused games on rejoin:** triggered at
  [socket-handler.js:205-207](../server/src/socket-handler.js#L205-L207); state
  emission happens after at line 214 via `emitToSocket` → **filtered.**

All socket connection-time paths are filtered. The REST `GET /api/games/:id`
described above is the only path that bypasses filtering, and the rejoin
client flow does use it before the socket sync arrives.

## Confidence statement

**As of commit `01209bd`, every state-bearing emit in `server/src/` — both
socket and REST channels — is either filtered through `getStateForPlayer`
or has been verified to contain no hidden information.**

The previously identified leaks in `GET /api/games/:id` and
`POST /api/games/:id/start` were closed in commit `01209bd` by routing
their response state through the same per-recipient filter the socket
pipeline uses. Regression tests in
[server/test/integration/rest-state-filter.test.js](../server/test/integration/rest-state-filter.test.js)
lock in the property for both Battleship (ship positions removed from
opponent view) and Risk (hand masked to handCount; canary card never
appears in opponent JSON), plus a waiting-room safe-by-construction test.

The duplicated filter logic across `socket-handler.js` and `game.routes.js`
is marked with `TODO: extract shared filter helper` at both new call sites.
That extraction is a follow-up commit; this audit and its fix deliberately
scope to the security fix only.

### Pre-fix statement (kept for historical record)

Before the fix, this section read:

> *As of commit `07881aa`, every socket-channel emission of game state in
> `server/src/` is filtered through `getStateForPlayer` via `emitToRoom` /
> `emitToSocket`, and every game's `events` array has been verified to
> contain no hidden information that the state filter would otherwise mask.*
>
> *However, two REST endpoints in `server/src/routes/game.routes.js` bypass
> the filter pipeline: `GET /api/games/:id` (real active leak — used by
> client rejoin flow, leaks Battleship ship positions and Risk hands) and
> `POST /api/games/:id/start` (unfiltered by pattern; safe today because
> neither shipped game's `initGame` populates hidden data, but a trap for
> a future game that does).*

## Recommended fix

Both REST endpoints take the same one-line shape:

```js
// game.routes.js — current GET /:id
const state = gameManager.getGameSnapshot(req.params.id);
if (!state) return res.status(404).json({ error: 'Game not found' });
res.json({ state });

// after
const state = gameManager.getGameSnapshot(req.params.id);
if (!state) return res.status(404).json({ error: 'Game not found' });
const logic = gameRegistry.getGameLogic(state.gameType);
const view = typeof logic.getStateForPlayer === 'function'
  ? logic.getStateForPlayer(state, req.user.sub)
  : state;
res.json({ state: view });
```

This duplicates a small subset of `filteredFor` from
[socket-handler.js:50-62](../server/src/socket-handler.js#L50-L62). A
cleaner factoring would extract the filtering helper into a shared
module so socket and REST share one filter, but per the audit scope that
refactor is a separate concern — fix the leak first, share the helper
second if it ever earns a second site (it already would, but the audit
shouldn't bundle).

A regression test should assert that `GET /api/games/:id` returns a state
where an opponent's hidden field is filtered (for Risk: hand is masked
to handCount; for Battleship: ships field is absent from the opponent's
record).

## Do not refactor based on this note

This is the audit report, not the fix. The fix lives in a separate commit.

## Follow-up: shared filter helper (commit `40992d7`)

The duplicated filter logic introduced by `01209bd` was extracted into
[server/src/state-filter.js](../server/src/state-filter.js) in commit
`40992d7`. Both the socket pipeline (`socket-handler.js`) and the REST
routes (`game.routes.js`) now route through a single `filterStateForUser`
helper. The risk of the two copies drifting out of sync is eliminated.

The socket pipeline still wraps the helper in a local `filteredFor`
function that adds a per-recipient `validActions` decoration on top of
the filter — that decoration is socket-only by design (the REST rejoin
client computes its own action set). The shared helper handles the
security-critical part; the wrapper handles the socket-only convenience.
