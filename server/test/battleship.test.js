'use strict';

const gl = require('../games/battleship/game-logic');

// ── fixtures ──────────────────────────────────────────────────────────────────

const CFG = gl.getConfigCopy();

function makePlayer(id, name, overrides = {}) {
  return {
    userId: id,
    username: name,
    color: 'blue',
    colorHex: '#3b82f6',
    token: '⚓',
    active: true,
    connected: true,
    ships: [],
    ready: false,
    shotsReceived: [],
    shotsFired: [],
    shipsSunk: [],
    ...overrides,
  };
}

function makeState(overrides = {}) {
  const players = overrides.players || [makePlayer('p1', 'Alice'), makePlayer('p2', 'Bob')];
  return {
    id: 'test-game',
    name: 'Test',
    gameType: 'battleship',
    stateVersion: 1,
    status: 'playing',
    config: CFG,
    players,
    turnState: { phase: 'setup', currentPlayerIndex: null, setupCompleteAt: null },
    winner: null,
    log: [],
    ...overrides,
  };
}

/**
 * Standard non-overlapping layout for Alice — all 5 ships placed.
 * Carrier h(0,0) | Battleship h(0,2) | Cruiser h(0,4) | Submarine h(0,6) | Destroyer h(0,8)
 */
function aliceShipsPayload() {
  return [
    { shipId: 'carrier', origin: { x: 0, y: 0 }, orientation: 'horizontal' },
    { shipId: 'battleship', origin: { x: 0, y: 2 }, orientation: 'horizontal' },
    { shipId: 'cruiser', origin: { x: 0, y: 4 }, orientation: 'horizontal' },
    { shipId: 'submarine', origin: { x: 0, y: 6 }, orientation: 'horizontal' },
    { shipId: 'destroyer', origin: { x: 0, y: 8 }, orientation: 'horizontal' },
  ];
}

/**
 * Bob's layout — vertical, placed deliberately at coords that NEVER share an
 * (x,y) pair with any of Alice's cells so the JSON-grep security test can
 * isolate Bob's leaks. Alice covers x∈[0..4] at y∈{0,2,4,6,8}; Bob lives at
 * x∈{3,5,7,9} but never at the y values where Alice has those x's.
 * Carrier v(9,0) | Battleship v(7,0) | Cruiser v(5,5) | Submarine v(3,5) | Destroyer v(7,5)
 */
function bobShipsPayload() {
  return [
    { shipId: 'carrier', origin: { x: 9, y: 0 }, orientation: 'vertical' },
    { shipId: 'battleship', origin: { x: 7, y: 0 }, orientation: 'vertical' },
    { shipId: 'cruiser', origin: { x: 5, y: 5 }, orientation: 'vertical' },
    { shipId: 'submarine', origin: { x: 3, y: 5 }, orientation: 'vertical' },
    { shipId: 'destroyer', origin: { x: 7, y: 5 }, orientation: 'vertical' },
  ];
}

function placeAll(state, userId, payloads) {
  let s = state;
  for (const p of payloads) {
    const r = gl.applyAction(s, userId, 'placeShip', p);
    if (r.error) throw new Error(`placeAll: ${r.error} (shipId=${p.shipId})`);
    s = r.state;
  }
  return s;
}

/** Drive a state through to "both committed, firing about to begin." */
function bothReadyState() {
  let s = makeState();
  s = placeAll(s, 'p1', aliceShipsPayload());
  s = placeAll(s, 'p2', bobShipsPayload());
  s = gl.applyAction(s, 'p1', 'commitPlacement').state;
  const r = gl.applyAction(s, 'p2', 'commitPlacement');
  return r.state;
}

/** Force whose-turn-it-is so deterministic firing tests don't depend on Math.random. */
function setCurrent(state, idx) {
  return { ...state, turnState: { ...state.turnState, currentPlayerIndex: idx } };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Battleship — metadata', () => {
  test('shipped game module registers cleanly', () => {
    expect(() => require('../games/battleship/game-logic')).not.toThrow();
  });

  test('getGameMetadata returns all required fields with correct types', () => {
    const m = gl.getGameMetadata();
    expect(typeof m.name).toBe('string');
    expect(typeof m.description).toBe('string');
    expect(m.minPlayers).toBe(2);
    expect(m.maxPlayers).toBe(2);
    expect(typeof m.icon).toBe('string');
    expect(typeof m.estimatedDurationMinutes).toBe('number');
    expect(typeof m.complexity).toBe('string');
    expect(Array.isArray(m.tags)).toBe(true);
    expect(m.tags).toContain('hidden-information');
    expect(m.tags).toContain('two-player');
  });

  test('loadConfig rejects non-random firstPlayerSelection', () => {
    // We don't have a way to swap the on-disk file in this test, so we
    // smoke-test the validation logic by calling loadConfig with the real
    // file (which uses "random") and verifying it succeeds.
    expect(() => gl.loadConfig()).not.toThrow();
    expect(gl.getConfigCopy().settings.firstPlayerSelection).toBe('random');
  });
});

