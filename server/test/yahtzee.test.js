'use strict';

const gl = require('../games/yahtzee/game-logic');

// ── fixtures ──────────────────────────────────────────────────────────────────

const CFG = gl.getConfigCopy();

function makePlayer(id, name, sheetOverrides = {}) {
  const sheet = {};
  for (const c of gl.CATEGORIES) sheet[c] = null;
  return {
    userId: id,
    username: name,
    color: 'red',
    colorHex: '#e63946',
    token: '🎲',
    active: true,
    isBankrupt: false,
    connected: true,
    scoreSheet: { ...sheet, ...sheetOverrides },
  };
}

function makeState(overrides = {}) {
  const players = overrides.players || [makePlayer('p1', 'Alice'), makePlayer('p2', 'Bob')];
  return {
    id: 'test-game',
    name: 'Test',
    gameType: 'yahtzee',
    stateVersion: 1,
    status: 'playing',
    config: CFG,
    players,
    turnState: {
      currentPlayerIndex: 0,
      dice: [],
      held: [false, false, false, false, false],
      rollsUsed: 0,
      roundsCompleted: 0,
    },
    winner: null,
    log: [],
    ...overrides,
  };
}

/** Fill the named categories on a player with the given scores. */
function fillSheet(player, scores) {
  for (const [cat, val] of Object.entries(scores)) {
    player.scoreSheet[cat] = val;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — metadata', () => {
  test('shipped game module registers cleanly', () => {
    expect(() => require('../games/yahtzee/game-logic')).not.toThrow();
  });

  test('reports 1–8 players (solo-friendly)', () => {
    const m = gl.getGameMetadata();
    expect(m.minPlayers).toBe(1);
    expect(m.maxPlayers).toBe(8);
  });

  test('reports light complexity and dice/no-spatial tags', () => {
    const m = gl.getGameMetadata();
    expect(m.complexity).toBe('light');
    expect(m.tags).toContain('dice');
    expect(m.tags).toContain('no-spatial');
    expect(m.tags).toContain('solo-friendly');
  });

  test('estimatedDurationMinutes is a positive number', () => {
    expect(typeof gl.getGameMetadata().estimatedDurationMinutes).toBe('number');
    expect(gl.getGameMetadata().estimatedDurationMinutes).toBeGreaterThan(0);
  });

  test('name and icon set', () => {
    const m = gl.getGameMetadata();
    expect(m.name).toBe('Yahtzee');
    expect(m.icon).toBe('🎲');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — initGame', () => {
  const players = [makePlayer('p1', 'Alice'), makePlayer('p2', 'Bob')];

  test('sets gameType to yahtzee', () => {
    const s = gl.initGame('g1', 'T', players, CFG);
    expect(s.gameType).toBe('yahtzee');
  });

  test('sets status to playing', () => {
    expect(gl.initGame('g1', 'T', players, CFG).status).toBe('playing');
  });

  test('stamps stateVersion', () => {
    expect(gl.initGame('g1', 'T', players, CFG).stateVersion).toBe(gl.STATE_VERSION);
  });

  test('initialises every score sheet to all-null (13 categories)', () => {
    const s = gl.initGame('g1', 'T', players, CFG);
    for (const p of s.players) {
      expect(Object.keys(p.scoreSheet)).toHaveLength(13);
      for (const cat of gl.CATEGORIES) expect(p.scoreSheet[cat]).toBeNull();
    }
  });

  test('starts at player 0 with empty dice and rollsUsed 0', () => {
    const s = gl.initGame('g1', 'T', players, CFG);
    expect(s.turnState.currentPlayerIndex).toBe(0);
    expect(s.turnState.dice).toEqual([]);
    expect(s.turnState.rollsUsed).toBe(0);
  });

  test('starts with all-false held of length diceCount', () => {
    const s = gl.initGame('g1', 'T', players, CFG);
    expect(s.turnState.held).toHaveLength(CFG.settings.diceCount);
    expect(s.turnState.held.every((h) => h === false)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — createInitialPlayer', () => {
  test('throws when called without a config that has playerColors/playerTokens', () => {
    const user = { id: 'u', username: 'X' };
    expect(() => gl.createInitialPlayer(user, [], null)).toThrow(/playerColors/);
    expect(() => gl.createInitialPlayer(user, [], { settings: {} })).toThrow(/playerColors/);
  });

  test('assigns the next colour/token slot for each new player and starts with empty sheet', () => {
    const a = gl.createInitialPlayer({ id: 'a', username: 'A' }, [], CFG);
    const b = gl.createInitialPlayer({ id: 'b', username: 'B' }, [a], CFG);
    expect(a.color).toBe(CFG.settings.playerColors[0].id);
    expect(b.color).toBe(CFG.settings.playerColors[1].id);
    expect(a.token).toBe(CFG.settings.playerTokens[0]);
    expect(b.token).toBe(CFG.settings.playerTokens[1]);
    for (const cat of gl.CATEGORIES) expect(a.scoreSheet[cat]).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — scoreFor: upper section', () => {
  test('ones counts only the 1s', () => {
    expect(gl.scoreFor('ones', [1, 1, 3, 4, 5], CFG)).toBe(2);
    expect(gl.scoreFor('ones', [2, 3, 4, 5, 6], CFG)).toBe(0);
  });
  test('twos counts only the 2s', () => {
    expect(gl.scoreFor('twos', [2, 2, 2, 4, 5], CFG)).toBe(6);
    expect(gl.scoreFor('twos', [1, 3, 4, 5, 6], CFG)).toBe(0);
  });
  test('threes counts only the 3s', () => {
    expect(gl.scoreFor('threes', [3, 3, 3, 3, 5], CFG)).toBe(12);
  });
  test('fours counts only the 4s', () => {
    expect(gl.scoreFor('fours', [4, 4, 2, 1, 4], CFG)).toBe(12);
  });
  test('fives counts only the 5s', () => {
    expect(gl.scoreFor('fives', [5, 5, 5, 5, 5], CFG)).toBe(25);
  });
  test('sixes counts only the 6s', () => {
    expect(gl.scoreFor('sixes', [6, 6, 1, 2, 3], CFG)).toBe(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — scoreFor: threeOfAKind / fourOfAKind', () => {
  test('threeOfAKind [3,3,3,4,5] scores 18 (sum of ALL dice, not just the triple)', () => {
    expect(gl.scoreFor('threeOfAKind', [3, 3, 3, 4, 5], CFG)).toBe(18);
  });

  test('threeOfAKind with no triple scores 0', () => {
    expect(gl.scoreFor('threeOfAKind', [1, 2, 3, 4, 5], CFG)).toBe(0);
    expect(gl.scoreFor('threeOfAKind', [1, 1, 2, 2, 3], CFG)).toBe(0);
  });

  test('threeOfAKind triggered by 4-of-a-kind also scores sum', () => {
    expect(gl.scoreFor('threeOfAKind', [4, 4, 4, 4, 2], CFG)).toBe(18);
  });

  test('fourOfAKind [4,4,4,4,2] scores 18 (sum of ALL dice)', () => {
    expect(gl.scoreFor('fourOfAKind', [4, 4, 4, 4, 2], CFG)).toBe(18);
  });

  test('fourOfAKind with only triples scores 0', () => {
    expect(gl.scoreFor('fourOfAKind', [3, 3, 3, 4, 5], CFG)).toBe(0);
  });

  test('fourOfAKind triggered by 5-of-a-kind also scores sum', () => {
    expect(gl.scoreFor('fourOfAKind', [6, 6, 6, 6, 6], CFG)).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — scoreFor: fullHouse', () => {
  test('classic [3,3,3,4,4] scores 25', () => {
    expect(gl.scoreFor('fullHouse', [3, 3, 3, 4, 4], CFG)).toBe(25);
  });
  test('order does not matter: [4,3,4,3,3] scores 25', () => {
    expect(gl.scoreFor('fullHouse', [4, 3, 4, 3, 3], CFG)).toBe(25);
  });
  test('five-of-a-kind [2,2,2,2,2] does NOT count as a full house', () => {
    expect(gl.scoreFor('fullHouse', [2, 2, 2, 2, 2], CFG)).toBe(0);
  });
  test('four-of-a-kind + singleton is not a full house', () => {
    expect(gl.scoreFor('fullHouse', [5, 5, 5, 5, 2], CFG)).toBe(0);
  });
  test('two pairs is not a full house', () => {
    expect(gl.scoreFor('fullHouse', [3, 3, 4, 4, 5], CFG)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — scoreFor: straights', () => {
  test('smallStraight [1,2,3,4,5] qualifies (large straight is also small)', () => {
    expect(gl.scoreFor('smallStraight', [1, 2, 3, 4, 5], CFG)).toBe(30);
  });
  test('smallStraight [1,2,3,4,4] qualifies (1234 present, duplicate ignored)', () => {
    expect(gl.scoreFor('smallStraight', [1, 2, 3, 4, 4], CFG)).toBe(30);
  });
  test('smallStraight [2,3,4,5,5] qualifies (2345)', () => {
    expect(gl.scoreFor('smallStraight', [2, 3, 4, 5, 5], CFG)).toBe(30);
  });
  test('smallStraight [3,4,5,6,1] qualifies (3456)', () => {
    expect(gl.scoreFor('smallStraight', [3, 4, 5, 6, 1], CFG)).toBe(30);
  });
  test('smallStraight [1,2,3,5,6] does NOT qualify (no 4 consecutive)', () => {
    expect(gl.scoreFor('smallStraight', [1, 2, 3, 5, 6], CFG)).toBe(0);
  });
  test('smallStraight [1,1,1,1,1] does NOT qualify', () => {
    expect(gl.scoreFor('smallStraight', [1, 1, 1, 1, 1], CFG)).toBe(0);
  });
  test('largeStraight [1,2,3,4,5] qualifies, scores 40', () => {
    expect(gl.scoreFor('largeStraight', [1, 2, 3, 4, 5], CFG)).toBe(40);
  });
  test('largeStraight [2,3,4,5,6] qualifies, scores 40', () => {
    expect(gl.scoreFor('largeStraight', [2, 3, 4, 5, 6], CFG)).toBe(40);
  });
  test('largeStraight [1,2,3,4,4] does NOT qualify (no 5 consecutive)', () => {
    expect(gl.scoreFor('largeStraight', [1, 2, 3, 4, 4], CFG)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — scoreFor: yahtzee and chance', () => {
  test('yahtzee [6,6,6,6,6] scores 50', () => {
    expect(gl.scoreFor('yahtzee', [6, 6, 6, 6, 6], CFG)).toBe(50);
  });
  test('yahtzee [6,6,6,6,5] scores 0', () => {
    expect(gl.scoreFor('yahtzee', [6, 6, 6, 6, 5], CFG)).toBe(0);
  });
  test('chance always sums every die', () => {
    expect(gl.scoreFor('chance', [1, 2, 3, 4, 5], CFG)).toBe(15);
    expect(gl.scoreFor('chance', [6, 6, 6, 6, 6], CFG)).toBe(30);
    expect(gl.scoreFor('chance', [1, 1, 1, 1, 1], CFG)).toBe(5);
  });
  test('scoreFor throws on unknown category', () => {
    expect(() => gl.scoreFor('quintuple', [1, 2, 3, 4, 5], CFG)).toThrow(/Unknown/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — rollDice action', () => {
  test('first roll succeeds and populates 5 dice', () => {
    const { state, error } = gl.applyAction(makeState(), 'p1', 'rollDice', {});
    expect(error).toBeUndefined();
    expect(state.turnState.dice).toHaveLength(5);
    for (const d of state.turnState.dice) {
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
    }
    expect(state.turnState.rollsUsed).toBe(1);
  });

  test('rejects when not your turn', () => {
    const { error } = gl.applyAction(makeState(), 'p2', 'rollDice', {});
    expect(error).toMatch(/not your turn/i);
  });

  test('first roll rejects a non-empty held array', () => {
    const { error } = gl.applyAction(makeState(), 'p1', 'rollDice', {
      held: [true, false, false, false, false],
    });
    expect(error).toMatch(/first roll/i);
  });

  test('subsequent roll respects held=true (carries over dice value)', () => {
    let s = makeState();
    s = gl.applyAction(s, 'p1', 'rollDice', {}).state;
    const firstDice = s.turnState.dice.slice();
    // Hold all dice — second roll should be identical
    const r2 = gl.applyAction(s, 'p1', 'rollDice', {
      held: [true, true, true, true, true],
    });
    expect(r2.error).toBeUndefined();
    expect(r2.state.turnState.dice).toEqual(firstDice);
    expect(r2.state.turnState.rollsUsed).toBe(2);
  });

  test('rejects after 3 rolls', () => {
    let s = makeState();
    s = gl.applyAction(s, 'p1', 'rollDice', {}).state;
    s = gl.applyAction(s, 'p1', 'rollDice', { held: [false, false, false, false, false] }).state;
    s = gl.applyAction(s, 'p1', 'rollDice', { held: [false, false, false, false, false] }).state;
    expect(s.turnState.rollsUsed).toBe(3);
    const r4 = gl.applyAction(s, 'p1', 'rollDice', { held: [false, false, false, false, false] });
    expect(r4.error).toMatch(/no rolls remaining/i);
  });

  test('rejects malformed held (wrong length)', () => {
    let s = gl.applyAction(makeState(), 'p1', 'rollDice', {}).state;
    const r = gl.applyAction(s, 'p1', 'rollDice', { held: [true, false] });
    expect(r.error).toMatch(/held must be/i);
  });

  test('rejects malformed held (non-boolean values)', () => {
    let s = gl.applyAction(makeState(), 'p1', 'rollDice', {}).state;
    const r = gl.applyAction(s, 'p1', 'rollDice', { held: [true, 'no', false, false, false] });
    expect(r.error).toMatch(/held must be/i);
  });

  test('emits DICE_ROLLED with username, dice, held, rollsUsed', () => {
    const { events } = gl.applyAction(makeState(), 'p1', 'rollDice', {});
    const e = events.find((x) => x.type === 'DICE_ROLLED');
    expect(e).toBeDefined();
    expect(e.data.username).toBe('Alice');
    expect(e.data.rollsUsed).toBe(1);
    expect(e.data.dice).toHaveLength(5);
    expect(e.data.held).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — scoreCategory action', () => {
  function afterRoll(dice = [1, 1, 1, 4, 5], state = makeState()) {
    // Patch in deterministic dice without actually rolling.  This is a unit
    // test, not an integration of rollDice — we want to score against known dice.
    return {
      ...state,
      turnState: { ...state.turnState, dice: dice.slice(), rollsUsed: 1 },
    };
  }

  test('successful scoring writes the score and advances the turn', () => {
    const s = afterRoll();
    const r = gl.applyAction(s, 'p1', 'scoreCategory', { category: 'ones' });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].scoreSheet.ones).toBe(3);
    expect(r.state.turnState.currentPlayerIndex).toBe(1);
    expect(r.state.turnState.rollsUsed).toBe(0);
    expect(r.state.turnState.dice).toEqual([]);
  });

  test('rejects unknown category', () => {
    const r = gl.applyAction(afterRoll(), 'p1', 'scoreCategory', { category: 'mystery' });
    expect(r.error).toMatch(/Unknown category/);
  });

  test('rejects category already used', () => {
    const s = afterRoll();
    s.players[0].scoreSheet.ones = 5;
    const r = gl.applyAction(s, 'p1', 'scoreCategory', { category: 'ones' });
    expect(r.error).toMatch(/already used/i);
  });

  test('rejects before any roll (rollsUsed = 0)', () => {
    const s = makeState();
    const r = gl.applyAction(s, 'p1', 'scoreCategory', { category: 'chance' });
    expect(r.error).toMatch(/roll at least once/i);
  });

  test('rejects when not your turn', () => {
    const s = afterRoll();
    const r = gl.applyAction(s, 'p2', 'scoreCategory', { category: 'ones' });
    expect(r.error).toMatch(/not your turn/i);
  });

  test('emits CATEGORY_SCORED with dice, category, points', () => {
    const s = afterRoll([3, 3, 3, 4, 5]);
    const r = gl.applyAction(s, 'p1', 'scoreCategory', { category: 'threeOfAKind' });
    const e = r.events.find((x) => x.type === 'CATEGORY_SCORED');
    expect(e).toBeDefined();
    expect(e.data.category).toBe('threeOfAKind');
    expect(e.data.points).toBe(18);
    expect(e.data.dice).toEqual([3, 3, 3, 4, 5]);
  });

  test('emits TURN_ENDED then TURN_STARTED', () => {
    const r = gl.applyAction(afterRoll(), 'p1', 'scoreCategory', { category: 'ones' });
    const types = r.events.map((e) => e.type);
    expect(types).toContain('TURN_ENDED');
    expect(types).toContain('TURN_STARTED');
    expect(types.indexOf('TURN_ENDED')).toBeLessThan(types.indexOf('TURN_STARTED'));
  });

  test('next turn starts with fresh dice/held/rollsUsed for the next player', () => {
    const r = gl.applyAction(afterRoll(), 'p1', 'scoreCategory', { category: 'ones' });
    expect(r.state.turnState.currentPlayerIndex).toBe(1);
    expect(r.state.turnState.dice).toEqual([]);
    expect(r.state.turnState.held.every((h) => h === false)).toBe(true);
    expect(r.state.turnState.rollsUsed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — null vs 0 distinction (critical)', () => {
  test('scoring 0 into a category marks it used and not re-offerable', () => {
    // Roll has zero 6s; score into "sixes" → 0 points, but the category is used.
    const s = {
      ...makeState(),
      turnState: {
        currentPlayerIndex: 0,
        dice: [1, 2, 3, 4, 5],
        held: [false, false, false, false, false],
        rollsUsed: 2,
        roundsCompleted: 0,
      },
    };
    const r1 = gl.applyAction(s, 'p1', 'scoreCategory', { category: 'sixes' });
    expect(r1.error).toBeUndefined();
    expect(r1.state.players[0].scoreSheet.sixes).toBe(0);

    // Now p2 takes a (do-nothing) skip so p1 is current again with a fresh turn.
    const r2 = { ...r1.state };
    r2.turnState = {
      currentPlayerIndex: 0,
      dice: [6, 6, 6, 6, 6],
      held: [false, false, false, false, false],
      rollsUsed: 1,
      roundsCompleted: 1,
    };
    const r3 = gl.applyAction(r2, 'p1', 'scoreCategory', { category: 'sixes' });
    expect(r3.error).toMatch(/already used/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — game-over detection', () => {
  // Build a 2-player state where Alice has all 13 categories filled and Bob
  // has 12 filled.  Then have Bob score the 13th — game should end with the
  // higher-total player as winner.

  function nearEndState({ aliceScores, bobScores, finalCategory, finalDice }) {
    const alice = makePlayer('p1', 'Alice');
    const bob = makePlayer('p2', 'Bob');
    fillSheet(alice, aliceScores);
    fillSheet(bob, bobScores);
    const s = makeState({ players: [alice, bob] });
    // Set turn to Bob, dice fixed, rollsUsed=1 so he can score
    s.turnState = {
      currentPlayerIndex: 1,
      dice: finalDice,
      held: [false, false, false, false, false],
      rollsUsed: 1,
      roundsCompleted: 12,
    };
    return { state: s, finalCategory };
  }

  test('finishing the last category ends the game and picks the winner', () => {
    // Alice fills all 13 categories with simple low values, total 70.
    const aliceScores = {
      ones: 5,
      twos: 6,
      threes: 9,
      fours: 4,
      fives: 5,
      sixes: 6,
      threeOfAKind: 10,
      fourOfAKind: 15,
      fullHouse: 0,
      smallStraight: 0,
      largeStraight: 0,
      yahtzee: 0,
      chance: 10,
    };
    // Bob has 12 filled with higher totals so the moment he scores the
    // 13th (chance with 30 from [6,6,6,6,6]) he wins decisively.
    const bobScores = {
      ones: 5,
      twos: 8,
      threes: 12,
      fours: 16,
      fives: 20,
      sixes: 24, // upper sum = 85 → bonus
      threeOfAKind: 20,
      fourOfAKind: 20,
      fullHouse: 25,
      smallStraight: 30,
      largeStraight: 40,
      yahtzee: 50,
      chance: null,
    };
    const { state, finalCategory } = nearEndState({
      aliceScores,
      bobScores,
      finalCategory: 'chance',
      finalDice: [6, 6, 6, 6, 6],
    });
    const r = gl.applyAction(state, 'p2', 'scoreCategory', { category: finalCategory });
    expect(r.error).toBeUndefined();
    expect(r.state.status).toBe('finished');
    expect(r.state.winner).toBe('p2');
    const go = r.events.find((e) => e.type === 'GAME_OVER');
    expect(go).toBeDefined();
    expect(go.data.winner).toBe('p2');
    expect(go.data.finalScores).toHaveLength(2);
    expect(go.data.finalScores.find((s) => s.userId === 'p2').username).toBe('Bob');
  });

  test('upper bonus is applied when upper subtotal >= threshold', () => {
    // Bob fills upper section to exactly 63 (= 1+2+3+4+5+6 each three times).
    const bobScores = {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 18, // sum = 63
      threeOfAKind: 0,
      fourOfAKind: 0,
      fullHouse: 0,
      smallStraight: 0,
      largeStraight: 0,
      yahtzee: 0,
      chance: null,
    };
    const aliceScores = {
      ones: 1,
      twos: 2,
      threes: 3,
      fours: 4,
      fives: 5,
      sixes: 6,
      threeOfAKind: 0,
      fourOfAKind: 0,
      fullHouse: 0,
      smallStraight: 0,
      largeStraight: 0,
      yahtzee: 0,
      chance: 0,
    };
    const { state } = nearEndState({
      aliceScores,
      bobScores,
      finalCategory: 'chance',
      finalDice: [1, 1, 1, 1, 1],
    });
    const r = gl.applyAction(state, 'p2', 'scoreCategory', { category: 'chance' });
    expect(r.error).toBeUndefined();
    const bobFinal = r.events
      .find((e) => e.type === 'GAME_OVER')
      .data.finalScores.find((s) => s.username === 'Bob');
    expect(bobFinal.upperSubtotal).toBe(63);
    expect(bobFinal.upperBonus).toBe(35);
  });

  test('upper bonus is NOT applied when upper subtotal < threshold', () => {
    const bobScores = {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 12, // sum = 57
      threeOfAKind: 0,
      fourOfAKind: 0,
      fullHouse: 0,
      smallStraight: 0,
      largeStraight: 0,
      yahtzee: 0,
      chance: null,
    };
    const aliceScores = {
      ones: 0,
      twos: 0,
      threes: 0,
      fours: 0,
      fives: 0,
      sixes: 0,
      threeOfAKind: 0,
      fourOfAKind: 0,
      fullHouse: 0,
      smallStraight: 0,
      largeStraight: 0,
      yahtzee: 0,
      chance: 0,
    };
    const { state } = nearEndState({
      aliceScores,
      bobScores,
      finalCategory: 'chance',
      finalDice: [1, 1, 1, 1, 1],
    });
    const r = gl.applyAction(state, 'p2', 'scoreCategory', { category: 'chance' });
    const bobFinal = r.events
      .find((e) => e.type === 'GAME_OVER')
      .data.finalScores.find((s) => s.username === 'Bob');
    expect(bobFinal.upperSubtotal).toBe(57);
    expect(bobFinal.upperBonus).toBe(0);
  });

  test('tie sets winner to an array of userIds', () => {
    // Both end with identical grand totals.
    const sharedScores = {
      ones: 0,
      twos: 0,
      threes: 0,
      fours: 0,
      fives: 0,
      sixes: 0,
      threeOfAKind: 0,
      fourOfAKind: 0,
      fullHouse: 0,
      smallStraight: 0,
      largeStraight: 0,
      yahtzee: 0,
    };
    const aliceScores = { ...sharedScores, chance: 5 };
    const bobScores = { ...sharedScores }; // chance unset
    const { state } = nearEndState({
      aliceScores,
      bobScores,
      finalCategory: 'chance',
      finalDice: [1, 1, 1, 1, 1], // chance=5
    });
    const r = gl.applyAction(state, 'p2', 'scoreCategory', { category: 'chance' });
    expect(r.error).toBeUndefined();
    expect(Array.isArray(r.state.winner)).toBe(true);
    expect(r.state.winner).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect(r.state.winner).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// finalizeGame is exported so it can be unit-tested directly with synthetic
// completed score sheets — edge cases like 3-way ties or exact-threshold
// upper bonuses would otherwise require driving through ~26 dice rolls.

describe('Yahtzee — finalizeGame (direct unit tests)', () => {
  // Build a player whose every category is filled with a constant value so
  // the totals are easy to reason about.
  function filledPlayer(name, scores) {
    const sheet = {};
    for (const c of gl.CATEGORIES) sheet[c] = 0;
    Object.assign(sheet, scores);
    return makePlayer(name, name, sheet);
  }

  test('three-way tie returns winner as an array of all three userIds', () => {
    // Three players each with identical chance=10 and zero everywhere else.
    // filledPlayer uses the same string for both userId and username, so the
    // assertions below double as "userIds match" and "usernames match."
    const players = ['A', 'B', 'C'].map((n) => filledPlayer(n, { chance: 10 }));
    const state = makeState({ players });
    const { state: out, events } = gl.finalizeGame(state, players, [], []);
    expect(out.status).toBe('finished');
    expect(Array.isArray(out.winner)).toBe(true);
    expect(out.winner).toHaveLength(3);
    expect(out.winner).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    const go = events.find((e) => e.type === 'GAME_OVER');
    expect(go.data.finalScores).toHaveLength(3);
    expect(go.data.finalScores.every((s) => s.grandTotal === 10)).toBe(true);
    expect(go.data.finalScores.every((s) => s.userId && s.username)).toBe(true);
  });

  test('upper bonus applied at exactly the threshold (63 → +35)', () => {
    // Upper section sums to exactly 63: 1+2+3+4+5+6 = 21 per dice value times
    // three repetitions = ... actually use the canonical "three of each face":
    // ones=3, twos=6, threes=9, fours=12, fives=15, sixes=18 → sum 63.
    const winner = filledPlayer('W', {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 18,
    });
    const loser = filledPlayer('L', { chance: 1 });
    const state = makeState({ players: [winner, loser] });
    const { state: out, events } = gl.finalizeGame(state, [winner, loser], [], []);
    const wScore = events
      .find((e) => e.type === 'GAME_OVER')
      .data.finalScores.find((s) => s.username === 'W');
    expect(wScore.upperSubtotal).toBe(63);
    expect(wScore.upperBonus).toBe(35);
    expect(wScore.grandTotal).toBe(63 + 35); // no lower-section points
    expect(out.winner).toBe('W');
  });

  test('upper bonus NOT applied when subtotal is one below threshold (62 → 0)', () => {
    // 1+2+3+4+5+18=33? Let me just construct: ones=3,twos=6,threes=9,fours=12,fives=15,sixes=17 → 62.
    // sixes can't be 17 (only multiples of 6 are valid sums of 6s) but we
    // bypass that — finalizeGame trusts the score sheet, doesn't re-validate.
    const winner = filledPlayer('W', {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 17,
    });
    const loser = filledPlayer('L', { chance: 100 });
    const state = makeState({ players: [winner, loser] });
    const { state: out, events } = gl.finalizeGame(state, [winner, loser], [], []);
    const wScore = events
      .find((e) => e.type === 'GAME_OVER')
      .data.finalScores.find((s) => s.username === 'W');
    expect(wScore.upperSubtotal).toBe(62);
    expect(wScore.upperBonus).toBe(0);
    expect(wScore.grandTotal).toBe(62); // no bonus, no lower
    expect(out.winner).toBe('L'); // loser wins with chance=100
  });

  test('appends GAME_OVER and winner-message log to baseEvents/baseLog', () => {
    const p = filledPlayer('Solo', { chance: 5 });
    const baseEvents = [{ type: 'CATEGORY_SCORED', data: {}, timestamp: 0 }];
    const baseLog = [{ message: 'Solo scored 5 in chance', type: 'score', timestamp: 0 }];
    const { state: out, events } = gl.finalizeGame(
      makeState({ players: [p] }),
      [p],
      baseEvents,
      baseLog,
    );
    // baseEvents preserved + GAME_OVER appended
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('CATEGORY_SCORED');
    expect(events[1].type).toBe('GAME_OVER');
    // baseLog preserved + winner-message appended
    expect(out.log).toHaveLength(2);
    expect(out.log[0].type).toBe('score');
    expect(out.log[1].type).toBe('game');
    expect(out.log[1].message).toMatch(/Solo wins with 5/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — getValidActions', () => {
  test('returns [] when game is not playing', () => {
    const s = makeState({ status: 'finished' });
    expect(gl.getValidActions(s, 'p1')).toEqual([]);
  });

  test('returns [] for the non-current player', () => {
    expect(gl.getValidActions(makeState(), 'p2')).toEqual([]);
  });

  test('returns ["rollDice"] before any roll', () => {
    expect(gl.getValidActions(makeState(), 'p1')).toEqual(['rollDice']);
  });

  test('returns ["rollDice", "scoreCategory"] after roll 1', () => {
    const s = makeState();
    s.turnState.rollsUsed = 1;
    s.turnState.dice = [1, 2, 3, 4, 5];
    expect(gl.getValidActions(s, 'p1')).toEqual(['rollDice', 'scoreCategory']);
  });

  test('returns only ["scoreCategory"] after the 3rd roll (no rolls remaining)', () => {
    const s = makeState();
    s.turnState.rollsUsed = 3;
    s.turnState.dice = [1, 2, 3, 4, 5];
    expect(gl.getValidActions(s, 'p1')).toEqual(['scoreCategory']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — skipTurn', () => {
  test('advances to the next player and clears turn state', () => {
    const s = makeState();
    s.turnState.dice = [1, 2, 3, 4, 5];
    s.turnState.rollsUsed = 2;
    s.turnState.held = [true, false, true, false, false];
    const r = gl.skipTurn(s, 'p1');
    expect(r.error).toBeUndefined();
    expect(r.state.turnState.currentPlayerIndex).toBe(1);
    expect(r.state.turnState.dice).toEqual([]);
    expect(r.state.turnState.rollsUsed).toBe(0);
    expect(r.state.turnState.held.every((h) => h === false)).toBe(true);
    expect(r.events.map((e) => e.type)).toContain('TURN_SKIPPED');
  });

  test('does NOT auto-score on behalf of the skipped player', () => {
    const s = makeState();
    s.turnState.dice = [1, 1, 1, 1, 1];
    s.turnState.rollsUsed = 3;
    const r = gl.skipTurn(s, 'p1');
    for (const cat of gl.CATEGORIES) expect(r.state.players[0].scoreSheet[cat]).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — solo (1-player) is supported', () => {
  test('initGame works with a single player and turn rotation stays on them', () => {
    const players = [makePlayer('solo', 'Solo')];
    const s = gl.initGame('g1', 'T', players, CFG);
    expect(s.players).toHaveLength(1);
    // Score a category; turn should advance back to the same player.
    const t = {
      ...s,
      turnState: { ...s.turnState, dice: [1, 1, 1, 4, 5], rollsUsed: 1 },
    };
    const r = gl.applyAction(t, 'solo', 'scoreCategory', { category: 'ones' });
    expect(r.error).toBeUndefined();
    expect(r.state.status).toBe('playing'); // not over yet
    expect(r.state.turnState.currentPlayerIndex).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — migrate', () => {
  test('returns the state unchanged when stateVersion matches', () => {
    const s = { stateVersion: gl.STATE_VERSION, anything: 'goes' };
    expect(gl.migrate(s)).toBe(s);
  });

  test('throws on any other version (no migrations defined yet)', () => {
    expect(() => gl.migrate({ stateVersion: 0 })).toThrow(/No migration path/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Yahtzee — getActionDescriptors', () => {
  /** Convenience: set state to "Alice's turn, N rolls used, dice rolled." */
  function withRoll(state, rollsUsed, dice) {
    return {
      ...state,
      turnState: { ...state.turnState, rollsUsed, dice },
    };
  }

  // ── rollDice ─────────────────────────────────────────────────────────────

  test('rollDice present and enabled before any roll', () => {
    const d = gl.getActionDescriptors(makeState(), 'p1');
    const roll = d.find((x) => x.action === 'rollDice');
    expect(roll).toBeDefined();
    expect(roll.enabled).toBe(true);
    expect(roll.label).toBe('Roll dice');
  });

  test('rollDice label is "Roll N of 3" on subsequent rolls', () => {
    const s = withRoll(makeState(), 1, [1, 2, 3, 4, 5]);
    const d = gl.getActionDescriptors(s, 'p1');
    expect(d.find((x) => x.action === 'rollDice').label).toBe('Roll 2 of 3');
    const s3 = withRoll(makeState(), 2, [1, 2, 3, 4, 5]);
    const d3 = gl.getActionDescriptors(s3, 'p1');
    expect(d3.find((x) => x.action === 'rollDice').label).toBe('Roll 3 of 3');
  });

  test('rollDice present but disabled after rolls exhausted', () => {
    const s = withRoll(makeState(), 3, [1, 2, 3, 4, 5]);
    const d = gl.getActionDescriptors(s, 'p1');
    const roll = d.find((x) => x.action === 'rollDice');
    expect(roll.enabled).toBe(false);
    expect(roll.hint).toMatch(/choose a category/);
  });

  test('rollDice absent on opponent turn (descriptor list empty)', () => {
    expect(gl.getActionDescriptors(makeState(), 'p2')).toEqual([]);
  });

  // ── scoreCategory ────────────────────────────────────────────────────────

  test('no scoreCategory descriptors before any roll (option (a))', () => {
    const d = gl.getActionDescriptors(makeState(), 'p1');
    expect(d.filter((x) => x.action === 'scoreCategory')).toEqual([]);
    // Only rollDice should be present.
    expect(d.map((x) => x.action)).toEqual(['rollDice']);
  });

  test('13 scoreCategory descriptors after one roll, all categories unscored', () => {
    const s = withRoll(makeState(), 1, [1, 2, 3, 4, 5]);
    const d = gl.getActionDescriptors(s, 'p1');
    const scoreDescs = d.filter((x) => x.action === 'scoreCategory');
    expect(scoreDescs).toHaveLength(13);
    // Every CATEGORIES entry appears exactly once.
    const cats = scoreDescs.map((x) => x.data.category).sort();
    expect(cats).toEqual([...gl.CATEGORIES].sort());
  });

  test('scoreCategory descriptors decrement as categories are scored', () => {
    const p1 = makePlayer('p1', 'Alice');
    fillSheet(p1, { ones: 3, twos: 6, fullHouse: 25 });
    const s = withRoll(makeState({ players: [p1, makePlayer('p2', 'Bob')] }), 1, [1, 1, 1, 2, 2]);
    const d = gl.getActionDescriptors(s, 'p1');
    const scoreDescs = d.filter((x) => x.action === 'scoreCategory');
    expect(scoreDescs).toHaveLength(13 - 3);
    const cats = new Set(scoreDescs.map((x) => x.data.category));
    expect(cats.has('ones')).toBe(false);
    expect(cats.has('twos')).toBe(false);
    expect(cats.has('fullHouse')).toBe(false);
  });

  test("each descriptor's previewScore equals scoreFor(category, dice, config)", () => {
    const dice = [3, 3, 3, 5, 5];
    const s = withRoll(makeState(), 1, dice);
    const d = gl.getActionDescriptors(s, 'p1');
    for (const desc of d.filter((x) => x.action === 'scoreCategory')) {
      const expected = gl.scoreFor(desc.data.category, dice, CFG);
      expect(desc.data.previewScore).toBe(expected);
    }
  });

  test('descriptor label includes the preview score (even zero)', () => {
    // Dice [1,1,1,1,1] form a yahtzee (5 of a kind). For yahtzee → 50,
    // for fullHouse → 0 (standard rule: 5 of a kind is NOT a full house).
    const s = withRoll(makeState(), 1, [1, 1, 1, 1, 1]);
    const d = gl.getActionDescriptors(s, 'p1');
    const yahtzeeDesc = d.find((x) => x.data?.category === 'yahtzee');
    const fullHouseDesc = d.find((x) => x.data?.category === 'fullHouse');
    expect(yahtzeeDesc.data.previewScore).toBe(50);
    expect(yahtzeeDesc.label).toBe('Score Yahtzee for 50');
    expect(fullHouseDesc.data.previewScore).toBe(0);
    expect(fullHouseDesc.label).toBe('Score Full House for 0');
  });

  test('category scored at 0 does NOT generate a future descriptor', () => {
    // Player deliberately punted yahtzee at 0; that category is now used.
    const p1 = makePlayer('p1', 'Alice');
    fillSheet(p1, { yahtzee: 0 });
    const s = withRoll(makeState({ players: [p1, makePlayer('p2', 'Bob')] }), 1, [1, 1, 1, 1, 1]);
    const d = gl.getActionDescriptors(s, 'p1');
    const yahtzeeDesc = d.find((x) => x.data?.category === 'yahtzee');
    expect(yahtzeeDesc).toBeUndefined();
    // All 12 other categories remain.
    expect(d.filter((x) => x.action === 'scoreCategory')).toHaveLength(12);
  });

  // ── final / end states ───────────────────────────────────────────────────

  test('final-category state: rollDice + 1 scoreCategory', () => {
    const p1 = makePlayer('p1', 'Alice');
    // Fill everything except chance.
    for (const cat of gl.CATEGORIES) {
      if (cat !== 'chance') p1.scoreSheet[cat] = 10;
    }
    const s = withRoll(makeState({ players: [p1, makePlayer('p2', 'Bob')] }), 1, [6, 6, 6, 6, 6]);
    const d = gl.getActionDescriptors(s, 'p1');
    expect(d).toHaveLength(2);
    expect(d.map((x) => x.action).sort()).toEqual(['rollDice', 'scoreCategory']);
    expect(d.find((x) => x.action === 'scoreCategory').data.category).toBe('chance');
  });

  test('finished game returns no descriptors for either player', () => {
    const s = { ...makeState(), status: 'finished' };
    expect(gl.getActionDescriptors(s, 'p1')).toEqual([]);
    expect(gl.getActionDescriptors(s, 'p2')).toEqual([]);
  });

  test('safe on pre-initGame waiting-room state', () => {
    expect(gl.getActionDescriptors({ status: 'waiting', players: [] }, 'p1')).toEqual([]);
  });

  // ── solo + multi-player turn rotation ────────────────────────────────────

  test('solo game (1 player): descriptors work for the lone player', () => {
    const solo = makePlayer('solo', 'Hermit');
    const s = makeState({ players: [solo] });
    const d = gl.getActionDescriptors(s, 'solo');
    expect(d.find((x) => x.action === 'rollDice')).toBeDefined();
  });

  test('descriptor list flips between players as the turn rotates', () => {
    const s1 = makeState();
    expect(gl.getActionDescriptors(s1, 'p1').length).toBeGreaterThan(0);
    expect(gl.getActionDescriptors(s1, 'p2')).toEqual([]);
    const s2 = { ...s1, turnState: { ...s1.turnState, currentPlayerIndex: 1 } };
    expect(gl.getActionDescriptors(s2, 'p1')).toEqual([]);
    expect(gl.getActionDescriptors(s2, 'p2').length).toBeGreaterThan(0);
  });

  test('every returned descriptor carries action/label/enabled', () => {
    const s = withRoll(makeState(), 2, [3, 3, 3, 5, 5]);
    for (const d of gl.getActionDescriptors(s, 'p1')) {
      expect(typeof d.action).toBe('string');
      expect(typeof d.label).toBe('string');
      expect(typeof d.enabled).toBe('boolean');
    }
  });
});
