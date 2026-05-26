/**
 * rest-state-filter.test.js
 *
 * SECURITY: GET /api/games/:id and POST /api/games/:id/start must route
 * their response state through the game-logic's getStateForPlayer(state,
 * recipientUserId) before returning. The socket pipeline has done this
 * for a long time; the REST path was the hole closed by this fix
 * (state-emission audit, commit 793359b).
 *
 * Three regression tests:
 *   1. GET /:id filters Battleship ship positions for the opponent.
 *   2. GET /:id filters Risk card hands for the opponent (canary card).
 *   3. GET /:id is safe-by-construction on waiting-room states (no init yet).
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

/** Emit a game:action and resolve once the emitter sees its game:update. */
async function action(socket, payload) {
  const upd = waitFor(socket, 'game:update');
  socket.emit('game:action', payload);
  return upd;
}

// Standard non-overlapping Battleship layouts — mirror the unit test fixtures
// so coverage matches between integration and unit.
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

test('GET /api/games/:id filters Battleship ship positions for the opponent', async () => {
  const alice = await register('alice');
  const bob = await register('bob');

  // Create + join via REST
  const createRes = await server.api
    .post('/api/games')
    .set(authed(alice.token))
    .send({ name: 'rest-filter-bs', gameType: 'battleship' })
    .expect(201);
  const gameId = createRes.body.gameId;
  await server.api.post(`/api/games/${gameId}/join`).set(authed(alice.token)).expect(200);
  await server.api.post(`/api/games/${gameId}/join`).set(authed(bob.token)).expect(200);

  // Connect both sockets and join the room
  const aliceSock = await connect(alice.token);
  const bobSock = await connect(bob.token);
  await emitAck(aliceSock, 'join_game', gameId);
  await emitAck(bobSock, 'join_game', gameId);

  // Start the game — wait for both sockets to see the game:update
  const aliceStart = waitFor(aliceSock, 'game:update');
  const bobStart = waitFor(bobSock, 'game:update');
  aliceSock.emit('game:start');
  await aliceStart;
  await bobStart;

  // Place all ships for both players (sequentially via the emitter's socket)
  for (const s of ALICE_SHIPS) await action(aliceSock, { action: 'placeShip', ...s });
  for (const s of BOB_SHIPS) await action(bobSock, { action: 'placeShip', ...s });
  await action(aliceSock, { action: 'commitPlacement' });
  await action(bobSock, { action: 'commitPlacement' });

  // ── The actual assertion: REST GET filters Bob's ships from Alice's view
  const res = await server.api.get(`/api/games/${gameId}`).set(authed(alice.token)).expect(200);
  const { state } = res.body;
  expect(state.gameType).toBe('battleship');
  expect(state.turnState.phase).toBe('firing');

  const aliceView = state.players.find((p) => p.userId === alice.user.id);
  const bobView = state.players.find((p) => p.userId === bob.user.id);

  // Alice sees her own ships intact
  expect(Array.isArray(aliceView.ships)).toBe(true);
  expect(aliceView.ships).toHaveLength(5);

  // Bob's ships field must be REMOVED entirely from Alice's REST view
  expect('ships' in bobView).toBe(false);

  // Belt-and-braces: none of Bob's actual cell coordinates appear in the JSON
  const json = JSON.stringify(state);
  for (const c of [
    { x: 9, y: 0 },
    { x: 9, y: 1 },
    { x: 9, y: 2 },
    { x: 9, y: 3 },
    { x: 9, y: 4 },
    { x: 7, y: 0 },
    { x: 7, y: 1 },
    { x: 7, y: 2 },
    { x: 7, y: 3 },
    { x: 5, y: 5 },
    { x: 5, y: 6 },
    { x: 5, y: 7 },
    { x: 3, y: 5 },
    { x: 3, y: 6 },
    { x: 3, y: 7 },
    { x: 7, y: 5 },
    { x: 7, y: 6 },
  ]) {
    expect(json).not.toContain(`"x":${c.x},"y":${c.y}`);
  }
});

test('GET /api/games/:id filters Risk card hands for the opponent', async () => {
  const alice = await register('alice');
  const bob = await register('bob');

  // Create + join Risk via REST
  const createRes = await server.api
    .post('/api/games')
    .set(authed(alice.token))
    .send({ name: 'rest-filter-risk', gameType: 'risk' })
    .expect(201);
  const gameId = createRes.body.gameId;
  await server.api.post(`/api/games/${gameId}/join`).set(authed(alice.token)).expect(200);
  await server.api.post(`/api/games/${gameId}/join`).set(authed(bob.token)).expect(200);

  // Sockets join the room and host starts (need start to populate the deck)
  const aliceSock = await connect(alice.token);
  const bobSock = await connect(bob.token);
  await emitAck(aliceSock, 'join_game', gameId);
  await emitAck(bobSock, 'join_game', gameId);
  const aliceStart = waitFor(aliceSock, 'game:update');
  const bobStart = waitFor(bobSock, 'game:update');
  aliceSock.emit('game:start');
  await aliceStart;
  await bobStart;

  // Inject a canary card directly into Alice's hand server-side — mirrors the
  // pattern from risk-hand-masking.test.js. Driving real Risk gameplay to
  // earn a card would be a fragile multi-turn setup.
  const gm = require('../../src/game-manager');
  const state = gm.peekGame(gameId);
  const aliceServerSide = state.players.find((p) => p.userId === alice.user.id);
  aliceServerSide.hand.push({
    id: 'card-secret-canary-007',
    territoryId: 'alaska',
    troopType: 'infantry',
  });

  // ── The actual assertion: REST GET from Bob's perspective masks Alice's hand
  const res = await server.api.get(`/api/games/${gameId}`).set(authed(bob.token)).expect(200);
  const view = res.body.state;
  const aliceFromBobView = view.players.find((p) => p.userId === alice.user.id);

  // Risk's getStateForPlayer removes the `hand` field and replaces it with handCount.
  expect(aliceFromBobView).not.toHaveProperty('hand');
  expect(aliceFromBobView.handCount).toBe(1);

  // Belt-and-braces: the canary id MUST NOT appear anywhere in Bob's view.
  // Catches the case where a "fix" leaves the hand array on some adjacent
  // field, or where the deck/discardPile filter regresses.
  expect(JSON.stringify(view)).not.toContain('card-secret-canary-007');

  // Bonus: confirm the deck is also masked to count form, not the full array
  expect(view.deck).toEqual({ count: expect.any(Number) });
});

test('GET /api/games/:id returns waiting-room state safely (no initGame yet)', async () => {
  const alice = await register('alice');

  const createRes = await server.api
    .post('/api/games')
    .set(authed(alice.token))
    .send({ name: 'rest-filter-waiting', gameType: 'battleship' })
    .expect(201);
  const gameId = createRes.body.gameId;

  // No join, no start — the game is still in waiting status, no initGame ran.
  const res = await server.api.get(`/api/games/${gameId}`).set(authed(alice.token)).expect(200);
  const { state } = res.body;
  expect(state.status).toBe('waiting');
  expect(state.gameType).toBe('battleship');
  // The filter call must not have crashed; the response should not be a 500.
  // Players array exists and is empty (createGame initializes it that way;
  // addPlayerToLobby would populate it but we deliberately skip that step).
  expect(Array.isArray(state.players)).toBe(true);
  expect(state.players).toHaveLength(0);
});