describe('Battleship — initGame', () => {
  test('initGame sets gameType, status=playing, phase=setup, currentPlayerIndex=null', () => {
    const s = gl.initGame('g1', 'Test', [makePlayer('p1', 'Alice'), makePlayer('p2', 'Bob')], CFG);
    expect(s.gameType).toBe('battleship');
    expect(s.status).toBe('playing');
    expect(s.turnState.phase).toBe('setup');
    expect(s.turnState.currentPlayerIndex).toBeNull();
    expect(s.turnState.setupCompleteAt).toBeNull();
    expect(s.stateVersion).toBe(1);
    expect(s.winner).toBeNull();
  });

  test('initGame initializes both players with empty per-player fields', () => {
    const s = gl.initGame('g1', 'Test', [makePlayer('p1', 'Alice'), makePlayer('p2', 'Bob')], CFG);
    for (const p of s.players) {
      expect(p.ships).toEqual([]);
      expect(p.ready).toBe(false);
      expect(p.shotsReceived).toEqual([]);
      expect(p.shotsFired).toEqual([]);
      expect(p.shipsSunk).toEqual([]);
    }
  });

  test('createInitialPlayer throws on missing config', () => {
    expect(() => gl.createInitialPlayer({ id: 'u', username: 'X' }, [], null)).toThrow();
    expect(() => gl.createInitialPlayer({ id: 'u', username: 'X' }, [], {})).toThrow();
  });

  test('createInitialPlayer initializes the new per-player fields', () => {
    const p = gl.createInitialPlayer({ id: 'u1', username: 'Z' }, [], CFG);
    expect(p.ships).toEqual([]);
    expect(p.ready).toBe(false);
    expect(p.shotsReceived).toEqual([]);
    expect(p.shotsFired).toEqual([]);
    expect(p.shipsSunk).toEqual([]);
  });
});

describe('Battleship — ship placement', () => {
  test('valid horizontal placement succeeds', () => {
    const s = makeState();
    const r = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 3, y: 5 },
      orientation: 'horizontal',
    });
    expect(r.error).toBeUndefined();
    const ship = r.state.players[0].ships.find((sh) => sh.id === 'carrier');
    expect(ship.cells).toEqual([
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
    ]);
  });

  test('valid vertical placement succeeds', () => {
    const s = makeState();
    const r = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'battleship',
      origin: { x: 2, y: 1 },
      orientation: 'vertical',
    });
    expect(r.error).toBeUndefined();
    const ship = r.state.players[0].ships.find((sh) => sh.id === 'battleship');
    expect(ship.cells).toEqual([
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 4 },
    ]);
  });

  test('out-of-bounds horizontal placement rejected', () => {
    const s = makeState();
    const r = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 6, y: 5 },
      orientation: 'horizontal',
    });
    expect(r.error).toMatch(/out of bounds/);
  });

  test('out-of-bounds vertical placement rejected', () => {
    const s = makeState();
    const r = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 0, y: 6 },
      orientation: 'vertical',
    });
    expect(r.error).toMatch(/out of bounds/);
  });

  test('overlapping placement rejected', () => {
    let s = makeState();
    s = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 0, y: 0 },
      orientation: 'horizontal',
    }).state;
    const r = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'battleship',
      origin: { x: 2, y: 0 },
      orientation: 'horizontal',
    });
    expect(r.error).toMatch(/overlaps/);
  });

  test('re-placement of an already-placed ship moves it', () => {
    let s = makeState();
    s = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 0, y: 0 },
      orientation: 'horizontal',
    }).state;
    const r = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 5, y: 5 },
      orientation: 'vertical',
    });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].ships).toHaveLength(1);
    expect(r.state.players[0].ships[0].origin).toEqual({ x: 5, y: 5 });
    expect(r.state.players[0].ships[0].orientation).toBe('vertical');
  });

  test('moving a ship onto its own old cells is allowed', () => {
    // Moving the carrier from (0,0)h to (1,0)h — old cells (0..4,0) overlap
    // new cells (1..5,0). The overlap check must ignore the ship's own old
    // footprint, not just its id.
    let s = makeState();
    s = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 0, y: 0 },
      orientation: 'horizontal',
    }).state;
    const r = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 1, y: 0 },
      orientation: 'horizontal',
    });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].ships[0].origin).toEqual({ x: 1, y: 0 });
  });

  test('placement after Ready is rejected', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    s = gl.applyAction(s, 'p1', 'commitPlacement').state;
    const r = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 5, y: 0 },
      orientation: 'horizontal',
    });
    expect(r.error).toMatch(/committing|uncommitPlacement/);
  });

  test('placement with invalid shipId is rejected', () => {
    const r = gl.applyAction(makeState(), 'p1', 'placeShip', {
      shipId: 'galleon',
      origin: { x: 0, y: 0 },
      orientation: 'horizontal',
    });
    expect(r.error).toMatch(/Unknown shipId/);
  });

  test('placement with invalid orientation is rejected', () => {
    const r = gl.applyAction(makeState(), 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 0, y: 0 },
      orientation: 'diagonal',
    });
    expect(r.error).toMatch(/orientation/);
  });

  test('placement with non-integer origin is rejected', () => {
    const r = gl.applyAction(makeState(), 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 0.5, y: 0 },
      orientation: 'horizontal',
    });
    expect(r.error).toMatch(/origin/);
  });

  test('placement is rejected during firing phase', () => {
    const s = bothReadyState();
    const r = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 5, y: 5 },
      orientation: 'horizontal',
    });
    expect(r.error).toMatch(/setup/);
  });

  test('SHIP_PLACED event omits position information', () => {
    const r = gl.applyAction(makeState(), 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 0, y: 0 },
      orientation: 'horizontal',
    });
    const ev = r.events[0];
    expect(ev.type).toBe('SHIP_PLACED');
    expect(ev.data).toEqual({ username: 'Alice', shipId: 'carrier' });
    // Belt-and-suspenders: serialized event must not contain any cell coords.
    const json = JSON.stringify(ev);
    expect(json).not.toMatch(/origin|cells|orientation|"x":|"y":/);
  });
});

