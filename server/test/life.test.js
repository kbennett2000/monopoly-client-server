'use strict';

const gl = require('../games/life/game-logic');
const configLoader = require('../games/life/config-loader');

// ── fixtures ──────────────────────────────────────────────────────────────────

const CFG = gl.getConfigCopy();

function makeUsers(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: `u${i + 1}`, username: `P${i + 1}` });
  return out;
}

function makeGame(n = 2) {
  const users = makeUsers(n);
  const players = users.map((u, i, all) =>
    gl.createInitialPlayer(u, all.slice(0, i), gl.getConfigCopy()),
  );
  return gl.initGame('g1', 'Test', players, gl.getConfigCopy());
}

/**
 * Drive a single player past the Career-vs-College fork, the career-card
 * draw, and the salary-card draw — leaving them on their first-path square
 * with their first turn just ended.  Used by tests that want a player who
 * has finished their setup but hasn't started spinning yet.
 *
 * Returns the post-resolution state.  Throws if any step errored.
 */
function completeFirstTurn(state, userId, branchId = 'sq-c01-career-pick') {
  let r = gl.applyAction(state, userId, 'chooseBranch', { nextSquareId: branchId });
  if (r.error) throw new Error(`chooseBranch failed: ${r.error}`);
  state = r.state;
  const player = state.players.find((p) => p.userId === userId);
  r = gl.applyAction(state, userId, 'chooseCareer', { cardId: player.pendingCareerDrawOptions[0] });
  if (r.error) throw new Error(`chooseCareer failed: ${r.error}`);
  state = r.state;
  const p2 = state.players.find((p) => p.userId === userId);
  r = gl.applyAction(state, userId, 'chooseSalary', { cardId: p2.pendingSalaryDrawOptions[0] });
  if (r.error) throw new Error(`chooseSalary failed: ${r.error}`);
  return r.state;
}

/** Force the current player's position to `squareId` (test-only). */
function placePlayerAt(state, userId, squareId) {
  return {
    ...state,
    players: state.players.map((p) => (p.userId === userId ? { ...p, position: squareId } : p)),
  };
}

/** Replace the turn state so `userId` is the current player. */
function setCurrent(state, userId) {
  const idx = state.players.findIndex((p) => p.userId === userId);
  return { ...state, turnState: { ...state.turnState, currentPlayerIndex: idx } };
}

