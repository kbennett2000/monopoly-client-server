/**
 * help-endpoint.test.js
 *
 * Covers GET /api/games/types/:type/help — the markdown rules endpoint backing
 * the in-game help overlay.
 *
 *   1. Returns 200 + markdown content for a known game type.
 *   2. Returns 404 for an unknown game type.
 *   3. Requires authentication (no token → 401).
 */

'use strict';

const { startServer, stopServer } = require('./helpers/server');

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

async function register(username = 'alice', password = 'pass1234') {
  const res = await server.api.post('/api/auth/register').send({ username, password }).expect(201);
  return res.body;
}

const authed = (token) => ({ Authorization: `Bearer ${token}` });

test('GET /api/games/types/monopoly/help returns markdown content', async () => {
  const alice = await register();
  const res = await server.api
    .get('/api/games/types/monopoly/help')
    .set(authed(alice.token))
    .expect(200);

  expect(res.body.gameType).toBe('monopoly');
  expect(typeof res.body.content).toBe('string');
  expect(res.body.content.length).toBeGreaterThan(0);
  // The first non-blank line should be the H1 heading for the game.
  expect(res.body.content.trimStart().startsWith('#')).toBe(true);
});

test('GET /api/games/types/nonexistent/help returns 404', async () => {
  const alice = await register();
  await server.api.get('/api/games/types/nonexistent/help').set(authed(alice.token)).expect(404);
});

test('GET /api/games/types/monopoly/help requires authentication', async () => {
  await server.api.get('/api/games/types/monopoly/help').expect(401);
});