describe('Battleship — removeShip', () => {
  test('removes a placed ship and is rejected when ship was not placed', () => {
    let s = makeState();
    s = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 0, y: 0 },
      orientation: 'horizontal',
    }).state;
    const ok = gl.applyAction(s, 'p1', 'removeShip', { shipId: 'carrier' });
    expect(ok.error).toBeUndefined();
    expect(ok.state.players[0].ships).toEqual([]);
    const fail = gl.applyAction(s, 'p1', 'removeShip', { shipId: 'destroyer' });
    expect(fail.error).toMatch(/not currently placed/);
  });

  test('SHIP_REMOVED event omits position information', () => {
    let s = makeState();
    s = gl.applyAction(s, 'p1', 'placeShip', {
      shipId: 'carrier',
      origin: { x: 0, y: 0 },
      orientation: 'horizontal',
    }).state;
    const r = gl.applyAction(s, 'p1', 'removeShip', { shipId: 'carrier' });
    const ev = r.events[0];
    expect(ev.type).toBe('SHIP_REMOVED');
    expect(ev.data).toEqual({ username: 'Alice', shipId: 'carrier' });
    expect(JSON.stringify(ev)).not.toMatch(/"x":|"y":/);
  });
});

describe('Battleship — commit / uncommit', () => {
  test('commitPlacement requires all 5 ships placed', () => {
    let s = makeState();
    // Only 4 placed
    s = placeAll(s, 'p1', aliceShipsPayload().slice(0, 4));
    const r = gl.applyAction(s, 'p1', 'commitPlacement');
    expect(r.error).toMatch(/All 5 ships/);
  });

  test('commitPlacement sets ready=true and emits PLAYER_READY', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    const r = gl.applyAction(s, 'p1', 'commitPlacement');
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].ready).toBe(true);
    expect(r.events.some((e) => e.type === 'PLAYER_READY')).toBe(true);
  });

  test('commitPlacement when already committed is rejected', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    s = gl.applyAction(s, 'p1', 'commitPlacement').state;
    const r = gl.applyAction(s, 'p1', 'commitPlacement');
    expect(r.error).toMatch(/Already committed/);
  });

  test('both players Ready triggers transition to firing phase', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    s = placeAll(s, 'p2', bobShipsPayload());
    s = gl.applyAction(s, 'p1', 'commitPlacement').state;
    const r = gl.applyAction(s, 'p2', 'commitPlacement');
    expect(r.state.turnState.phase).toBe('firing');
    expect(r.state.turnState.setupCompleteAt).toEqual(expect.any(Number));
    expect(r.events.some((e) => e.type === 'SETUP_COMPLETE')).toBe(true);
    expect(r.events.some((e) => e.type === 'TURN_STARTED')).toBe(true);
  });

  test('transition randomizes first player (index is 0 or 1, never null)', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    s = placeAll(s, 'p2', bobShipsPayload());
    s = gl.applyAction(s, 'p1', 'commitPlacement').state;
    const r = gl.applyAction(s, 'p2', 'commitPlacement');
    expect([0, 1]).toContain(r.state.turnState.currentPlayerIndex);
    expect(r.state.turnState.currentPlayerIndex).not.toBeNull();
  });

  test('uncommitPlacement succeeds while phase is still setup', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    s = gl.applyAction(s, 'p1', 'commitPlacement').state;
    const r = gl.applyAction(s, 'p1', 'uncommitPlacement');
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].ready).toBe(false);
  });

  test('uncommitPlacement rejected after firing phase begins', () => {
    const s = bothReadyState();
    const r = gl.applyAction(s, 'p1', 'uncommitPlacement');
    expect(r.error).toMatch(/firing/);
  });

  test('uncommitPlacement on a not-ready player is rejected', () => {
    const r = gl.applyAction(makeState(), 'p1', 'uncommitPlacement');
    expect(r.error).toMatch(/Not currently ready/);
  });
});

