/**
 * action-descriptors.test.js
 *
 * Proves the framework attaches state.actionDescriptors to every socket
 * emit when the game implements getActionDescriptors. Battleship is the
 * proof-of-concept game; Yahtzee and Risk migrate in follow-up sessions.
 *
 * See docs/action-descriptors.md for the contract.
 */

'use strict';

const { startServer, stopServer } = require('./helpers/server');
const { connectSocket, disconnectSocket, emitAck } = require('./helpers/socket');

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

/**
 * Wait for the next game:update whose state matches `predicate`, ignoring
 * any pending updates that don't (e.g. the "PLAYER_JOINED_LOBBY" update that
 * fires when the second player joins). Avoids a flaky race between that
 * lobby-broadcast and the post-start update.
 */
function waitForUpdate(socket, predicate, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('game:update', listener);
      reject(new Error('Timeout waiting for matching game:update'));
    }, timeoutMs);
    function listener(data) {
      if (predicate(data)) {
        socket.off('game:update', listener);
        clearTimeout(timer);
        resolve(data);
      }
    }
    socket.on('game:update', listener);
  });
}

test('Battleship: socket emit carries actionDescriptors with the expected shape', async () => {
  const alice = await register('alice');
  const bob = await register('bob');

  const createRes = await server.api
    .post('/api/games')
    .set(authed(alice.token))
    .send({ name: 'descriptors', gameType: 'battleship' })
    .expect(201);
  const gameId = createRes.body.gameId;
  await server.api.post(`/api/games/${gameId}/join`).set(authed(alice.token)).expect(200);
  await server.api.post(`/api/games/${gameId}/join`).set(authed(bob.token)).expect(200);

  const aliceSock = await connect(alice.token);
  const bobSock = await connect(bob.token);
  await emitAck(aliceSock, 'join_game', gameId);
  await emitAck(bobSock, 'join_game', gameId);

  // Start the game and wait specifically for the post-start update.
  const wait = waitForUpdate(aliceSock, (u) => u.state.status === 'playing');
  aliceSock.emit('game:start');
  const upd = await wait;

  // The framework should attach actionDescriptors to the per-socket view.
  expect(Array.isArray(upd.state.actionDescriptors)).toBe(true);
  const ids = upd.state.actionDescriptors.map((d) => d.action).sort();
  expect(ids).toEqual(['commitPlacement', 'placeShip', 'removeShip', 'uncommitPlacement']);

  // Every descriptor carries the required-fields contract.
  for (const d of upd.state.actionDescriptors) {
    expect(typeof d.action).toBe('string');
    expect(typeof d.label).toBe('string');
    expect(typeof d.enabled).toBe('boolean');
  }

  // Initial setup state: only placeShip is enabled — no ships placed yet.
  const byAction = Object.fromEntries(upd.state.actionDescriptors.map((d) => [d.action, d]));
  expect(byAction.placeShip.enabled).toBe(true);
  expect(byAction.removeShip.enabled).toBe(false);
  expect(byAction.commitPlacement.enabled).toBe(false);
  expect(byAction.uncommitPlacement.enabled).toBe(false);

  // validActions stays attached too — the two contracts coexist.
  expect(Array.isArray(upd.state.validActions)).toBe(true);
});

test("Connect Four: socket emit does NOT carry actionDescriptors (game doesn't implement it)", async () => {
  const alice = await register('alice');
  const bob = await register('bob');

  const createRes = await server.api
    .post('/api/games')
    .set(authed(alice.token))
    .send({ name: 'no-descriptors', gameType: 'connect-four' })
    .expect(201);
  const gameId = createRes.body.gameId;
  await server.api.post(`/api/games/${gameId}/join`).set(authed(alice.token)).expect(200);
  await server.api.post(`/api/games/${gameId}/join`).set(authed(bob.token)).expect(200);

  const aliceSock = await connect(alice.token);
  const bobSock = await connect(bob.token);
  await emitAck(aliceSock, 'join_game', gameId);
  await emitAck(bobSock, 'join_game', gameId);

  const wait = waitForUpdate(aliceSock, (u) => u.state.status === 'playing');
  aliceSock.emit('game:start');
  const upd = await wait;

  // The framework MUST NOT invent descriptors for games that don't opt in —
  // they degrade to the validActions contract cleanly.
  expect(upd.state.actionDescriptors).toBeUndefined();
  expect(Array.isArray(upd.state.validActions)).toBe(true);
});
