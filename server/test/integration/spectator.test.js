/**
 * spectator.test.js
 *
 * Integration tests for spectator mode: socket join/leave flow, action
 * gating, chat tagging, and the security-critical filter bypass that lets
 * spectators see hidden information that players don't.
 *
 * The bypass test is the security-critical one — it mirrors
 * risk-hand-masking.test.js and rest-state-filter.test.js in spirit:
 * verify the *intentional* asymmetry where spectators receive unfiltered
 * state while players are still filtered.
 */

'use strict';

const { startServer, stopServer } = require('./helpers/server');
const { connectSocket, disconnectSocket, waitFor, emitAck } = require('./helpers/socket');

let server;

beforeAll(async () => {
  server = await startServer();
}, 15_000);
afterAll(async () => {
  await stopServer(server);
}, 10_000);

beforeEach(() => {
  const db = require('../../src/database');
  db.db.exec('DELETE FROM game_players; DELETE FROM games; DELETE FROM users;');
});

let _openSockets = [];
afterEach(async () => {
  await Promise.all(_openSockets.map(disconnectSocket));
  _openSockets = [];
});

async function register(username, password = 'pass1234') {
  const res = await server.api.post('/api/auth/register').send({ username, password }).expect(201);
  return res.body;
}

async function connect(token) {
  const s = await connectSocket(server.url, token);
  _openSockets.push(s);
  return s;
}

const authed = (token) => ({ Authorization: `Bearer ${token}` });

/** Emit a game:action and resolve once the emitter sees its own game:update. */
async function action(socket, payload) {
  const upd = waitFor(socket, 'game:update');
  socket.emit('game:action', payload);
  return upd;
}

// Standard non-overlapping Battleship layouts (copied from rest-state-filter.test.js).
const ALICE_SHIPS = [
  { shipId: 'carrier', origin: { x: 0, y: 0 }, orientation: 'horizontal' },
  { shipId: 'battleship', origin: { x: 0, y: 2 }, orientation: 'horizontal' },
  { shipId: 'cruiser', origin: { x: 0, y: 4 }, orientation: 'horizontal' },
  { shipId: 'submarine', origin: { x: 0, y: 6 }, orientation: 'horizontal' },
  { shipId: 'destroyer', origin: { x: 0, y: 8 }, orientation: 'horizontal' },
];
const BOB_SHIPS = [
  { shipId: 'carrier', origin: { x: 9, y: 0 }, orientation: 'vertical' },
  { shipId: 'battleship', origin: { x: 7, y: 0 }, orientation: 'vertical' },
  { shipId: 'cruiser', origin: { x: 5, y: 5 }, orientation: 'vertical' },
  { shipId: 'submarine', origin: { x: 3, y: 5 }, orientation: 'vertical' },
  { shipId: 'destroyer', origin: { x: 7, y: 5 }, orientation: 'vertical' },
];

/**
 * Bootstrap an in-progress Battleship game with two players logged in and
 * their fleets placed.  Returns { gameId, alice, bob, aliceSock, bobSock }.
 */