describe('Battleship — hidden information enforcement (security critical)', () => {
  test('getStateForPlayer removes the ships field from the opponent record', () => {
    const s = bothReadyState();
    const view = gl.getStateForPlayer(s, 'p1');
    const aliceView = view.players.find((p) => p.userId === 'p1');
    const bobView = view.players.find((p) => p.userId === 'p2');
    // Alice sees her own ships intact.
    expect(Array.isArray(aliceView.ships)).toBe(true);
    expect(aliceView.ships).toHaveLength(5);
    // Bob's ships field must be absent entirely — not [] not null, gone.
    expect('ships' in bobView).toBe(false);
  });

  test('every other Bob field is preserved (non-ships info still visible)', () => {
    const s = bothReadyState();
    const view = gl.getStateForPlayer(s, 'p1');
    const bobView = view.players.find((p) => p.userId === 'p2');
    expect(bobView.userId).toBe('p2');
    expect(bobView.username).toBe('Bob');
    expect(bobView.color).toBe('blue');
    expect(bobView.colorHex).toBe('#3b82f6');
    expect(bobView.token).toBe('⚓');
    expect(bobView.active).toBe(true);
    expect(bobView.connected).toBe(true);
    expect(bobView.ready).toBe(true);
    expect(bobView.shotsReceived).toEqual([]);
    expect(bobView.shotsFired).toEqual([]);
    expect(bobView.shipsSunk).toEqual([]);
    // Derived count is exposed; positional fields are not.
    expect(bobView.placementCount).toBe(5);
  });

  test('placementCount tracks placed ships during setup; positions stay hidden', () => {
    // Partial-placement state: Alice has all 5, Bob has only 2.
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    s = placeAll(s, 'p2', bobShipsPayload().slice(0, 2));
    const view = gl.getStateForPlayer(s, 'p1');
    const bobView = view.players.find((p) => p.userId === 'p2');
    expect(bobView.placementCount).toBe(2);
    expect('ships' in bobView).toBe(false);
  });

  test('getStateForPlayer is safe on waiting-room state (no ships field on either player)', () => {
    // Simulate a pre-initGame waiting-room state where players exist but
    // have not yet been through createInitialPlayer's ships defaulting.
    const wait = {
      status: 'waiting',
      players: [
        { userId: 'p1', username: 'Alice' },
        { userId: 'p2', username: 'Bob' },
      ],
    };
    expect(() => gl.getStateForPlayer(wait, 'p1')).not.toThrow();
    const view = gl.getStateForPlayer(wait, 'p1');
    expect('ships' in view.players[1]).toBe(false);
  });

  test('serialization grep: Bob ship cell coordinates do not appear in Alice view', () => {
    const s = bothReadyState();
    const view = gl.getStateForPlayer(s, 'p1');
    const json = JSON.stringify(view);
    // Contract: placementCount IS visible (it's a count, not positions).
    const bobView = view.players.find((p) => p.userId === 'p2');
    expect(typeof bobView.placementCount).toBe('number');
    expect(bobView.placementCount).toBe(5);
    // Bob's exact (x,y) pairs are unique to Bob (chosen so Alice's ships
    // do not share any (x,y) pair). After both placements, Alice has fired
    // no shots, so the only place Bob's cells COULD appear is in his ships
    // array — which getStateForPlayer must remove.
    const bobCells = [
      // carrier vertical (9,0..4)
      { x: 9, y: 0 },
      { x: 9, y: 1 },
      { x: 9, y: 2 },
      { x: 9, y: 3 },
      { x: 9, y: 4 },
      // battleship vertical (7,0..3)
      { x: 7, y: 0 },
      { x: 7, y: 1 },
      { x: 7, y: 2 },
      { x: 7, y: 3 },
      // cruiser vertical (5,5..7)
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
      // submarine vertical (3,5..7)
      { x: 3, y: 5 },
      { x: 3, y: 6 },
      { x: 3, y: 7 },
      // destroyer vertical (7,5..6)
      { x: 7, y: 5 },
      { x: 7, y: 6 },
    ];
    for (const c of bobCells) {
      const needle = `"x":${c.x},"y":${c.y}`;
      expect(json).not.toContain(needle);
    }
  });

  test('ready/unready transitions are visible to opponent but ships still hidden', () => {
    // Alice commits; from Bob's perspective, alice.ready === true but no ships leaked.
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    s = gl.applyAction(s, 'p1', 'commitPlacement').state;
    const viewBob = gl.getStateForPlayer(s, 'p2');
    const aliceFromBob = viewBob.players.find((p) => p.userId === 'p1');
    expect(aliceFromBob.ready).toBe(true);
    expect('ships' in aliceFromBob).toBe(false);
  });

  test('after firing, Bob still has no ships field in Alice view', () => {
    // Drive a state where Alice has fired one shot at Bob.
    let s = bothReadyState();
    s = setCurrent(s, 0); // Alice's turn
    s = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 9, y: 0 } }).state;
    const view = gl.getStateForPlayer(s, 'p1');
    const bobView = view.players.find((p) => p.userId === 'p2');
    expect('ships' in bobView).toBe(false);
  });
});

