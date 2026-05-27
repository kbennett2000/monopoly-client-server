/**
 * socket-handler.js
 *
 * Wires all Socket.io real-time events for game play.
 * Game-agnostic: all game-specific behaviour is delegated to the game-logic
 * module selected by game-registry based on the game's gameType field.
 *
 * Connection lifecycle
 * ────────────────────
 *   connect        → client authenticates via socket.handshake.auth.token
 *   join_game      → client joins a Socket.io room for a specific game
 *   leave_game     → client leaves the room (but stays in DB)
 *   disconnect     → mark player as disconnected; game continues
 *
 * In-game events (client → server)
 * ──────────────────────────────────
 *   game:start              host starts the game
 *   game:action  { action, ...payload }  any player action (roll, buy, trade, …)
 *   game:save
 *   chat:message { text }
 *
 * Server → client broadcasts (to the game room)
 * ───────────────────────────────────────────────
 *   game:state         full GameState (on join)
 *   game:update        { state, events[] }  after every action
 *   game:error         { message }  (to the acting socket only)
 *   trade:incoming     { from, payload }  targeted to the trade recipient
 *   chat:message       { username, text, timestamp }
 */

'use strict';

const { authenticateSocket } = require('./auth');
const gameManager = require('./game-manager');
const gameRegistry = require('./game-registry');
const { filterStateForUser } = require('./state-filter');

// Track which socket is in which game room: Map<socketId, gameId>
const socketGameMap = new Map();
// Track each user's active socket for targeted emissions: Map<userId, socketId>
const userSocketMap = new Map();

// ── spectators ───────────────────────────────────────────────────────────────
//
// Spectators are runtime-only — they live in this map, not in the persisted
// game state.  A user is a spectator of game X if they appear in
// `gameSpectators.get(X)`.  Spectators receive UNFILTERED game state (see
// the bypass in filteredFor) and CANNOT take game actions (see the gate in
// the game:action handler).  Joining as a player and joining as a spectator
// are mutually exclusive — the spectate handler rejects a player of the
// same game, and addPlayerToLobby/startGame don't add spectators to the
// player list.
//
// Map<gameId, Map<userId, { username, joinedAt, socketId }>>
const gameSpectators = new Map();

function isSpectator(gameId, userId) {
  const spectators = gameSpectators.get(gameId);
  return !!(spectators && spectators.has(userId));
}

function addSpectator(gameId, userId, username, socketId) {
  let spectators = gameSpectators.get(gameId);
  if (!spectators) {
    spectators = new Map();
    gameSpectators.set(gameId, spectators);
  }
  spectators.set(userId, { username, joinedAt: Date.now(), socketId });
}

function removeSpectator(gameId, userId) {
  const spectators = gameSpectators.get(gameId);
  if (!spectators) return false;
  const removed = spectators.delete(userId);
  if (spectators.size === 0) gameSpectators.delete(gameId);
  return removed;
}

/**
 * Snapshot of a game's spectator list in the shape the wire format expects:
 *   [{ userId, username, joinedAt }, ...]
 * Always returns a fresh array (never the internal Map).  Empty array is
 * returned for games with no spectators — renderers should treat that as
 * "no spectators present" rather than "feature unavailable."
 */
function spectatorsForWire(gameId) {
  const spectators = gameSpectators.get(gameId);
  if (!spectators) return [];
  return Array.from(spectators.entries(), ([userId, info]) => ({
    userId,
    username: info.username,
    joinedAt: info.joinedAt,
  }));
}

// ── per-socket state filtering ─────────────────────────────────────────────────
//
// Hidden-information games (Risk, future card games) implement
// getStateForPlayer(state, userId) which masks fields the recipient is not
// allowed to see (other players' hands, the deck, etc.).  Every state-bearing
// emit MUST go through these helpers so each socket receives the version
// tailored to its user.

