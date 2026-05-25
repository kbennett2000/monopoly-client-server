/**
 * risk-hand-masking.test.js
 *
 * SECURITY: every state-bearing socket emit must filter the GameState through
 * the active game's getStateForPlayer(state, userId).  For Risk this means
 * each player sees their own hand but only handCount for everyone else.
 *
 * This test directly verifies the per-socket emit pipeline by injecting a
 * card into one player's hand on the server side, triggering a broadcast,
 * and capturing what arrives at each socket.
 */

'use strict';

const { startServer, stopServer } = require('./helpers/server');
const { connectSocket, disconnectSocket, waitFor, emitAck } = require('./helpers/socket');

let server;

beforeAll(async () => { server = await startServer(); }, 15_000);
afterAll(async () => { await stopServer(server); }, 10_000);

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

test('Risk: a player\'s hand is masked when broadcast to other players', async () => {
  const alice = await register('alice');
  const bob   = await register('bob');

  // Create a Risk game and have both players join via REST
  const createRes = await server.api
    .post('/api/games')
    .set(authed(alice.token))
    .send({ name: 'hand-masking', gameType: 'risk' })
    .expect(201);
  const gameId = createRes.body.gameId;
  await server.api.post(`/api/games/${gameId}/join`).set(authed(alice.token)).expect(200);
  await server.api.post(`/api/games/${gameId}/join`).set(authed(bob.token)).expect(200);

  // Connect both sockets and join the room
  const aliceSock = await connect(alice.token);
  const bobSock   = await connect(bob.token);
  await emitAck(aliceSock, 'join_game', gameId);
  await emitAck(bobSock,   'join_game', gameId);

  // Start the game — both will receive game:update
  const aliceStart = waitFor(aliceSock, 'game:update');
  const bobStart   = waitFor(bobSock,   'game:update');
  aliceSock.emit('game:start');
  await aliceStart;
  await bobStart;

  // Directly inject a card into Alice's hand server-side.  We're a trusted
  // test exercising the emit pipeline; in real play, cards arrive via
  // territory conquest at end of turn, which is a much longer setup.
  const gm = require('../../src/game-manager');
  const state = gm.peekGame(gameId);
  const aliceState = state.players.find(p => p.userId === alice.user.id);
  aliceState.hand.push({
    id: 'card-secret-canary-007', territoryId: 'alaska', troopType: 'infantry',
  });

  // Trigger any state-bearing broadcast.  placeReinforcement is the simplest:
  // it's valid for Alice in the reinforce phase of turn 1.
  // (The framework auto-assigns Alice as player 0 because she joined first.)
  const aliceTerritory = Object.entries(state.territories)
    .find(([, t]) => t.ownerId === alice.user.id)[0];

  const aliceGotUpdate = waitFor(aliceSock, 'game:update');
  const bobGotUpdate   = waitFor(bobSock,   'game:update');
  aliceSock.emit('game:action', {
    action: 'placeReinforcement', territoryId: aliceTerritory, count: 1,
  });
  const aliceUpd = await aliceGotUpdate;
  const bobUpd   = await bobGotUpdate;

  // Alice sees her own hand intact, with the canary card
  const aliceFromAliceView = aliceUpd.state.players.find(p => p.userId === alice.user.id);
  expect(aliceFromAliceView.hand).toBeDefined();
  expect(aliceFromAliceView.hand.some(c => c.id === 'card-secret-canary-007')).toBe(true);

  // Bob sees Alice's hand REPLACED with handCount, no hand property at all
  const aliceFromBobView = bobUpd.state.players.find(p => p.userId === alice.user.id);
  expect(aliceFromBobView).not.toHaveProperty('hand');
  expect(aliceFromBobView.handCount).toBe(1);

  // Belt-and-braces: the canary string MUST NOT appear anywhere in Bob's view
  expect(JSON.stringify(bobUpd.state)).not.toContain('card-secret-canary-007');
});