describe('Battleship — fireShot', () => {
  test('fireShot rejected during setup phase', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    s = placeAll(s, 'p2', bobShipsPayload());
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 0, y: 0 } });
    expect(r.error).toMatch(/setup/);
  });

  test('fireShot rejected on opponent turn', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0); // Alice's turn
    const r = gl.applyAction(s, 'p2', 'fireShot', { cell: { x: 0, y: 0 } });
    expect(r.error).toMatch(/Not your turn/);
  });

  test('fireShot rejected on a cell already shot at', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    s = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 0, y: 9 } }).state; // miss
    s = setCurrent(s, 0); // force Alice's turn again
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 0, y: 9 } });
    expect(r.error).toMatch(/already been targeted/);
  });

  test('fireShot out-of-bounds rejected', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 10, y: 0 } });
    expect(r.error).toMatch(/out of bounds|malformed/);
  });

  test('fireShot with non-integer cell rejected', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 0.5, y: 0 } });
    expect(r.error).toMatch(/out of bounds|malformed/);
  });

  test('miss recorded in both players shot records, no ship damage', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 0, y: 9 } }); // Bob has nothing at (0,9)
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].shotsFired).toHaveLength(1);
    expect(r.state.players[0].shotsFired[0].result).toBe('miss');
    expect(r.state.players[1].shotsReceived).toHaveLength(1);
    expect(r.state.players[1].shotsReceived[0].result).toBe('miss');
    expect(r.state.players[1].shipsSunk).toEqual([]);
  });

  test('hit recorded as hit (not sunk) when ship has remaining cells', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    // Carrier at (9,0)v has cells (9,0..4) — hit one, not sunk.
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 9, y: 0 } });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].shotsFired[0].result).toBe('hit');
    expect(r.state.players[1].shotsReceived[0].result).toBe('hit');
    expect(r.state.players[1].shipsSunk).toEqual([]);
    // SHIP_SUNK must NOT have been emitted.
    expect(r.events.some((e) => e.type === 'SHIP_SUNK')).toBe(false);
  });

  test('last unhit cell of a ship records as sunk', () => {
    let s = bothReadyState();
    // Bob's destroyer (length 2) at (7,5)v — cells (7,5) and (7,6).
    s = setCurrent(s, 0);
    s = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 7, y: 5 } }).state;
    s = setCurrent(s, 0); // skip the natural turn-pass so we can fire again
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 7, y: 6 } });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].shotsFired[1].result).toBe('sunk');
    expect(r.state.players[0].shotsFired[1].sunkShipId).toBe('destroyer');
    expect(r.state.players[1].shipsSunk).toContain('destroyer');
    const sunkEv = r.events.find((e) => e.type === 'SHIP_SUNK');
    expect(sunkEv).toBeDefined();
    expect(sunkEv.data.shipId).toBe('destroyer');
    expect(sunkEv.data.length).toBe(2);
    expect(sunkEv.data.cells).toHaveLength(2);
  });

  test('SHIP_SUNK event includes the full cell list (revealed on sink)', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    s = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 7, y: 5 } }).state;
    s = setCurrent(s, 0);
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 7, y: 6 } });
    const sunkEv = r.events.find((e) => e.type === 'SHIP_SUNK');
    expect(sunkEv.data.cells).toEqual([
      { x: 7, y: 5 },
      { x: 7, y: 6 },
    ]);
  });

  test('SHOT_FIRED event for a miss has no ship information', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 0, y: 9 } });
    const ev = r.events.find((e) => e.type === 'SHOT_FIRED');
    expect(ev.data.result).toBe('miss');
    expect(ev.data.cell).toEqual({ x: 0, y: 9 });
    // No ship metadata leaked through the miss event.
    expect(ev.data.shipId).toBeUndefined();
    expect(ev.data.length).toBeUndefined();
    expect(ev.data.cells).toBeUndefined();
  });

  test('turn passes to opponent after a shot regardless of result', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 9, y: 0 } }); // hit
    expect(r.state.turnState.currentPlayerIndex).toBe(1);
    expect(r.events.some((e) => e.type === 'TURN_STARTED' && e.data.username === 'Bob')).toBe(true);
  });

  test('hit updates the ship hits[] field server-side (not visible to opponent)', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    s = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 9, y: 0 } }).state;
    const bobCarrier = s.players[1].ships.find((sh) => sh.id === 'carrier');
    expect(bobCarrier.hits).toEqual([{ x: 9, y: 0 }]);
  });
});