/**
 * Build the per-recipient view of state for the wire.  Two flavours:
 *
 *   Player path  — runs the recipient's userId through getStateForPlayer
 *     so hidden information (Battleship ships, Risk hands, Life tiles)
 *     stays masked; attaches the recipient's validActions and
 *     actionDescriptors decorations.
 *   Spectator path — SKIPS the hidden-information filter (spectators
 *     watch with full visibility per the locked design decision) AND
 *     skips the action decorations (spectators have no actions).
 *
 * The spectator branch is the ONLY legitimate way for a connected user
 * to receive unfiltered state for a game they're not playing in.  The
 * gate is `isSpectator(gameId, userId)` — registration goes through
 * the `spectate` socket handler, which validates the game exists and
 * the user isn't already a player.  No client-side flag can claim
 * spectator status.
 *
 * Every state-bearing emit attaches `state.spectators` (a list of
 * { userId, username, joinedAt }) so renderers can render a spectator
 * count without an extra round-trip.  The list comes from gameSpectators,
 * not from persisted state — see the spectators block above.
 */
function filteredFor(state, userId, gameId = null) {
  if (!state) return state;
  const gid = gameId || state.id;

  const spectatorList = gid ? spectatorsForWire(gid) : [];

  if (gid && userId && isSpectator(gid, userId)) {
    // Spectator path — full state, no descriptors, no validActions.
    return { ...state, spectators: spectatorList };
  }

  // Player path — filter for hidden information then attach decorations.
  const view = filterStateForUser(state, userId, gameRegistry);
  const logic = gameRegistry.getGameLogic(state.gameType);
  let out = view;
  if (userId && typeof logic.getValidActions === 'function') {
    out = { ...out, validActions: logic.getValidActions(out, userId) };
  }
  if (userId && typeof logic.getActionDescriptors === 'function') {
    out = { ...out, actionDescriptors: logic.getActionDescriptors(out, userId) };
  }
  out = { ...out, spectators: spectatorList };
  return out;
}

/**
 * Emit a state-bearing event to one socket, with the state filtered for that
 * socket's user.  `extra` is merged into the payload unchanged (events array,
 * etc. — never private to a particular user).
 *
 * The gameId argument is the recipient's current game room; passed through to
 * filteredFor so it can apply the spectator-bypass when applicable.  When
 * omitted, falls back to socketGameMap (the socket's current room).
 */
function emitToSocket(socket, eventName, state, extra = {}, gameId = null) {
  const userId = socket.data?.userId;
  const gid = gameId || socketGameMap.get(socket.id) || null;
  socket.emit(eventName, { state: filteredFor(state, userId, gid), ...extra });
}

/**
 * Emit a state-bearing event to every socket in a game room, each receiving
 * its user's filtered view.  `exceptSocket` skips one socket (used when the
 * acting socket already received a different event for the same action).
 */
function emitToRoom(io, gameId, eventName, state, extra = {}, exceptSocket = null) {
  const room = io.sockets.adapter.rooms.get(gameId);
  if (!room) return;
  for (const socketId of room) {
    if (exceptSocket && socketId === exceptSocket.id) continue;
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    emitToSocket(sock, eventName, state, extra, gameId);
  }
}

// ── turn timeout ──────────────────────────────────────────────────────────────
// When a player disconnects mid-turn, auto-skip after TURN_TIMEOUT_MS.

const TURN_TIMEOUT_MS = 30_000;
const turnTimers = new Map(); // key: `${gameId}:${userId}` → timer handle

function scheduleTurnTimeout(io, gameId, userId, username) {
  const key = `${gameId}:${userId}`;
  clearTurnTimeout(key);
  // Send an absolute deadline so the client can run a local countdown that
  // stays accurate regardless of network jitter or message-delivery delay.
  io.to(gameId).emit('game:turn_warning', {
    username,
    deadlineTimestamp: Date.now() + TURN_TIMEOUT_MS,
  });
  turnTimers.set(
    key,
    setTimeout(async () => {
      turnTimers.delete(key);
      // Snapshot — we hand `state` to game-logic functions below.
      const state = gameManager.getGameSnapshot(gameId);
      if (!state || state.status !== 'playing') return;
      const logic = gameRegistry.getGameLogic(state.gameType);
      const cur = logic.getCurrentPlayer(state);
      // Only fire if it's still this player's turn and they're still disconnected
      if (!cur || cur.userId !== userId) return;
      const player = state.players.find((p) => p.userId === userId);
      if (player?.connected) return;
      if (logic.isTurnTimerBlocked(state)) return;
      const result = await gameManager.applyAction(gameId, userId, 'skipTurn', {});
      if (!result.error) {
        emitToRoom(io, gameId, 'game:update', result.state, { events: result.events });
      }
    }, TURN_TIMEOUT_MS),
  );
}

