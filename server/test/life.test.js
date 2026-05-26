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
  r = gl.applyAction(state, userId, 'chooseCareer', { cardId: player.pending.options[0] });
  if (r.error) throw new Error(`chooseCareer failed: ${r.error}`);
  state = r.state;
  const p2 = state.players.find((p) => p.userId === userId);
  r = gl.applyAction(state, userId, 'chooseSalary', { cardId: p2.pending.options[0] });
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
      expect(p.pending).toEqual({
        type: 'fork',
        options: ['sq-c01-career-pick', 'sq-u01-college-loan'],
      });
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
    expect(r.state.players[0].pending).not.toBeNull();
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
    expect(r.state.players[0].pending.type).toBe('career-draw');
    for (const id of r.state.players[0].pending.options) {
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
    const opts = r.state.players[0].pending.options;
    expect(opts.length).toBeGreaterThan(0);
    const careersById = Object.fromEntries(CFG.careers.map((c) => [c.id, c]));
    for (const id of opts) expect(careersById[id].degreeRequired).toBe(true);
  });

  test('chooseCareer writes the chosen card to player.career and chains into salary draw', () => {
    let s = makeGame();
    let r = gl.applyAction(s, 'u1', 'chooseBranch', { nextSquareId: 'sq-c01-career-pick' });
    s = r.state;
    const choice = s.players[0].pending.options[1];
    r = gl.applyAction(s, 'u1', 'chooseCareer', { cardId: choice });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].career.id).toBe(choice);
    expect(r.state.players[0].pending).not.toBeNull();
    expect(r.state.players[0].pending.type).toBe('salary-draw');
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
      cardId: r.state.players[0].pending.options[0],
    });
    const salaryChoice = r.state.players[0].pending.options[0];
    r = gl.applyAction(r.state, 'u1', 'chooseSalary', { cardId: salaryChoice });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].salary.id).toBe(salaryChoice);
    expect(r.state.players[0].pending).toBeNull();
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
    const offered = r.state.players[0].pending.options.slice();
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

  test('retirement-fork is a real land-on fork in session 2b (no longer stubbed)', () => {
    // Session 2b made retirement-fork a real fork like the start fork — it
    // sets pending = { type: 'retirement-fork', options: [CA, ME] } and the
    // player chooses via chooseBranch.  See the Session 2b retirement-fork
    // describe block for the full contract.
    let s = completeFirstTurn(makeGame(), 'u1');
    s = completeFirstTurn(s, 'u2');
    s = setCurrent(s, 'u1');
    s = placePlayerAt(s, 'u1', 'sq-m34-payday');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].pending).toEqual({
      type: 'retirement-fork',
      options: ['sq-r-countryside-01', 'sq-r-millionaire-01'],
    });
    // Player stays on the retirement-fork square until they choose.
    expect(r.state.players[0].position).toBe('sq-m35-retirement-fork');
    expect(r.events.map((e) => e.type)).toContain('FORK_CHOICE_PENDING');
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
    expect(r.state.players[0].pending).toBeNull();
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