/** Run `fn` with Math.random pinned so spins return `value` deterministically. */
function withSpin(value, fn) {
  const orig = Math.random;
  const range = CFG.settings.spinMax - CFG.settings.spinMin + 1;
  // We want floor(r * range) + spinMin === value  →  r = (value - spinMin) / range
  // Pick the midpoint of that bucket so floating-point noise can't push us off by one.
  const r = (value - CFG.settings.spinMin + 0.5) / range;
  Math.random = () => r;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — metadata', () => {
  test('module loads without throwing', () => {
    expect(() => require('../games/life/game-logic')).not.toThrow();
  });

  test('metadata reports 2-6 players, medium complexity, branching-board tag', () => {
    const m = gl.getGameMetadata();
    expect(m.minPlayers).toBe(2);
    expect(m.maxPlayers).toBe(6);
    expect(m.complexity).toBe('medium');
    expect(m.tags).toContain('branching-board');
    expect(m.tags).toContain('spinner');
  });

  test('estimatedDurationMinutes is a positive number', () => {
    const m = gl.getGameMetadata();
    expect(typeof m.estimatedDurationMinutes).toBe('number');
    expect(m.estimatedDurationMinutes).toBeGreaterThan(0);
  });

  test('name set to "The Game of Life"', () => {
    expect(gl.getGameMetadata().name).toBe('The Game of Life');
  });

  test('STATE_VERSION exported as a positive integer', () => {
    expect(Number.isInteger(gl.STATE_VERSION)).toBe(true);
    expect(gl.STATE_VERSION).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — initGame', () => {
  test('sets gameType=life and status=playing', () => {
    const s = makeGame();
    expect(s.gameType).toBe('life');
    expect(s.status).toBe('playing');
  });

  test('stamps stateVersion to match module constant', () => {
    expect(makeGame().stateVersion).toBe(gl.STATE_VERSION);
  });

  test('all players start at the configured start square', () => {
    const s = makeGame(4);
    for (const p of s.players) expect(p.position).toBe(CFG.settings.startSquareId);
  });

  test('each player starts with starting cash, null path, no career or salary', () => {
    const s = makeGame(3);
    for (const p of s.players) {
      expect(p.cash).toBe(CFG.settings.startingCash);
      expect(p.path).toBeNull();
      expect(p.career).toBeNull();
      expect(p.salary).toBeNull();
    }
  });

  test('every player begins with the Career-vs-College fork pending', () => {
    const s = makeGame(2);
    for (const p of s.players) {
      expect(p.pendingForkChoice).toEqual(['sq-c01-career-pick', 'sq-u01-college-loan']);
    }
  });

  test('career and salary decks are initialised to the full config card sets', () => {
    const s = makeGame();
    expect(s.careerDeck).toHaveLength(CFG.careers.length);
    expect(s.salaryDeck).toHaveLength(CFG.salaries.length);
    expect(s.careerDiscard).toEqual([]);
    expect(s.salaryDiscard).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — createInitialPlayer', () => {
  test('throws when called without a config containing playerColors/playerTokens', () => {
    expect(() => gl.createInitialPlayer({ id: 'u', username: 'X' }, [], null)).toThrow(
      /playerColors/,
    );
    expect(() => gl.createInitialPlayer({ id: 'u', username: 'X' }, [], { settings: {} })).toThrow(
      /playerColors/,
    );
  });

  test('assigns the next colour/token slot to each new player', () => {
    const cfg = gl.getConfigCopy();
    const a = gl.createInitialPlayer({ id: 'a', username: 'A' }, [], cfg);
    const b = gl.createInitialPlayer({ id: 'b', username: 'B' }, [a], cfg);
    expect(a.color).toBe(cfg.settings.playerColors[0].id);
    expect(b.color).toBe(cfg.settings.playerColors[1].id);
    expect(a.token).toBe(cfg.settings.playerTokens[0]);
    expect(b.token).toBe(cfg.settings.playerTokens[1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — getCurrentPlayer / isTurnTimerBlocked / getValidActions', () => {
  test('getCurrentPlayer returns the active player at game start', () => {
    const s = makeGame();
    expect(gl.getCurrentPlayer(s)).toEqual({ userId: 'u1', username: 'P1' });
  });

  test('isTurnTimerBlocked is true while a fork choice is pending', () => {
    expect(gl.isTurnTimerBlocked(makeGame())).toBe(true);
  });

  test('getValidActions returns only chooseBranch while a fork is pending', () => {
    const s = makeGame();
    expect(gl.getValidActions(s, 'u1')).toEqual(['chooseBranch']);
    // Other players still see no valid actions even though they too have the
    // start-fork pending — only the current player can act.
    expect(gl.getValidActions(s, 'u2')).toEqual([]);
  });

  test('getValidActions returns chooseCareer when a career draw is pending', () => {
    const r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-c01-career-pick',
    });
    expect(gl.getValidActions(r.state, 'u1')).toEqual(['chooseCareer']);
  });

  test('getValidActions returns spin once setup is complete', () => {
    const s = completeFirstTurn(makeGame(), 'u1');
    // Setup ended u1's turn; u2 is current and still has the start fork.
    expect(gl.getValidActions(s, 'u1')).toEqual([]);
    expect(gl.getValidActions(s, 'u2')).toEqual(['chooseBranch']);
  });

  test('isTurnTimerBlocked is false once no choices are pending', () => {
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    expect(gl.isTurnTimerBlocked(s)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — chooseBranch', () => {
  test('records path=career when player picks the career branch', () => {
    const r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-c01-career-pick',
    });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].path).toBe('career');
    expect(r.state.players[0].position).toBe('sq-c01-career-pick');
  });

  test('records path=college when player picks the college branch', () => {
    const r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-u01-college-loan',
    });
    expect(r.state.players[0].path).toBe('college');
    expect(r.state.players[0].position).toBe('sq-u01-college-loan');
  });

  test('rejects branch IDs not in the pending options list', () => {
    const r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', { nextSquareId: 'sq-c05-payday' });
    expect(r.error).toMatch(/Invalid branch/);
    // Original state unchanged
    expect(r.state.players[0].position).toBe('sq-000-start');
    expect(r.state.players[0].pendingForkChoice).not.toBeNull();
  });

  test('rejects chooseBranch when no fork is pending', () => {
    const s = completeFirstTurn(makeGame(), 'u1');
    // u1 has completed setup; u2 is current with a pending fork.  Calling
    // chooseBranch as u1 (not the current player) is rejected.
    const r = gl.applyAction(s, 'u1', 'chooseBranch', { nextSquareId: 'sq-c01-career-pick' });
    expect(r.error).toMatch(/Not your turn/);
  });

  test('college branch pays the loan immediately, leaving cash possibly negative', () => {
    const r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-u01-college-loan',
    });
    expect(r.state.players[0].cash).toBe(
      CFG.settings.startingCash - CFG.settings.collegeLoanAmount,
    );
    expect(r.state.players[0].cash).toBeLessThan(0);
  });

  test('emits BRANCH_CHOSEN, PLAYER_MOVED, and the destination square effect events', () => {
    const r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-c01-career-pick',
    });
    const types = r.events.map((e) => e.type);
    expect(types).toContain('BRANCH_CHOSEN');
    expect(types).toContain('PLAYER_MOVED');
    expect(types).toContain('CAREER_DRAW_OPTIONS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — career and salary draws', () => {
  test('landing on draw-career-no-degree only offers no-degree careers', () => {
    const r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-c01-career-pick',
    });
    const careersById = Object.fromEntries(CFG.careers.map((c) => [c.id, c]));
    for (const id of r.state.players[0].pendingCareerDrawOptions) {
      expect(careersById[id].degreeRequired).toBe(false);
    }
  });

  test('landing on draw-career-degree only offers degree-required careers', () => {
    let s = makeGame();
    let r = gl.applyAction(s, 'u1', 'chooseBranch', { nextSquareId: 'sq-u01-college-loan' });
    s = r.state;
    // Walk through college path until we hit the draw-career-degree square.
    // The post-loan square sequence is configured; force-place is simpler.
    s = placePlayerAt(s, 'u1', 'sq-u08-graduate'); // one square before draw-career-degree
    s = setCurrent(s, 'u1');
    // Make sure path is preserved, then spin 1 to land on sq-u09-career-pick.
    r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.error).toBeUndefined();
    const opts = r.state.players[0].pendingCareerDrawOptions;
    expect(opts.length).toBeGreaterThan(0);
    const careersById = Object.fromEntries(CFG.careers.map((c) => [c.id, c]));
    for (const id of opts) expect(careersById[id].degreeRequired).toBe(true);
  });

  test('chooseCareer writes the chosen card to player.career and chains into salary draw', () => {
    let s = makeGame();
    let r = gl.applyAction(s, 'u1', 'chooseBranch', { nextSquareId: 'sq-c01-career-pick' });
    s = r.state;
    const choice = s.players[0].pendingCareerDrawOptions[1];
    r = gl.applyAction(s, 'u1', 'chooseCareer', { cardId: choice });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].career.id).toBe(choice);
    expect(r.state.players[0].pendingCareerDrawOptions).toBeNull();
    expect(r.state.players[0].pendingSalaryDrawOptions).not.toBeNull();
    expect(r.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['CAREER_CHOSEN', 'SALARY_DRAW_OPTIONS']),
    );
  });

  test('chooseCareer with an invalid card ID is rejected', () => {
    let r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-c01-career-pick',
    });
    r = gl.applyAction(r.state, 'u1', 'chooseCareer', { cardId: 'career-not-real' });
    expect(r.error).toMatch(/Invalid career/);
  });

  test('chooseSalary writes the salary, clears pending state, and ends the turn', () => {
    let r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-c01-career-pick',
    });
    r = gl.applyAction(r.state, 'u1', 'chooseCareer', {
      cardId: r.state.players[0].pendingCareerDrawOptions[0],
    });
    const salaryChoice = r.state.players[0].pendingSalaryDrawOptions[0];
    r = gl.applyAction(r.state, 'u1', 'chooseSalary', { cardId: salaryChoice });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].salary.id).toBe(salaryChoice);
    expect(r.state.players[0].pendingSalaryDrawOptions).toBeNull();
    expect(r.state.turnState.currentPlayerIndex).toBe(1);
  });

  test('drawOptionsFromDeck reshuffles the discard pile when the deck empties', () => {
    const deck = [];
    const discard = ['a', 'b', 'c'];
    const drawn = gl.drawOptionsFromDeck(deck, discard, 3, () => true);
    expect(drawn.sort()).toEqual(['a', 'b', 'c']);
    expect(discard).toEqual([]);
  });

  test('unchosen draw options return to the deck so a long game can reuse them', () => {
    let r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-c01-career-pick',
    });
    const offered = r.state.players[0].pendingCareerDrawOptions.slice();
    r = gl.applyAction(r.state, 'u1', 'chooseCareer', { cardId: offered[0] });
    // The unchosen offered card should still be present in the careerDeck.
    expect(r.state.careerDeck).toContain(offered[1]);
    expect(r.state.careerDeck).not.toContain(offered[0]); // the chosen card is consumed
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — spinner', () => {
  test('spin always produces a value in [spinMin, spinMax]', () => {
    // Statistical check; not exhaustive of all 10 values but sufficient.
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    for (let i = 0; i < 100; i++) {
      const r = gl.applyAction(s, 'u1', 'spin', {});
      const value = r.events.find((e) => e.type === 'SPINNER_RESULT').data.value;
      expect(value).toBeGreaterThanOrEqual(CFG.settings.spinMin);
      expect(value).toBeLessThanOrEqual(CFG.settings.spinMax);
    }
  });

  test('spin is rejected while a pending choice is open', () => {
    const s = makeGame(); // u1 still has the start fork
    const r = gl.applyAction(s, 'u1', 'spin', {});
    expect(r.error).toMatch(/pending choice/);
  });

  test('spin emits SPINNER_RESULT and PLAYER_MOVED', () => {
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    const r = withSpin(3, () => gl.applyAction(s, 'u1', 'spin', {}));
    const types = r.events.map((e) => e.type);
    expect(types).toContain('SPINNER_RESULT');
    expect(types).toContain('PLAYER_MOVED');
  });

  test('movement follows next[0] at every step (passthrough fork takes next[0])', () => {
    // Place u1 at sq-c08-spin-again and spin a value that would normally
    // chain through several squares.  Each non-fork transition follows
    // next[0] — there are no genuine passthrough forks on the session-1
    // board, so this test mainly demonstrates the chained traversal.
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-c03-first-paycheck');
    const r = withSpin(2, () => gl.applyAction(s, 'u1', 'spin', {}));
    // Two steps: sq-c03 → sq-c04 → sq-c05.
    expect(r.state.players[0].position).toBe('sq-c05-payday');
  });

  test('landing on spin-again does NOT advance the turn', () => {
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-c07-traffic-ticket');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].position).toBe('sq-c08-spin-again');
    expect(r.state.players[0].spinAgain).toBe(true);
    // Still u1's turn.
    expect(r.state.turnState.currentPlayerIndex).toBe(0);
    expect(gl.getValidActions(r.state, 'u1')).toEqual(['spin']);
  });

  test('spin-again chains: a second spin can land on another spin-again square', () => {
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-c07-traffic-ticket');

    // First spin → sq-c08-spin-again
    let r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].spinAgain).toBe(true);

    // Force-place the player one before another spin-again square and spin
    // again — exercises the chaining logic explicitly.
    let s2 = placePlayerAt(r.state, 'u1', 'sq-m11-payday');
    s2 = setCurrent(s2, 'u1');
    r = withSpin(1, () => gl.applyAction(s2, 'u1', 'spin', {}));
    expect(r.state.players[0].position).toBe('sq-m12-spin-again');
    expect(r.state.players[0].spinAgain).toBe(true);
    expect(r.state.turnState.currentPlayerIndex).toBe(0); // still u1
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — effect handlers', () => {
  // Build a state with a current, ready-to-spin player and known cash.
  function readyState(startSquare, startingCash = 50000) {
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', startSquare);
    s.players[0].cash = startingCash;
    return s;
  }

  test('payday credits salary + career bonus', () => {
    const s = readyState('sq-m03-buy-home', 100000);
    // From sq-m03 the next-1 hop lands on sq-m04-payday.
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    const me = r.state.players[0];
    const expected = 100000 + me.salary.amount + (me.career.paydayBonus || 0);
    expect(me.cash).toBe(expected);
    expect(r.events.find((e) => e.type === 'PAYDAY').data.total).toBe(
      me.salary.amount + (me.career.paydayBonus || 0),
    );
  });

  test('pay-bank debits the configured amount', () => {
    const s = readyState('sq-c03-first-paycheck', 50000);
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].position).toBe('sq-c04-buy-car');
    // sq-c04 deducts $5000.
    expect(r.state.players[0].cash).toBe(50000 - 5000);
  });

  test('collect-bank credits the configured amount', () => {
    const s = readyState('sq-c02-pay-furniture', 10000);
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].position).toBe('sq-c03-first-paycheck');
    expect(r.state.players[0].cash).toBe(10000 + 1000);
  });

  test('pay-each-player debits the active player and credits every other active player', () => {
    let s = completeFirstTurn(makeGame(3), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = completeFirstTurn(s, 'u3');
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-m19-payday'); // next-1 → sq-m20-pay-each
    s.players[0].cash = 50000;
    s.players[1].cash = 50000;
    s.players[2].cash = 50000;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].position).toBe('sq-m20-pay-each');
    // pay-each amount is $1000 per other-player.  Active others: 2.
    expect(r.state.players[0].cash).toBe(50000 - 2 * 1000);
    expect(r.state.players[1].cash).toBe(50000 + 1000);
    expect(r.state.players[2].cash).toBe(50000 + 1000);
  });

  test('collect-each-player credits the active player and debits every other active player', () => {
    let s = completeFirstTurn(makeGame(3), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = completeFirstTurn(s, 'u3');
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-m17-auto-accident'); // next-1 → sq-m18-collect-each
    s.players[0].cash = 50000;
    s.players[1].cash = 50000;
    s.players[2].cash = 50000;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].cash).toBe(50000 + 2 * 1000);
    expect(r.state.players[1].cash).toBe(50000 - 1000);
    expect(r.state.players[2].cash).toBe(50000 - 1000);
  });

  test('pay-loans debits the configured collegeLoanAmount', () => {
    const r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-u01-college-loan',
    });
    expect(r.state.players[0].cash).toBe(
      CFG.settings.startingCash - CFG.settings.collegeLoanAmount,
    );
  });

  test('retirement-fork remains stubbed until session 2b', () => {
    // marry / have-baby / have-twins were stubs in session 1 and are real
    // handlers from session 2a onward — see the Session 2a describe blocks.
    // retirement-fork is still a stub; this asserts the stub contract.
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-m34-payday');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    const deferred = r.events.find((e) => e.type === 'SQUARE_EFFECT_DEFERRED');
    expect(deferred).toBeDefined();
    expect(deferred.data.kind).toBe('retirement-fork');
    expect(deferred.data.reason).toBe('session-2b-stub');
    // Stub still bumps to next[0] (countryside-01) for session 2a.
    expect(r.state.players[0].position).toBe('sq-r-countryside-01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — config validation', () => {
  const { _validators } = configLoader;
  const baseSettings = { ...CFG.settings, startSquareId: 'sq-A' };

  test('rejects a board with an unreachable square', () => {
    const board = [
      { id: 'sq-A', type: 'pay-bank', label: 'A', next: [], data: { amount: 1 } },
      { id: 'sq-B', type: 'pay-bank', label: 'B', next: [], data: { amount: 1 } }, // orphan
    ];
    expect(() => _validators.validateBoard(board, baseSettings)).toThrow(/unreachable/);
  });

  test('rejects a board whose next references a nonexistent id', () => {
    const board = [
      { id: 'sq-A', type: 'pay-bank', label: 'A', next: ['sq-Z'], data: { amount: 1 } },
    ];
    expect(() => _validators.validateBoard(board, baseSettings)).toThrow(/unknown id/);
  });

  test('rejects a board whose square has an unknown effect type', () => {
    const board = [{ id: 'sq-A', type: 'mystery', label: 'A', next: [] }];
    expect(() => _validators.validateBoard(board, baseSettings)).toThrow(/unknown effect type/);
  });

  test('rejects a careers deck with a duplicate id', () => {
    const careers = {
      cards: [
        { id: 'a', degreeRequired: true },
        { id: 'a', degreeRequired: false },
      ],
    };
    expect(() => _validators.validateCareers(careers)).toThrow(/duplicate/);
  });

  test('rejects a salaries deck with a duplicate id', () => {
    const salaries = {
      cards: [
        { id: 's1', amount: 10000, taxDue: 1000 },
        { id: 's1', amount: 20000, taxDue: 2000 },
      ],
    };
    expect(() => _validators.validateSalaries(salaries)).toThrow(/duplicate/);
  });

  test('the shipped board.json loads cleanly', () => {
    expect(() => configLoader.loadConfig(true)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — edge cases', () => {
  test('movement past the end of the board stops at the terminal square', () => {
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-r-countryside-01');
    // sq-r-countryside-01 → sq-r-countryside-02 → sq-r-countryside-end (terminal).
    // Spinning a high value should still leave the player on the terminal —
    // not crash, not wrap.
    const r = withSpin(10, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].position).toBe('sq-r-countryside-end');
  });

  test('chooseBranch is rejected when no fork is pending', () => {
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    // u1 is mid-game, no fork pending.
    const r = gl.applyAction(s, 'u1', 'chooseBranch', { nextSquareId: 'sq-c01-career-pick' });
    expect(r.error).toMatch(/No pending fork/);
  });

  test('chooseCareer is rejected when no career draw is pending', () => {
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    const r = gl.applyAction(s, 'u1', 'chooseCareer', { cardId: 'career-doctor' });
    expect(r.error).toMatch(/No pending career/);
  });

  test('negative cash from college loans does NOT block further play', () => {
    let r = gl.applyAction(makeGame(), 'u1', 'chooseBranch', {
      nextSquareId: 'sq-u01-college-loan',
    });
    expect(r.state.players[0].cash).toBeLessThan(0);
    // The player should still have a working turn (now it's u2's), and u1
    // remains marked active.
    expect(r.state.players[0].active).toBe(true);
    expect(r.state.status).toBe('playing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — skipTurn / turn advancement', () => {
  test('skipTurn clears any pending choices and advances to the next player', () => {
    const s = makeGame(); // u1 has a fork pending
    const r = gl.applyAction(s, 'u1', 'skipTurn', {});
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].pendingForkChoice).toBeNull();
    expect(r.state.turnState.currentPlayerIndex).toBe(1);
    expect(r.events.map((e) => e.type)).toContain('TURN_SKIPPED');
  });

  test('endTurn after spin (no pending) is a no-op error — the turn already advanced', () => {
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    const r = withSpin(2, () => gl.applyAction(s, 'u1', 'spin', {}));
    // Turn already advanced to u2; u1 calling endTurn is rejected.
    const r2 = gl.applyAction(r.state, 'u1', 'endTurn', {});
    expect(r2.error).toMatch(/Not your turn/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//                            SESSION 2A TESTS
// ═════════════════════════════════════════════════════════════════════════════

function readyAllPlayers(n = 2) {
  let s = makeGame(n);
  for (let i = 1; i <= n; i++) s = completeFirstTurn(s, `u${i}`);
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — marriage (session 2a)', () => {
  function setupMarryReady(n = 2) {
    let s = readyAllPlayers(n);
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-c10-junction'); // next-1 → sq-m01-marry
    return s;
  }

  test('landing on marriage sets spouse=true and collects $5k from each other player', () => {
    let s = setupMarryReady(2);
    s.players[0].cash = 0;
    s.players[1].cash = 100000;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].spouse).toBe(true);
    expect(r.state.players[0].cash).toBe(5000);
    expect(r.state.players[1].cash).toBe(95000);
  });

  test('PLAYER_MARRIED event fires with contributors and giftsCollected', () => {
    const s = setupMarryReady(3);
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    const ev = r.events.find((e) => e.type === 'PLAYER_MARRIED');
    expect(ev).toBeDefined();
    expect(ev.data.giftsCollected).toBe(2 * 5000);
    expect(ev.data.contributors).toEqual(expect.arrayContaining(['P2', 'P3']));
  });

  test('contributor count and gift total scale with player count (2 vs 6 players)', () => {
    {
      const s = setupMarryReady(2);
      const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
      const ev = r.events.find((e) => e.type === 'PLAYER_MARRIED');
      expect(ev.data.contributors).toHaveLength(1);
      expect(ev.data.giftsCollected).toBe(5000);
    }
    {
      const s = setupMarryReady(6);
      const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
      const ev = r.events.find((e) => e.type === 'PLAYER_MARRIED');
      expect(ev.data.contributors).toHaveLength(5);
      expect(ev.data.giftsCollected).toBe(25000);
    }
  });

  test('already-married player landing on marriage emits PLAYER_MARRIED_NO_EFFECT, no cash changes', () => {
    let s = setupMarryReady(2);
    s.players[0].spouse = true;
    s.players[0].cash = 50000;
    s.players[1].cash = 50000;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.events.map((e) => e.type)).toContain('PLAYER_MARRIED_NO_EFFECT');
    expect(r.events.map((e) => e.type)).not.toContain('PLAYER_MARRIED');
    expect(r.state.players[0].cash).toBe(50000);
    expect(r.state.players[1].cash).toBe(50000);
  });

  test('marriage on a player with zero cash still credits the gifts', () => {
    let s = setupMarryReady(2);
    s.players[0].cash = 0;
    s.players[1].cash = 50000;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].spouse).toBe(true);
    expect(r.state.players[0].cash).toBe(5000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — children (session 2a)', () => {
  function setupBabyReady(n = 2) {
    let s = readyAllPlayers(n);
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-m07-promotion'); // next-1 → sq-m08-have-baby
    return s;
  }
  function setupTwinsReady(n = 2) {
    let s = readyAllPlayers(n);
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-m12-spin-again'); // next-1 → sq-m13-have-twins
    return s;
  }

  test('baby square increments children by 1 and collects $5k from each other player', () => {
    let s = setupBabyReady(3);
    s.players[0].cash = 0;
    s.players[1].cash = 50000;
    s.players[2].cash = 50000;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].children).toBe(1);
    expect(r.state.players[0].cash).toBe(10000);
    expect(r.state.players[1].cash).toBe(45000);
    expect(r.state.players[2].cash).toBe(45000);
  });

  test('twins square increments children by 2 and collects $10k from each other player', () => {
    let s = setupTwinsReady(3);
    s.players[0].cash = 0;
    s.players[1].cash = 50000;
    s.players[2].cash = 50000;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].children).toBe(2);
    expect(r.state.players[0].cash).toBe(20000);
    expect(r.state.players[1].cash).toBe(40000);
    expect(r.state.players[2].cash).toBe(40000);
  });

  test('unmarried player can still have a baby (documented divergence from canonical Life)', () => {
    let s = setupBabyReady(2);
    expect(s.players[0].spouse).toBe(false); // precondition
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].children).toBe(1);
    expect(r.state.players[0].spouse).toBe(false);
  });

  test('contributors actually lose the money (symmetric mutation)', () => {
    let s = setupBabyReady(3);
    const before = s.players.map((p) => p.cash);
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    const after = r.state.players.map((p) => p.cash);
    expect(after[0]).toBe(before[0] + 10000);
    expect(after[1]).toBe(before[1] - 5000);
    expect(after[2]).toBe(before[2] - 5000);
  });

  test('baby with no other active players gives the child but transfers no money', () => {
    let s = setupBabyReady(3);
    s.players[1].active = false;
    s.players[2].active = false;
    const cashBefore = s.players[0].cash;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].children).toBe(1);
    expect(r.state.players[0].cash).toBe(cashBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — insurance (session 2a)', () => {
  function ready(n = 2) {
    let s = readyAllPlayers(n);
    s = setCurrent(s, 'u1');
    return s;
  }

  test('buyAutoInsurance succeeds when player has cash and no insurance', () => {
    let s = ready();
    s.players[0].cash = 50000;
    const r = gl.applyAction(s, 'u1', 'buyAutoInsurance', {});
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].autoInsurance).toBe(true);
    expect(r.state.players[0].cash).toBe(40000);
    expect(r.events.map((e) => e.type)).toContain('INSURANCE_PURCHASED');
  });

  test('buyAutoInsurance rejected when player already owns auto insurance', () => {
    let s = ready();
    s.players[0].cash = 50000;
    s.players[0].autoInsurance = true;
    const r = gl.applyAction(s, 'u1', 'buyAutoInsurance', {});
    expect(r.error).toMatch(/already own auto/);
  });

  test('buyAutoInsurance rejected when player cannot afford the cost', () => {
    let s = ready();
    s.players[0].cash = 5000;
    const r = gl.applyAction(s, 'u1', 'buyAutoInsurance', {});
    expect(r.error).toMatch(/Cannot afford/);
    expect(r.state.players[0].autoInsurance).toBe(false);
  });

  test('buyLifeInsurance follows the same purchase / already-owned / cannot-afford pattern', () => {
    {
      let s = ready();
      s.players[0].cash = 50000;
      const r = gl.applyAction(s, 'u1', 'buyLifeInsurance', {});
      expect(r.error).toBeUndefined();
      expect(r.state.players[0].lifeInsurance).toBe(true);
      expect(r.state.players[0].cash).toBe(30000);
    }
    {
      let s = ready();
      s.players[0].lifeInsurance = true;
      const r = gl.applyAction(s, 'u1', 'buyLifeInsurance', {});
      expect(r.error).toMatch(/already own life/);
    }
    {
      let s = ready();
      s.players[0].cash = 10000;
      const r = gl.applyAction(s, 'u1', 'buyLifeInsurance', {});
      expect(r.error).toMatch(/Cannot afford/);
    }
  });

  test('auto-accident with auto insurance: no money lost, emits INSURANCE_COVERED', () => {
    let s = ready();
    s.players[0].autoInsurance = true;
    s.players[0].cash = 50000;
    s = placePlayerAt(s, 'u1', 'sq-m16-payday'); // next-1 → sq-m17-auto-accident
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].position).toBe('sq-m17-auto-accident');
    expect(r.state.players[0].cash).toBe(50000);
    expect(r.events.map((e) => e.type)).toContain('INSURANCE_COVERED');
  });

  test('auto-accident without insurance: $10k debited', () => {
    let s = ready();
    s.players[0].cash = 50000;
    s = placePlayerAt(s, 'u1', 'sq-m16-payday');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].position).toBe('sq-m17-auto-accident');
    expect(r.state.players[0].cash).toBe(40000);
    expect(r.events.map((e) => e.type)).toContain('MONEY_PAID');
  });

  test('life-accident with life insurance: no money lost', () => {
    let s = ready();
    s.players[0].lifeInsurance = true;
    s.players[0].cash = 50000;
    s = placePlayerAt(s, 'u1', 'sq-m20-pay-each'); // next-1 → sq-m21-illness
    // Also need to ensure u1 doesn't lose money on pay-each by inactivating others first?
    // No — placement is at sq-m20 and we spin 1, so sq-m20 is passthrough.
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].position).toBe('sq-m21-illness');
    expect(r.state.players[0].cash).toBe(50000);
  });

  test('life-accident without insurance: $20k debited', () => {
    let s = ready();
    s.players[0].cash = 50000;
    s = placePlayerAt(s, 'u1', 'sq-m20-pay-each');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].position).toBe('sq-m21-illness');
    expect(r.state.players[0].cash).toBe(30000);
  });

  test('buyAutoInsurance rejected when it is not your turn', () => {
    let s = ready();
    const r = gl.applyAction(s, 'u2', 'buyAutoInsurance', {});
    expect(r.error).toMatch(/Not your turn/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — stocks (session 2a)', () => {
  function ready(n = 2) {
    let s = readyAllPlayers(n);
    s = setCurrent(s, 'u1');
    return s;
  }

  test('buyStock succeeds with a valid number and adequate cash', () => {
    let s = ready();
    s.players[0].cash = 100000;
    const r = gl.applyAction(s, 'u1', 'buyStock', { number: 7 });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].stockNumber).toBe(7);
    expect(r.state.players[0].cash).toBe(50000);
    expect(r.events.map((e) => e.type)).toContain('STOCK_PURCHASED');
  });

  test('buyStock rejected when another player owns the number', () => {
    let s = ready();
    s.players[0].cash = 100000;
    s.players[1].stockNumber = 7;
    const r = gl.applyAction(s, 'u1', 'buyStock', { number: 7 });
    expect(r.error).toMatch(/already owned/);
  });

  test('buyStock rejected when player already owns a stock', () => {
    let s = ready();
    s.players[0].cash = 100000;
    s.players[0].stockNumber = 4;
    const r = gl.applyAction(s, 'u1', 'buyStock', { number: 7 });
    expect(r.error).toMatch(/already own a stock/);
  });

  test('buyStock rejected when number is out of range or non-integer', () => {
    let s = ready();
    s.players[0].cash = 100000;
    expect(gl.applyAction(s, 'u1', 'buyStock', { number: 0 }).error).toMatch(/Stock number/);
    expect(gl.applyAction(s, 'u1', 'buyStock', { number: 11 }).error).toMatch(/Stock number/);
    expect(gl.applyAction(s, 'u1', 'buyStock', { number: 'X' }).error).toMatch(/Stock number/);
    expect(gl.applyAction(s, 'u1', 'buyStock', { number: 3.5 }).error).toMatch(/Stock number/);
  });

  test('buyStock rejected when player cannot afford the cost', () => {
    let s = ready();
    s.players[0].cash = 10000;
    const r = gl.applyAction(s, 'u1', 'buyStock', { number: 3 });
    expect(r.error).toMatch(/Cannot afford/);
  });

  test('spinner result matching a stock number pays $10k to the owner', () => {
    let s = ready();
    s.players[0].stockNumber = 5;
    const before = s.players[0].cash;
    const r = withSpin(5, () => gl.applyAction(s, 'u1', 'spin', {}));
    const ev = r.events.filter((e) => e.type === 'STOCK_PAYOUT');
    expect(ev).toHaveLength(1);
    expect(ev[0].data.username).toBe('P1');
    expect(ev[0].data.number).toBe(5);
    expect(ev[0].data.amount).toBe(10000);
    expect(r.state.players[0].cash).toBeGreaterThanOrEqual(before + 10000);
  });

  test('stock payout fires for non-current player when their number comes up', () => {
    let s = ready(3);
    s.players[1].stockNumber = 6; // u2 owns stock #6
    s = setCurrent(s, 'u1');
    const cashU2Before = s.players[1].cash;
    const r = withSpin(6, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.events.filter((e) => e.type === 'STOCK_PAYOUT')).toHaveLength(1);
    expect(r.state.players[1].cash).toBe(cashU2Before + 10000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — getValidActions (session 2a additions)', () => {
  test('after setup, action list includes spin + purchase actions when none owned', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    const actions = gl.getValidActions(s, 'u1');
    expect(actions).toEqual(
      expect.arrayContaining(['spin', 'buyAutoInsurance', 'buyLifeInsurance', 'buyStock']),
    );
  });

  test('buyAutoInsurance excluded once owned; buyLifeInsurance still present', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    s.players[0].autoInsurance = true;
    const actions = gl.getValidActions(s, 'u1');
    expect(actions).not.toContain('buyAutoInsurance');
    expect(actions).toContain('buyLifeInsurance');
  });

  test('buyStock excluded once player owns a stock', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    s.players[0].stockNumber = 7;
    expect(gl.getValidActions(s, 'u1')).not.toContain('buyStock');
  });

  test('purchase actions are excluded during pending choices (only chooseBranch valid)', () => {
    const s = makeGame(); // u1 still has start fork pending
    expect(gl.getValidActions(s, 'u1')).toEqual(['chooseBranch']);
  });

  test('purchase actions excluded mid-turn (after a spin-again triggers)', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-c07-traffic-ticket'); // next-1 → sq-c08-spin-again
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].midTurn).toBe(true);
    expect(r.state.players[0].spinAgain).toBe(true);
    expect(gl.getValidActions(r.state, 'u1')).toEqual(['spin']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — cross-feature interactions (session 2a)', () => {
  test('buy insurance then spin to marry — both correctly resolve on the same turn', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    s.players[0].cash = 100000;
    let r = gl.applyAction(s, 'u1', 'buyAutoInsurance', {});
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].autoInsurance).toBe(true);
    s = r.state;
    s = placePlayerAt(s, 'u1', 'sq-c10-junction');
    r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].spouse).toBe(true);
    expect(r.state.players[0].autoInsurance).toBe(true);
    // Cash: 100000 - 10000 (insurance) + 5000 (wedding gift from P2) = 95000
    expect(r.state.players[0].cash).toBe(95000);
  });

  test('baby gifts then payday on the next-turn spin both correctly credit', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    s.players[0].cash = 0;
    s.players[1].cash = 50000;
    s = placePlayerAt(s, 'u1', 'sq-m07-promotion');
    let r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].cash).toBe(5000);
    expect(r.state.players[0].children).toBe(1);
    // After baby, u1's pawn bumped to sq-m09-baby-gifts; turn ended.
    expect(r.state.players[0].position).toBe('sq-m09-baby-gifts');
    s = r.state;
    s = setCurrent(s, 'u1');
    // From sq-m09: spin 2 → sq-m10-pay-tax (passthrough) → sq-m11-payday.
    r = withSpin(2, () => gl.applyAction(s, 'u1', 'spin', {}));
    const me = r.state.players[0];
    expect(me.position).toBe('sq-m11-payday');
    expect(me.cash).toBe(5000 + me.salary.amount + (me.career.paydayBonus || 0));
  });

  test('a player owns stock #5; another player spins 5 — owner gets the payout', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    s.players[0].cash = 100000;
    let r = gl.applyAction(s, 'u1', 'buyStock', { number: 5 });
    expect(r.error).toBeUndefined();
    s = r.state;
    s = setCurrent(s, 'u2');
    const cashU1Before = s.players[0].cash;
    r = withSpin(5, () => gl.applyAction(s, 'u2', 'spin', {}));
    const payouts = r.events.filter((e) => e.type === 'STOCK_PAYOUT');
    expect(payouts).toHaveLength(1);
    expect(payouts[0].data.username).toBe('P1');
    expect(r.state.players[0].cash).toBe(cashU1Before + 10000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — migration (session 2a)', () => {
  test('migrate(v1) upgrades the player record to v2 with safe defaults', () => {
    // Synthesize a v1 state — same shape session 1 produced.  We only need
    // the players[] for migrate to operate on; other top-level fields just
    // pass through.
    const v1 = {
      stateVersion: 1,
      players: [
        {
          userId: 'a',
          username: 'A',
          spouse: null,
          // children was present in v1 (as a session-2 placeholder); keep it
          children: 0,
          cash: 100,
        },
        {
          userId: 'b',
          username: 'B',
          spouse: null,
          children: 0,
          cash: 200,
        },
      ],
    };
    const migrated = gl.migrate(v1);
    expect(migrated.stateVersion).toBe(2);
    for (const p of migrated.players) {
      expect(p.spouse).toBe(false);
      expect(p.children).toBe(0);
      expect(p.autoInsurance).toBe(false);
      expect(p.lifeInsurance).toBe(false);
      expect(p.stockNumber).toBeNull();
      expect(p.midTurn).toBe(false);
    }
  });

  test('migrate is idempotent — calling it on a v2 state returns the same shape', () => {
    const s = makeGame(); // already v2
    const again = gl.migrate(s);
    expect(again.stateVersion).toBe(2);
  });
});