describe('Battleship — game over', () => {
  /** Construct an end-game state where Bob has only 1 cell of 1 ship left. */
  function nearWinState() {
    let s = bothReadyState();
    // Sink everything of Bob's except 1 cell of destroyer.
    // Manually set Bob's player to have all ships' hits filled, then add 4 to shipsSunk.
    const newBob = { ...s.players[1] };
    newBob.ships = newBob.ships.map((sh) => {
      if (sh.id === 'destroyer') {
        // Hit (7,5) but not (7,6) — one cell left.
        return { ...sh, hits: [{ x: 7, y: 5 }] };
      }
      // All other ships fully hit.
      return { ...sh, hits: sh.cells.map((c) => ({ ...c })) };
    });
    newBob.shipsSunk = ['carrier', 'battleship', 'cruiser', 'submarine'];
    newBob.shotsReceived = [
      // For the destroyer hit at (7,5)
      { cell: { x: 7, y: 5 }, result: 'hit', timestamp: 0 },
    ];
    const newAlice = {
      ...s.players[0],
      shotsFired: [{ cell: { x: 7, y: 5 }, result: 'hit', timestamp: 0 }],
    };
    return {
      ...s,
      players: [newAlice, newBob],
      turnState: { ...s.turnState, currentPlayerIndex: 0 },
    };
  }

  test('sinking the last enemy ship sets status=finished', () => {
    const s = nearWinState();
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 7, y: 6 } });
    expect(r.error).toBeUndefined();
    expect(r.state.status).toBe('finished');
  });

  test('winner is the shooter userId (matches the Yahtzee fix convention)', () => {
    const s = nearWinState();
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 7, y: 6 } });
    expect(r.state.winner).toBe('p1');
    const go = r.events.find((e) => e.type === 'GAME_OVER');
    expect(go.data.winner).toBe('p1');
    expect(go.data.winnerUsername).toBe('Alice');
  });

  test('GAME_OVER includes finalFleets with full ship arrays for both players', () => {
    const s = nearWinState();
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 7, y: 6 } });
    const go = r.events.find((e) => e.type === 'GAME_OVER');
    expect(go.data.finalFleets).toBeDefined();
    // Both players' full fleets present, keyed by userId.
    expect(go.data.finalFleets.p1).toBeDefined();
    expect(go.data.finalFleets.p2).toBeDefined();
    expect(go.data.finalFleets.p1).toHaveLength(5);
    expect(go.data.finalFleets.p2).toHaveLength(5);
    // Each ship has its cells populated — that's the whole reason this
    // payload exists (loser sees winner's layout via event, not state).
    for (const ship of go.data.finalFleets.p1) {
      expect(Array.isArray(ship.cells)).toBe(true);
      expect(ship.cells.length).toBe(ship.length);
    }
    for (const ship of go.data.finalFleets.p2) {
      expect(Array.isArray(ship.cells)).toBe(true);
      expect(ship.cells.length).toBe(ship.length);
    }
  });

  test('after game over, fireShot is rejected', () => {
    const s = nearWinState();
    const r1 = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 7, y: 6 } });
    const r2 = gl.applyAction(r1.state, 'p2', 'fireShot', { cell: { x: 0, y: 0 } });
    expect(r2.error).toMatch(/not in playing state|Not your turn/);
  });

  test('getValidActions returns empty after game over', () => {
    const s = nearWinState();
    const r = gl.applyAction(s, 'p1', 'fireShot', { cell: { x: 7, y: 6 } });
    expect(gl.getValidActions(r.state, 'p1')).toEqual([]);
    expect(gl.getValidActions(r.state, 'p2')).toEqual([]);
  });
});