async function setupBattleship() {
  const alice = await register('alice');
  const bob = await register('bob');

  const createRes = await server.api
    .post('/api/games')
    .set(authed(alice.token))
    .send({ name: 'spectator-bs', gameType: 'battleship' })
    .expect(201);
  const gameId = createRes.body.gameId;

  await server.api.post(`/api/games/${gameId}/join`).set(authed(alice.token)).expect(200);
  await server.api.post(`/api/games/${gameId}/join`).set(authed(bob.token)).expect(200);

  const aliceSock = await connect(alice.token);
  const bobSock = await connect(bob.token);
  await emitAck(aliceSock, 'join_game', gameId);
  await emitAck(bobSock, 'join_game', gameId);

  // Start the game via socket (the REST start doesn't broadcast as reliably).
  const aliceStart = waitFor(aliceSock, 'game:update');
  const bobStart = waitFor(bobSock, 'game:update');
  aliceSock.emit('game:start');
  await aliceStart;
  await bobStart;

  // Sequentially place + commit both fleets, awaiting each game:update.
  for (const s of ALICE_SHIPS) await action(aliceSock, { action: 'placeShip', ...s });
  for (const s of BOB_SHIPS) await action(bobSock, { action: 'placeShip', ...s });
  await action(aliceSock, { action: 'commitPlacement' });
  await action(bobSock, { action: 'commitPlacement' });

  return { gameId, alice, bob, aliceSock, bobSock };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Spectator socket flow
// ─────────────────────────────────────────────────────────────────────────────

describe('spectator socket flow', () => {
  test('spectate succeeds for a logged-in user on an in-progress game', async () => {
    const { gameId } = await setupBattleship();
    const charlie = await register('charlie');
    const charlieSock = await connect(charlie.token);

    const initialState = waitFor(charlieSock, 'game:state');
    const ack = await emitAck(charlieSock, 'spectate', gameId);
    expect(ack).toEqual({ success: true });
    const { state } = await initialState;
    expect(state).toBeDefined();
    expect(state.gameType).toBe('battleship');
    expect(Array.isArray(state.spectators)).toBe(true);
    expect(state.spectators).toHaveLength(1);
    expect(state.spectators[0].username).toBe('charlie');
  });

  test('spectate rejected when the game is in waiting status', async () => {
    const alice = await register('alice');
    const createRes = await server.api
      .post('/api/games')
      .set(authed(alice.token))
      .send({ name: 'waiting-game', gameType: 'battleship' })
      .expect(201);
    const gameId = createRes.body.gameId;

    const charlie = await register('charlie');
    const charlieSock = await connect(charlie.token);
    await new Promise((resolve, reject) => {
      charlieSock.emit('spectate', gameId, (ack) => {
        try {
          expect(ack?.error).toMatch(/in progress/i);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  test('spectate rejected when the user is already a player', async () => {
    const { gameId, aliceSock } = await setupBattleship();
    // Alice is already a player in this game.  Trying to spectate it should fail.
    await new Promise((resolve, reject) => {
      aliceSock.emit('spectate', gameId, (ack) => {
        try {
          expect(ack?.error).toMatch(/already a player/i);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  test('spectator:joined event is broadcast to the room when a spectator joins', async () => {
    const { gameId, aliceSock } = await setupBattleship();
    const charlie = await register('charlie');
    const charlieSock = await connect(charlie.token);

    const aliceSeesJoin = waitFor(aliceSock, 'spectator:joined');
    await emitAck(charlieSock, 'spectate', gameId);
    const event = await aliceSeesJoin;
    expect(event.username).toBe('charlie');
    expect(typeof event.joinedAt).toBe('number');
  });

  test('unspectate removes the spectator without emitting a leave event', async () => {
    const { gameId, aliceSock } = await setupBattleship();
    const charlie = await register('charlie');
    const charlieSock = await connect(charlie.token);
    await emitAck(charlieSock, 'spectate', gameId);

    // Verify alice does NOT see a spectator:left event (no such event exists by design).
    // To assert "no event": race a short timeout against the (non-)event.
    let sawLeave = false;
    aliceSock.once('spectator:left', () => {
      sawLeave = true;
    });
    charlieSock.emit('unspectate');
    await new Promise((r) => setTimeout(r, 100));
    expect(sawLeave).toBe(false);

    // The REST endpoint should now show zero spectators.
    const res = await server.api
      .get(`/api/games/${gameId}/spectators`)
      .set(authed(charlie.token))
      .expect(200);
    expect(res.body.spectators).toEqual([]);
  });

  test('spectator disconnect removes them silently from the list', async () => {
    const { gameId, alice } = await setupBattleship();
    const charlie = await register('charlie');
    const charlieSock = await connect(charlie.token);
    await emitAck(charlieSock, 'spectate', gameId);

    // Disconnect Charlie's socket.
    await disconnectSocket(charlieSock);
    _openSockets = _openSockets.filter((s) => s !== charlieSock);
    // Brief tick to let the server process the disconnect.
    await new Promise((r) => setTimeout(r, 100));

    const res = await server.api
      .get(`/api/games/${gameId}/spectators`)
      .set(authed(alice.token))
      .expect(200);
    expect(res.body.spectators).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Action gating
// ─────────────────────────────────────────────────────────────────────────────

describe('spectator action gating', () => {
  test('game:action from a spectator is rejected with a game:error', async () => {
    const { gameId } = await setupBattleship();
    const charlie = await register('charlie');
    const charlieSock = await connect(charlie.token);
    await emitAck(charlieSock, 'spectate', gameId);

    const errorPromise = waitFor(charlieSock, 'game:error');
    charlieSock.emit('game:action', { action: 'fireShot', cell: { x: 0, y: 0 } });
    const err = await errorPromise;
    expect(err.message).toMatch(/spectators cannot take actions/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Chat (spectators CAN chat; messages are tagged with senderRole)
// ─────────────────────────────────────────────────────────────────────────────

describe('spectator chat', () => {
  test('spectator can send chat; players receive it with senderRole=spectator', async () => {
    const { gameId, aliceSock } = await setupBattleship();
    const charlie = await register('charlie');
    const charlieSock = await connect(charlie.token);
    await emitAck(charlieSock, 'spectate', gameId);

    const alicePromise = waitFor(aliceSock, 'chat:message');
    charlieSock.emit('chat:message', { text: 'this is going to be brutal' });
    const msg = await alicePromise;
    expect(msg.username).toBe('charlie');
    expect(msg.text).toBe('this is going to be brutal');
    expect(msg.senderRole).toBe('spectator');
  });

  test('player chat is tagged with senderRole=player', async () => {
    const { gameId, aliceSock, bobSock } = await setupBattleship();
    const bobPromise = waitFor(bobSock, 'chat:message');
    aliceSock.emit('chat:message', { text: 'gg' });
    const msg = await bobPromise;
    expect(msg.username).toBe('alice');
    expect(msg.senderRole).toBe('player');
    void gameId; // suppress unused warning
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  REST endpoint
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/games/:id/spectators', () => {
  test('returns 200 with an empty array for a game with no spectators', async () => {
    const { gameId, alice } = await setupBattleship();
    const res = await server.api
      .get(`/api/games/${gameId}/spectators`)
      .set(authed(alice.token))
      .expect(200);
    expect(res.body.spectators).toEqual([]);
  });

  test('lists active spectators in shape { userId, username, joinedAt }', async () => {
    const { gameId, alice } = await setupBattleship();
    const charlie = await register('charlie');
    const charlieSock = await connect(charlie.token);
    await emitAck(charlieSock, 'spectate', gameId);

    const res = await server.api
      .get(`/api/games/${gameId}/spectators`)
      .set(authed(alice.token))
      .expect(200);
    expect(res.body.spectators).toHaveLength(1);
    const [s] = res.body.spectators;
    expect(s.username).toBe('charlie');
    expect(typeof s.joinedAt).toBe('number');
    expect(typeof s.userId).toBe('string');
  });

  test('returns 404 for an unknown game id', async () => {
    const alice = await register('alice');
    await server.api.get('/api/games/no-such-id/spectators').set(authed(alice.token)).expect(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Filter bypass — security regression test
// ─────────────────────────────────────────────────────────────────────────────
//
// The intentional asymmetry: a Battleship spectator sees BOTH players'
// ship positions; a Battleship player still sees only their own.  Mirrors
// the rest-state-filter.test.js pattern but verifies that the bypass
// fires only when it should.

describe('spectator filter bypass (security)', () => {
  test('spectator receives unfiltered Battleship state — both fleets visible', async () => {
    const { gameId } = await setupBattleship();

    const charlie = await register('charlie');
    const charlieSock = await connect(charlie.token);
    const spectatePromise = waitFor(charlieSock, 'game:state');
    await emitAck(charlieSock, 'spectate', gameId);
    const { state } = await spectatePromise;

    // Both players' ships visible — Battleship's filter would normally
    // strip the `ships` field from the opposing player's view.
    expect(state.players).toHaveLength(2);
    for (const p of state.players) {
      expect(Array.isArray(p.ships)).toBe(true);
      expect(p.ships).toHaveLength(5);
    }
    // Belt-and-braces: bob's actual ship coordinates appear in the JSON.
    const json = JSON.stringify(state);
    for (const c of [
      { x: 9, y: 0 },
      { x: 7, y: 0 },
      { x: 5, y: 5 },
      { x: 3, y: 5 },
      { x: 7, y: 5 },
    ]) {
      expect(json).toContain(`"x":${c.x},"y":${c.y}`);
    }
  });

  test('player still sees filtered Battleship state — only own ships visible', async () => {
    const { gameId, alice, bob } = await setupBattleship();
    // Alice's REST view: bob's ships field is removed entirely (matches
    // the existing rest-state-filter.test.js assertion).
    const res = await server.api.get(`/api/games/${gameId}`).set(authed(alice.token)).expect(200);
    const aliceState = res.body.state;
    const aliceP = aliceState.players.find((p) => p.userId === alice.user.id);
    const bobP = aliceState.players.find((p) => p.userId === bob.user.id);
    expect(aliceP.ships).toHaveLength(5);
    expect('ships' in bobP).toBe(false);
  });

  test('spectator state has no actionDescriptors (spectators take no actions)', async () => {
    const { gameId } = await setupBattleship();
    const charlie = await register('charlie');
    const charlieSock = await connect(charlie.token);
    const spectatePromise = waitFor(charlieSock, 'game:state');
    await emitAck(charlieSock, 'spectate', gameId);
    const { state } = await spectatePromise;
    expect(state.actionDescriptors).toBeUndefined();
    expect(state.validActions).toBeUndefined();
  });
});