describe('Life — migration', () => {
  test('migrate(v1) chains through all migrations to the current STATE_VERSION', () => {
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
          children: 0,
          cash: 100,
          pendingForkChoice: ['sq-c01-career-pick', 'sq-u01-college-loan'],
          pendingCareerDrawOptions: null,
          pendingSalaryDrawOptions: null,
        },
        {
          userId: 'b',
          username: 'B',
          spouse: null,
          children: 0,
          cash: 200,
          pendingForkChoice: null,
          pendingCareerDrawOptions: ['career-doctor', 'career-lawyer'],
          pendingSalaryDrawOptions: null,
        },
      ],
    };
    const migrated = gl.migrate(v1);
    expect(migrated.stateVersion).toBe(gl.STATE_VERSION);
    for (const p of migrated.players) {
      expect(p.spouse).toBe(false);
      expect(p.children).toBe(0);
      expect(p.autoInsurance).toBe(false);
      expect(p.lifeInsurance).toBe(false);
      expect(p.stockNumber).toBeNull();
      expect(p.midTurn).toBe(false);
      // v2 → v3: the three pending fields collapsed into one.
      expect(p.pendingForkChoice).toBeUndefined();
      expect(p.pendingCareerDrawOptions).toBeUndefined();
      expect(p.pendingSalaryDrawOptions).toBeUndefined();
    }
    // Player A had pendingForkChoice; should now be { type: 'fork', options }.
    expect(migrated.players[0].pending).toEqual({
      type: 'fork',
      options: ['sq-c01-career-pick', 'sq-u01-college-loan'],
    });
    // Player B had pendingCareerDrawOptions.
    expect(migrated.players[1].pending).toEqual({
      type: 'career-draw',
      options: ['career-doctor', 'career-lawyer'],
    });
  });

  test('migrate is idempotent — calling it on a current-version state returns the same shape', () => {
    const s = makeGame();
    const again = gl.migrate(s);
    expect(again.stateVersion).toBe(gl.STATE_VERSION);
  });

  test('v2 → v3 collapses the three pending fields to player.pending', () => {
    const v2 = {
      stateVersion: 2,
      players: [
        {
          userId: 'a',
          username: 'A',
          pendingForkChoice: null,
          pendingCareerDrawOptions: null,
          pendingSalaryDrawOptions: ['salary-50', 'salary-60'],
          spouse: false,
          children: 0,
          autoInsurance: false,
          lifeInsurance: false,
          stockNumber: null,
          midTurn: false,
        },
        {
          userId: 'b',
          username: 'B',
          pendingForkChoice: null,
          pendingCareerDrawOptions: null,
          pendingSalaryDrawOptions: null,
          spouse: false,
          children: 0,
          autoInsurance: false,
          lifeInsurance: false,
          stockNumber: null,
          midTurn: false,
        },
      ],
    };
    const migrated = gl.migrate(v2);
    expect(migrated.stateVersion).toBe(gl.STATE_VERSION);
    expect(migrated.players[0].pending).toEqual({
      type: 'salary-draw',
      options: ['salary-50', 'salary-60'],
    });
    expect(migrated.players[1].pending).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//                            SESSION 2B TESTS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Drive a single player to the retirement-fork square (sq-m35) so a 1-spin
 * lands them on it.  Wraps readyAllPlayers + setCurrent + placePlayerAt.
 */
function setupAtRetirementFork(n = 2, userId = 'u1') {
  let s = readyAllPlayers(n);
  s = setCurrent(s, userId);
  s = placePlayerAt(s, userId, 'sq-m34-payday'); // next-1 → sq-m35-retirement-fork
  return s;
}

/** Place a player on sq-r-countryside-02 (one spin from the CA terminal). */
function setupBeforeCATerminal(s, userId) {
  s = setCurrent(s, userId);
  return placePlayerAt(s, userId, 'sq-r-countryside-02');
}

/** Place a player on sq-r-millionaire-02 (one spin from the ME terminal). */
function setupBeforeMETerminal(s, userId) {
  s = setCurrent(s, userId);
  return placePlayerAt(s, userId, 'sq-r-millionaire-02');
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — retirement fork (session 2b)', () => {
  test('landing on retirement-fork sets pending = { type: retirement-fork, options }', () => {
    const s = setupAtRetirementFork(2);
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].pending).toEqual({
      type: 'retirement-fork',
      options: ['sq-r-countryside-01', 'sq-r-millionaire-01'],
    });
    expect(r.state.players[0].position).toBe('sq-m35-retirement-fork');
  });

  test('chooseBranch with a valid retirement target advances the player', () => {
    let s = setupAtRetirementFork(2);
    let r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    r = gl.applyAction(r.state, 'u1', 'chooseBranch', { nextSquareId: 'sq-r-countryside-01' });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].position).toBe('sq-r-countryside-01');
    expect(r.state.players[0].pending).toBeNull();
  });

  test('chooseBranch with an invalid retirement target is rejected', () => {
    let s = setupAtRetirementFork(2);
    let r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    r = gl.applyAction(r.state, 'u1', 'chooseBranch', { nextSquareId: 'sq-c01-career-pick' });
    expect(r.error).toMatch(/Invalid branch/);
    // Player remains on the fork square with pending still set.
    expect(r.state.players[0].position).toBe('sq-m35-retirement-fork');
    expect(r.state.players[0].pending.type).toBe('retirement-fork');
  });

  test('after choosing, getValidActions returns spin (or the player retires this turn)', () => {
    let s = setupAtRetirementFork(2);
    let r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    r = gl.applyAction(r.state, 'u1', 'chooseBranch', { nextSquareId: 'sq-r-countryside-01' });
    // Choosing CA-01 moves the player there (a collect-bank square), the
    // effect resolves, and the turn advances.  u1 is no longer current.
    expect(r.state.turnState.currentPlayerIndex).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — Countryside Acres retirement (session 2b)', () => {
  test('landing on the CA terminal sets retired=true and retiredTo=countryside-acres', () => {
    let s = readyAllPlayers(2);
    s = setupBeforeCATerminal(s, 'u1');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].retired).toBe(true);
    expect(r.state.players[0].retiredTo).toBe('countryside-acres');
  });

  test('CA retiree draws caTilesPerRetiree life tiles from the deck', () => {
    let s = readyAllPlayers(2);
    s = setupBeforeCATerminal(s, 'u1');
    const before = s.lifeTileDeck.length;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    const target = CFG.settings.caTilesPerRetiree;
    expect(r.state.players[0].lifeTiles).toHaveLength(target);
    expect(r.state.lifeTileDeck).toHaveLength(before - target);
    // Tiles drawn are full objects with name + value, not just IDs.
    for (const tile of r.state.players[0].lifeTiles) {
      expect(typeof tile.id).toBe('string');
      expect(typeof tile.value).toBe('number');
    }
  });

  test('late CA retirees draw fewer tiles when the deck runs short', () => {
    let s = readyAllPlayers(2);
    // Pre-drain the deck to leave only 2 tiles remaining.
    s.lifeTileDeck = s.lifeTileDeck.slice(0, 2);
    s = setupBeforeCATerminal(s, 'u1');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].lifeTiles).toHaveLength(2);
    expect(r.state.lifeTileDeck).toHaveLength(0);
  });

  test('CA retiree with empty deck draws zero tiles without error', () => {
    let s = readyAllPlayers(2);
    s.lifeTileDeck = []; // drained
    s = setupBeforeCATerminal(s, 'u1');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].retired).toBe(true);
    expect(r.state.players[0].lifeTiles).toEqual([]);
  });

  test('PLAYER_RETIRED_CA event fires with tilesDrawn count but NO tile values', () => {
    let s = readyAllPlayers(2);
    s = setupBeforeCATerminal(s, 'u1');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    const ev = r.events.find((e) => e.type === 'PLAYER_RETIRED_CA');
    expect(ev).toBeDefined();
    expect(ev.data.tilesDrawn).toBe(CFG.settings.caTilesPerRetiree);
    // Sanity check: the event payload deliberately omits tile values so
    // they stay hidden until game over.
    expect(ev.data.tiles).toBeUndefined();
    expect(ev.data.lifeTiles).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — Millionaire Estates retirement (session 2b)', () => {
  test('landing on the ME terminal sets retired=true and retiredTo=millionaire-estates', () => {
    let s = readyAllPlayers(2);
    s = setupBeforeMETerminal(s, 'u1');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].retired).toBe(true);
    expect(r.state.players[0].retiredTo).toBe('millionaire-estates');
  });

  test('ME retiree draws no life tiles', () => {
    let s = readyAllPlayers(2);
    const beforeDeck = s.lifeTileDeck.length;
    s = setupBeforeMETerminal(s, 'u1');
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].lifeTiles).toEqual([]);
    expect(r.state.lifeTileDeck).toHaveLength(beforeDeck); // unchanged
  });

  test('PLAYER_RETIRED_ME event fires with cashAtRetirement', () => {
    let s = readyAllPlayers(2);
    s = setupBeforeMETerminal(s, 'u1');
    s.players[0].cash = 75000;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    const ev = r.events.find((e) => e.type === 'PLAYER_RETIRED_ME');
    expect(ev).toBeDefined();
    expect(ev.data.cashAtRetirement).toBe(75000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — retired-player pattern (session 2b)', () => {
  test('getCurrentPlayer returns null when the current-index player is retired', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    s.players[0].retired = true;
    expect(gl.getCurrentPlayer(s)).toBeNull();
  });

  test('turn advancement skips retired players (active rotates from u2 directly to u1 wraps over retired u3)', () => {
    let s = readyAllPlayers(3);
    s = setCurrent(s, 'u2');
    s.players[2].retired = true; // u3 is retired
    s.players[2].retiredTo = 'countryside-acres';
    // u2 spins something innocuous and ends their turn.  Advance should go
    // to u1 (skipping u3, who is retired).
    s = placePlayerAt(s, 'u2', 'sq-c04-buy-car');
    s.players[1].cash = 50000;
    const r = withSpin(1, () => gl.applyAction(s, 'u2', 'spin', {}));
    expect(r.state.turnState.currentPlayerIndex).toBe(0); // u1
  });

  test('a retired player attempting any action gets rejected with "You are retired"', () => {
    let s = readyAllPlayers(2);
    s.players[0].retired = true;
    s.players[0].retiredTo = 'countryside-acres';
    s = setCurrent(s, 'u2');
    const r = gl.applyAction(s, 'u1', 'spin', {});
    expect(r.error).toMatch(/retired/);
  });

  test('two players, one retired: only the unretired can act', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    s.players[1].retired = true;
    s.players[1].retiredTo = 'countryside-acres';
    expect(gl.getValidActions(s, 'u1').length).toBeGreaterThan(0);
    expect(gl.getValidActions(s, 'u2')).toEqual([]);
  });

  test('all players retired triggers status=finished via advanceTurn', () => {
    let s = readyAllPlayers(2);
    s.players[0].retired = true;
    s.players[0].retiredTo = 'countryside-acres';
    s.players[0].pending = null;
    s = setupBeforeCATerminal(s, 'u2');
    const r = withSpin(1, () => gl.applyAction(s, 'u2', 'spin', {}));
    expect(r.state.status).toBe('finished');
    expect(r.events.map((e) => e.type)).toContain('GAME_OVER');
  });

  test('a retired player produces no current-player signal (framework gets null and skips timers)', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    s.players[0].retired = true;
    // The framework's turn-timer / disconnect logic calls getCurrentPlayer
    // and acts on null by doing nothing — so a disconnected retired player
    // doesn't trigger any turn-skip cascade.
    expect(gl.getCurrentPlayer(s)).toBeNull();
    expect(gl.isTurnTimerBlocked(s)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — life tiles (session 2b)', () => {
  test('the tile deck initializes with all 20 tiles from config (shuffled)', () => {
    const s = makeGame();
    expect(s.lifeTileDeck).toHaveLength(CFG.lifeTiles.length);
    // Every config tile ID appears in the deck.
    const tileIds = new Set(CFG.lifeTiles.map((t) => t.id));
    for (const id of s.lifeTileDeck) {
      expect(tileIds.has(id)).toBe(true);
    }
  });

  test('lifeTiles.json validation catches missing or duplicate tile IDs', () => {
    const { _validators } = configLoader;
    expect(() =>
      _validators.validateLifeTiles({
        tiles: [
          { id: 'a', name: 'A', value: 1 },
          { id: 'a', name: 'B', value: 2 },
        ],
      }),
    ).toThrow(/duplicate/);
    expect(() => _validators.validateLifeTiles({ tiles: [{ name: 'No ID', value: 1 }] })).toThrow(
      /string id/,
    );
    expect(() => _validators.validateLifeTiles({ tiles: [] })).toThrow(/non-empty/);
  });

  test('getStateForPlayer returns full tile values to self but only a count to opponents', () => {
    let s = readyAllPlayers(2);
    s = setupBeforeCATerminal(s, 'u1');
    const after = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {})).state;
    // u1 is the retired CA player; check u2's view of u1.
    const viewByU2 = gl.getStateForPlayer(after, 'u2');
    const u1AsSeenByU2 = viewByU2.players.find((p) => p.userId === 'u1');
    expect(u1AsSeenByU2.lifeTiles).toBeUndefined();
    expect(u1AsSeenByU2.lifeTilesCount).toBe(after.players[0].lifeTiles.length);
    // u1's own view shows full tiles.
    const viewByU1 = gl.getStateForPlayer(after, 'u1');
    const u1AsSeenByU1 = viewByU1.players.find((p) => p.userId === 'u1');
    expect(u1AsSeenByU1.lifeTiles).toEqual(after.players[0].lifeTiles);
  });

  test('after status=finished, getStateForPlayer reveals every player’s tile values', () => {
    let s = readyAllPlayers(2);
    s.status = 'finished';
    s.players[0].lifeTiles = [{ id: 'x', name: 'X', value: 100000 }];
    const viewByU2 = gl.getStateForPlayer(s, 'u2');
    expect(viewByU2.players[0].lifeTiles).toEqual([{ id: 'x', name: 'X', value: 100000 }]);
  });

  test('GAME_OVER event payload reveals every retiree’s life tiles', () => {
    let s = readyAllPlayers(2);
    s.players[0].retired = true;
    s.players[0].retiredTo = 'countryside-acres';
    s.players[0].lifeTiles = [
      { id: 't1', name: 'Nobel', value: 300000 },
      { id: 't2', name: 'Pulitzer', value: 200000 },
    ];
    s.players[0].pending = null;
    s = setupBeforeCATerminal(s, 'u2');
    const r = withSpin(1, () => gl.applyAction(s, 'u2', 'spin', {}));
    const gameOver = r.events.find((e) => e.type === 'GAME_OVER');
    expect(gameOver).toBeDefined();
    expect(gameOver.data.finalScores['u1'].lifeTiles).toEqual([
      { id: 't1', name: 'Nobel', value: 300000 },
      { id: 't2', name: 'Pulitzer', value: 200000 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — final scoring (session 2b)', () => {
  test('computeFinalScore: cash + house + tiles + children*50000', () => {
    const player = {
      cash: 100000,
      house: { value: 50000 },
      lifeTiles: [{ value: 200000 }, { value: 150000 }],
      children: 3,
    };
    const score = gl.computeFinalScore(player, CFG.settings);
    expect(score.cash).toBe(100000);
    expect(score.house).toBe(50000);
    expect(score.lifeTilesValue).toBe(350000);
    expect(score.childrenBonus).toBe(150000); // 3 * 50k
    expect(score.total).toBe(650000);
  });

  test('computeFinalScore handles zero values (no house, no tiles, no children)', () => {
    const player = { cash: 10000, lifeTiles: [], children: 0 };
    const score = gl.computeFinalScore(player, CFG.settings);
    expect(score.house).toBe(0);
    expect(score.lifeTilesValue).toBe(0);
    expect(score.childrenBonus).toBe(0);
    expect(score.total).toBe(10000);
  });

  test('ME-only game: highest cash among MEs wins outright; losers score zero', () => {
    let s = readyAllPlayers(2);
    s.players[0].retired = true;
    s.players[0].retiredTo = 'millionaire-estates';
    s.players[0].cash = 80000;
    s.players[0].pending = null;
    s.players[1].cash = 200000; // u2 has more cash and is about to retire to ME
    s = setupBeforeMETerminal(s, 'u2');
    const r = withSpin(1, () => gl.applyAction(s, 'u2', 'spin', {}));
    const go = r.events.find((e) => e.type === 'GAME_OVER');
    expect(go.data.winner).toBe('u2');
    expect(go.data.finalScores['u1'].total).toBe(0); // ME loser
    expect(go.data.finalScores['u2'].total).toBeGreaterThan(0);
  });

  test('mixed CA + ME with an ME winner: ME wins regardless of CA’s total', () => {
    let s = readyAllPlayers(2);
    s.players[0].retired = true;
    s.players[0].retiredTo = 'countryside-acres';
    // Give u1 a monster CA total to test the rule strictly.
    s.players[0].lifeTiles = [
      { value: 300000 },
      { value: 300000 },
      { value: 300000 },
      { value: 300000 },
    ];
    s.players[0].cash = 500000;
    s.players[0].children = 5;
    s.players[0].pending = null;
    // u2 retires to ME with much less cash — but ME with ≥1 retiree always
    // wins per the locked rule.
    s.players[1].cash = 50000;
    s = setupBeforeMETerminal(s, 'u2');
    const r = withSpin(1, () => gl.applyAction(s, 'u2', 'spin', {}));
    const go = r.events.find((e) => e.type === 'GAME_OVER');
    expect(go.data.winner).toBe('u2');
  });

  test('no ME retirees: highest-final-score CA retiree wins', () => {
    let s = readyAllPlayers(2);
    s.players[0].retired = true;
    s.players[0].retiredTo = 'countryside-acres';
    s.players[0].lifeTiles = [{ value: 100000 }];
    s.players[0].cash = 20000;
    s.players[0].children = 0;
    s.players[0].pending = null;
    // u2 will retire to CA with bigger total.
    s.players[1].cash = 60000;
    s.players[1].children = 2;
    s.lifeTileDeck = []; // deck drained — u2 gets no tiles but still wins
    s = setupBeforeCATerminal(s, 'u2');
    const r = withSpin(1, () => gl.applyAction(s, 'u2', 'spin', {}));
    const go = r.events.find((e) => e.type === 'GAME_OVER');
    // u1 total: 20000 + 100000 + 0 = 120000
    // u2 total: 60000 + 0 + (2 * 50000) = 160000
    expect(go.data.winner).toBe('u2');
  });

  test('tie at the top among ME retirees: winner is an array of userIds', () => {
    let s = readyAllPlayers(2);
    s.players[0].retired = true;
    s.players[0].retiredTo = 'millionaire-estates';
    s.players[0].cash = 100000;
    s.players[0].pending = null;
    s.players[1].cash = 100000; // exact tie
    s = setupBeforeMETerminal(s, 'u2');
    const r = withSpin(1, () => gl.applyAction(s, 'u2', 'spin', {}));
    const go = r.events.find((e) => e.type === 'GAME_OVER');
    expect(Array.isArray(go.data.winner)).toBe(true);
    expect(go.data.winner).toEqual(expect.arrayContaining(['u1', 'u2']));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — pay-tax-by-salary (session 2b)', () => {
  test('pay-tax-by-salary debits the player’s salary.taxDue from cash', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    // The board’s sq-m10-pay-tax is now pay-tax-by-salary.
    // sq-m09-baby-gifts → next-1 → sq-m10-pay-tax.
    s = placePlayerAt(s, 'u1', 'sq-m09-baby-gifts');
    const cashBefore = (s.players[0].cash = 50000);
    const expectedTax = s.players[0].salary.taxDue;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.state.players[0].position).toBe('sq-m10-pay-tax');
    expect(r.state.players[0].cash).toBe(cashBefore - expectedTax);
  });

  test('pay-tax-by-salary is a no-op when the player has no salary card', () => {
    let s = readyAllPlayers(2);
    s = setCurrent(s, 'u1');
    s.players[0].salary = null; // pathological — shouldn’t happen in normal play
    s = placePlayerAt(s, 'u1', 'sq-m09-baby-gifts');
    s.players[0].cash = 50000;
    const r = withSpin(1, () => gl.applyAction(s, 'u1', 'spin', {}));
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].cash).toBe(50000); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Life — migration (session 2b)', () => {
  test('v3 → v4 adds retiredTo, lifeTiles, and lifeTileDeck', () => {
    const v3 = {
      stateVersion: 3,
      players: [
        {
          userId: 'a',
          username: 'A',
          retired: false,
          // no retiredTo / lifeTiles
        },
      ],
      // no lifeTileDeck
    };
    const migrated = gl.migrate(v3);
    expect(migrated.stateVersion).toBe(gl.STATE_VERSION);
    expect(migrated.players[0].retiredTo).toBeNull();
    expect(migrated.players[0].lifeTiles).toEqual([]);
    expect(Array.isArray(migrated.lifeTileDeck)).toBe(true);
  });
});