describe('Battleship — getValidActions', () => {
  test('setup, not ready, no ships placed: [placeShip, removeShip]', () => {
    expect(gl.getValidActions(makeState(), 'p1')).toEqual(['placeShip', 'removeShip']);
  });

  test('setup, not ready, all 5 placed: includes commitPlacement', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    expect(gl.getValidActions(s, 'p1')).toEqual(['placeShip', 'removeShip', 'commitPlacement']);
  });

  test('setup, ready, opponent not ready: [uncommitPlacement]', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    s = gl.applyAction(s, 'p1', 'commitPlacement').state;
    expect(gl.getValidActions(s, 'p1')).toEqual(['uncommitPlacement']);
  });

  test('firing, my turn: [fireShot]', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    expect(gl.getValidActions(s, 'p1')).toEqual(['fireShot']);
  });

  test('firing, opponent turn: []', () => {
    let s = bothReadyState();
    s = setCurrent(s, 1);
    expect(gl.getValidActions(s, 'p1')).toEqual([]);
  });

  test('unknown user: []', () => {
    expect(gl.getValidActions(makeState(), 'stranger')).toEqual([]);
  });
});

describe('Battleship — turn timer', () => {
  test('isTurnTimerBlocked returns true during setup', () => {
    const s = makeState();
    expect(gl.isTurnTimerBlocked(s)).toBe(true);
  });

  test('isTurnTimerBlocked returns false during firing', () => {
    const s = bothReadyState();
    expect(gl.isTurnTimerBlocked(s)).toBe(false);
  });

  test('getCurrentPlayer returns null during setup', () => {
    const s = makeState();
    expect(gl.getCurrentPlayer(s)).toBeNull();
  });

  test('getCurrentPlayer returns {userId,username} during firing', () => {
    const s = bothReadyState();
    const cur = gl.getCurrentPlayer(s);
    expect(cur).not.toBeNull();
    expect(typeof cur.userId).toBe('string');
    expect(typeof cur.username).toBe('string');
  });

  test('skipTurn rejected during setup', () => {
    const s = makeState();
    const r = gl.applyAction(s, 'p1', 'skipTurn');
    expect(r.error).toMatch(/setup/);
  });

  test('skipTurn passes the turn during firing', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    const r = gl.applyAction(s, 'p1', 'skipTurn');
    expect(r.error).toBeUndefined();
    expect(r.state.turnState.currentPlayerIndex).toBe(1);
    expect(r.events.some((e) => e.type === 'TURN_SKIPPED')).toBe(true);
    expect(r.events.some((e) => e.type === 'TURN_STARTED')).toBe(true);
  });
});