function clearTurnTimeout(key) {
  if (turnTimers.has(key)) {
    clearTimeout(turnTimers.get(key));
    turnTimers.delete(key);
  }
}

// Stored io reference so REST routes can trigger lobby broadcasts
let _io = null;

/**
 * Emit 'lobby:update' to all connected sockets so every client on the lobby
 * screen refreshes its game list automatically.
 */
function broadcastLobbyUpdate() {
  if (!_io) throw new Error('broadcastLobbyUpdate called before registerHandlers');
  _io.emit('lobby:update');
}

/**
 * Register all Socket.io event handlers.
 * @param {import('socket.io').Server} io
 */
function registerHandlers(io) {
  _io = io;

  io.on('connection', (socket) => {
    // ── authenticate ────────────────────────────────────────────────────────

    let currentUser = null;
    try {
      currentUser = authenticateSocket(socket);
    } catch {
      socket.emit('auth:error', { message: 'Invalid or missing token. Please log in again.' });
      socket.disconnect(true);
      return;
    }

    console.log(`[socket] ${currentUser.username} connected (${socket.id})`);
    userSocketMap.set(currentUser.sub, socket.id);
    // Cache userId on the socket so per-socket state filtering can look it
    // up directly without a userSocketMap reverse-scan.
    socket.data.userId = currentUser.sub;

    // ── join game room ───────────────────────────────────────────────────────

    socket.on('join_game', async (gameId, ack) => {
      // peek is fine — we only read status here; the wire-bound read happens
      // after the mutations below via getGameSnapshot.
      const state = gameManager.peekGame(gameId);
      if (!state) {
        return ack?.({ error: 'Game not found' });
      }

      // Leave any previously joined game room
      const prevGame = socketGameMap.get(socket.id);
      if (prevGame && prevGame !== gameId) {
        socket.leave(prevGame);
        socketGameMap.delete(socket.id);
      }

      socket.join(gameId);
      socketGameMap.set(socket.id, gameId);

      // For games still in the lobby, add the player idempotently so that
      // joining via REST + socket (the normal flow) always results in a
      // consistent player list broadcast to everyone already in the room.
      if (state.status === 'waiting') {
        await gameManager.addPlayerToLobby(gameId, {
          id: currentUser.sub,
          username: currentUser.username,
        });
      }

      await gameManager.setPlayerConnected(gameId, currentUser.sub, true);
      // Cancel any pending turn-skip timer now that this player is back
      clearTurnTimeout(`${gameId}:${currentUser.sub}`);

      // Auto-resume paused (saved) games when a player rejoins
      if (state.status === 'paused') {
        await gameManager.resumeGame(gameId);
      }

      // Snapshot for wire emission — the state is about to be filtered and
      // serialized to multiple sockets and one ack callback.
      const latestState = gameManager.getGameSnapshot(gameId);

      // Send full state to the joining client
      emitToSocket(socket, 'game:state', latestState);

      // Notify everyone else in the room with the updated player list
      emitToRoom(
        io,
        gameId,
        'game:update',
        latestState,
        {
          events: [
            {
              type: 'PLAYER_JOINED_LOBBY',
              data: { username: currentUser.username },
              timestamp: Date.now(),
            },
          ],
        },
        socket,
      );

      // Update lobby lists on all connected clients (player count changed)
      broadcastLobbyUpdate();

      ack?.({ success: true });
    });

    // ── spectate game (read-only join) ───────────────────────────────────────

    socket.on('spectate', async (gameId, ack) => {
      const state = gameManager.peekGame(gameId);
      if (!state) return ack?.({ error: 'Game not found' });
      if (state.status !== 'playing') {
        return ack?.({
          error: 'You can only spectate a game in progress',
        });
      }
      // A player of this game can't also spectate it.  The lobby UI
      // doesn't show the Spectate button for the user's own active
      // games — this is the server-side enforcement of that decision.
      if (state.players?.some((p) => p.userId === currentUser.sub)) {
        return ack?.({ error: 'You are already a player in this game' });
      }

      // Leave any previously joined game room (spectator or player).
      const prevGame = socketGameMap.get(socket.id);
      if (prevGame && prevGame !== gameId) {
        if (isSpectator(prevGame, currentUser.sub)) {
          removeSpectator(prevGame, currentUser.sub);
        }
        socket.leave(prevGame);
        socketGameMap.delete(socket.id);
      }

      socket.join(gameId);
      socketGameMap.set(socket.id, gameId);
      addSpectator(gameId, currentUser.sub, currentUser.username, socket.id);

      const latestState = gameManager.getGameSnapshot(gameId);

      // Send the full state to the joining spectator (filteredFor's
      // spectator branch returns unfiltered state because we just
      // registered them above).
      emitToSocket(socket, 'game:state', latestState, {}, gameId);

      // Notify everyone else in the room — players want to know who's watching.
      emitToRoom(
        io,
        gameId,
        'game:update',
        latestState,
        {
          events: [
            {
              type: 'SPECTATOR_JOINED',
              data: { username: currentUser.username, joinedAt: Date.now() },
              timestamp: Date.now(),
            },
          ],
        },
        socket,
      );

      // The targeted broadcast above also emits the spectator:joined event
      // separately so renderers that don't read the events array still see
      // the join.
      io.to(gameId).emit('spectator:joined', {
        username: currentUser.username,
        joinedAt: Date.now(),
      });

      // Lobby spectator counts changed.
      broadcastLobbyUpdate();

      ack?.({ success: true });
    });

    socket.on('unspectate', () => {
      const gameId = socketGameMap.get(socket.id);
      if (!gameId) return;
      if (!isSpectator(gameId, currentUser.sub)) return;

      removeSpectator(gameId, currentUser.sub);
      socket.leave(gameId);
      socketGameMap.delete(socket.id);

      // No spectator:left broadcast — locked design decision (joins are
      // events, leaves are silent).  Lobby refresh keeps counts in sync.
      broadcastLobbyUpdate();
    });

    // ── leave game room ──────────────────────────────────────────────────────

    socket.on('leave_game', async () => {
      const gameId = socketGameMap.get(socket.id);
      if (!gameId) return;

      socket.leave(gameId);
      socketGameMap.delete(socket.id);
      clearTurnTimeout(`${gameId}:${currentUser.sub}`);
      await gameManager.setPlayerConnected(gameId, currentUser.sub, false);

      emitToRoom(io, gameId, 'game:update', gameManager.getGameSnapshot(gameId), {
        events: [
          {
            type: 'PLAYER_DISCONNECTED',
            data: { username: currentUser.username },
            timestamp: Date.now(),
          },
        ],
      });
    });

    // ── disconnect ───────────────────────────────────────────────────────────

    socket.on('disconnect', async () => {
      console.log(`[socket] ${currentUser.username} disconnected (${socket.id})`);

      // Only remove from userSocketMap if this socket is still the active one
      // (a reconnect may have already registered a new socketId for this user)
      if (userSocketMap.get(currentUser.sub) === socket.id) {
        userSocketMap.delete(currentUser.sub);
      }

      const gameId = socketGameMap.get(socket.id);
      if (gameId) {
        socketGameMap.delete(socket.id);

        // Spectator disconnects clean up silently (no spectator:left
        // broadcast, no setPlayerConnected — they aren't players).  The
        // lobby refresh keeps spectator counts in sync.
        if (isSpectator(gameId, currentUser.sub)) {
          removeSpectator(gameId, currentUser.sub);
          broadcastLobbyUpdate();
          return;
        }

        await gameManager.setPlayerConnected(gameId, currentUser.sub, false);

        // Snapshot — sent over the wire and also passed to game-logic
        // (getCurrentPlayer / isTurnTimerBlocked) below.
        const state = gameManager.getGameSnapshot(gameId);
        emitToRoom(io, gameId, 'game:update', state, {
          events: [
            {
              type: 'PLAYER_DISCONNECTED',
              data: { username: currentUser.username },
              timestamp: Date.now(),
            },
          ],
        });

        // If it was this player's turn, start the auto-skip countdown
        if (state && state.status === 'playing') {
          const logic = gameRegistry.getGameLogic(state.gameType);
          const cur = logic.getCurrentPlayer(state);
          if (cur?.userId === currentUser.sub && !logic.isTurnTimerBlocked(state)) {
            scheduleTurnTimeout(io, gameId, currentUser.sub, currentUser.username);
          }
        }
      }
    });

    // ── game start ───────────────────────────────────────────────────────────

    socket.on('game:start', () => {
      const gameId = socketGameMap.get(socket.id);
      if (!gameId) return socket.emit('game:error', { message: 'Not in a game' });

      const result = gameManager.startGame(gameId, currentUser.sub);
      if (result.error) return socket.emit('game:error', { message: result.error });

      emitToRoom(io, gameId, 'game:update', result.state, { events: result.events });

      // Game status changed to 'playing' — update lobby lists everywhere
      broadcastLobbyUpdate();
    });

    // ── join lobby ───────────────────────────────────────────────────────────

    socket.on('lobby:join', async (gameId, ack) => {
      const result = await gameManager.addPlayerToLobby(gameId, {
        id: currentUser.sub,
        username: currentUser.username,
      });
      if (result.error) return ack?.({ error: result.error });

      socket.join(gameId);
      socketGameMap.set(socket.id, gameId);

      emitToRoom(io, gameId, 'game:update', result.state, {
        events: [
          {
            type: 'PLAYER_JOINED_LOBBY',
            data: { username: currentUser.username },
            timestamp: Date.now(),
          },
        ],
      });

      // ack is delivered to the joining socket; filter the state for them too
      ack?.({ success: true, state: filteredFor(result.state, currentUser.sub, gameId) });
    });

    // ── game action (single generic handler for all player actions) ──────────

    socket.on('game:action', async (payload) => {
      const { action, ...data } = payload || {};
      if (!action) {
        socket.emit('game:error', { message: 'Missing action type' });
        return;
      }

      const gameId = socketGameMap.get(socket.id);
      if (!gameId) {
        socket.emit('game:error', { message: 'Not in a game' });
        return;
      }

      // Spectators are watch-only.  A normal-UI client never reaches here
      // (the spectator banner replaces the action panel), but a buggy
      // or malicious client trying to slip an action through is rejected
      // server-side.  Logged because if this fires in normal play we
      // want to know.
      if (isSpectator(gameId, currentUser.sub)) {
        console.warn(
          `[socket] spectator ${currentUser.username} attempted action "${action}" ` +
            `in game ${gameId} — rejected`,
        );
        socket.emit('game:error', { message: 'Spectators cannot take actions' });
        return;
      }

      const result = await gameManager.applyAction(gameId, currentUser.sub, action, data);

      if (result.error) {
        socket.emit('game:error', { message: result.error });
        return;
      }

      emitToRoom(io, gameId, 'game:update', result.state, { events: result.events });

      // If the action resulted in a trade offer, notify the recipient directly
      const tradeEvent = result.events?.find((e) => e.type === 'TRADE_OFFERED');
      if (tradeEvent && data.toUserId) {
        const recipientSid = userSocketMap.get(data.toUserId);
        if (recipientSid) {
          io.to(recipientSid).emit('trade:incoming', { from: currentUser.username, payload: data });
        }
      }
    });

    // ── save game ────────────────────────────────────────────────────────────

    socket.on('game:save', async (ack) => {
      const gameId = socketGameMap.get(socket.id);
      if (!gameId) return ack?.({ error: 'Not in a game' });

      const result = await gameManager.saveGame(gameId, currentUser.sub);
      if (result.error) {
        socket.emit('game:error', { message: result.error });
        return ack?.({ error: result.error });
      }

      io.to(gameId).emit('game:saved', { savedBy: currentUser.username });
      ack?.({ success: true });
    });

    // ── chat ─────────────────────────────────────────────────────────────────

    socket.on('chat:message', ({ text }) => {
      if (!text || typeof text !== 'string') return;
      const trimmed = text.trim().slice(0, 300); // max 300 chars
      if (!trimmed) return;

      const gameId = socketGameMap.get(socket.id);
      if (!gameId) return;

      // senderRole lets the client render spectator messages with a
      // distinguishing prefix.  The server is the only place that
      // knows authoritatively whether the sender is a player or a
      // spectator — a client-supplied role tag would be forgeable.
      const senderRole = isSpectator(gameId, currentUser.sub) ? 'spectator' : 'player';

      io.to(gameId).emit('chat:message', {
        username: currentUser.username,
        text: trimmed,
        timestamp: Date.now(),
        senderRole,
      });
    });
  }); // end io.on('connection')
}

module.exports = {
  registerHandlers,
  broadcastLobbyUpdate,
  // Exported for REST routes that want to render a spectator count.
  spectatorsForWire,
};