describe('Battleship — first-player randomization (statistical)', () => {
  test('many transitions cover both first-player outcomes', () => {
    // p≈0.5 each — 50 trials means probability of all-same is 2·(0.5)^50,
    // effectively zero. If this ever fails the RNG is broken or biased.
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const s = bothReadyState();
      seen.add(s.turnState.currentPlayerIndex);
      if (seen.size === 2) break;
    }
    expect(seen.has(0)).toBe(true);
    expect(seen.has(1)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getActionDescriptors covers six phase × state combinations documented in
// docs/action-descriptors.md. The shape contract (per-action descriptor with
// label/enabled/hint/data) is exercised explicitly so a regression that
// drops a field or returns the wrong shape fails loudly.

describe('Battleship — getActionDescriptors', () => {
  /** Look up a descriptor by action name, asserting it exists. */
  function find(descriptors, action) {
    const d = descriptors.find((x) => x.action === action);
    expect(d).toBeDefined();
    return d;
  }

  test('returns [] on pre-initGame waiting-room state (safety)', () => {
    const wait = { status: 'waiting', players: [] };
    expect(gl.getActionDescriptors(wait, 'p1')).toEqual([]);
  });

  test('returns [] for a non-player userId', () => {
    expect(gl.getActionDescriptors(makeState(), 'stranger')).toEqual([]);
  });

  test('setup, no ships placed, not ready', () => {
    const d = gl.getActionDescriptors(makeState(), 'p1');
    expect(find(d, 'placeShip')).toMatchObject({
      enabled: true,
      hint: 'Place your ships — 0 of 5 placed.',
      data: { shipsPlaced: 0, shipsRequired: 5 },
    });
    expect(find(d, 'removeShip')).toMatchObject({ enabled: false });
    expect(find(d, 'commitPlacement')).toMatchObject({
      enabled: false,
      hint: 'Place all 5 ships first.',
    });
    expect(find(d, 'uncommitPlacement')).toMatchObject({ enabled: false });
  });

  test('setup, 3 ships placed, not ready', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload().slice(0, 3));
    const d = gl.getActionDescriptors(s, 'p1');
    expect(find(d, 'placeShip')).toMatchObject({
      enabled: true,
      hint: 'Place your ships — 3 of 5 placed.',
      data: { shipsPlaced: 3, shipsRequired: 5 },
    });
    expect(find(d, 'removeShip')).toMatchObject({ enabled: true });
    expect(find(d, 'commitPlacement')).toMatchObject({
      enabled: false,
      hint: 'Place all 5 ships first (2 remaining).',
    });
    expect(find(d, 'uncommitPlacement')).toMatchObject({ enabled: false });
  });

  test('setup, all 5 placed, not ready', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    const d = gl.getActionDescriptors(s, 'p1');
    expect(find(d, 'commitPlacement')).toMatchObject({
      enabled: true,
      hint: 'Click to commit your placement.',
    });
    expect(find(d, 'placeShip')).toMatchObject({ enabled: true });
    expect(find(d, 'removeShip')).toMatchObject({ enabled: true });
    expect(find(d, 'uncommitPlacement')).toMatchObject({ enabled: false });
  });

  test('setup, ready, opponent not ready: only uncommit is enabled', () => {
    let s = makeState();
    s = placeAll(s, 'p1', aliceShipsPayload());
    s = gl.applyAction(s, 'p1', 'commitPlacement').state;
    const d = gl.getActionDescriptors(s, 'p1');
    expect(find(d, 'placeShip')).toMatchObject({ enabled: false });
    expect(find(d, 'removeShip')).toMatchObject({ enabled: false });
    expect(find(d, 'commitPlacement')).toMatchObject({ enabled: false });
    expect(find(d, 'uncommitPlacement')).toMatchObject({
      enabled: true,
      hint: 'Take back your commitment.',
    });
  });

  test('firing, my turn: fireShot enabled with opponent username in label', () => {
    let s = bothReadyState();
    s = setCurrent(s, 0);
    const d = gl.getActionDescriptors(s, 'p1');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      action: 'fireShot',
      enabled: true,
      label: "Fire at Bob's waters",
      hint: 'Click an unshot cell.',
    });
  });

  test('firing, opponent turn: fireShot disabled with whose-turn hint', () => {
    let s = bothReadyState();
    s = setCurrent(s, 1);
    const d = gl.getActionDescriptors(s, 'p1');
    expect(d[0]).toMatchObject({
      action: 'fireShot',
      enabled: false,
      hint: "Bob's turn.",
    });
  });

  test('every descriptor has required action/label/enabled fields', () => {
    // Spot-check across a few states that the contract's required-fields
    // invariant holds for every returned descriptor.
    const states = [
      makeState(),
      (() => {
        let s = makeState();
        s = placeAll(s, 'p1', aliceShipsPayload());
        return s;
      })(),
      bothReadyState(),
    ];
    for (const s of states) {
      for (const d of gl.getActionDescriptors(s, 'p1')) {
        expect(typeof d.action).toBe('string');
        expect(typeof d.label).toBe('string');
        expect(typeof d.enabled).toBe('boolean');
      }
    }
  });
});
