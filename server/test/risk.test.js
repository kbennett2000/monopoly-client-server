'use strict';

const risk = require('../games/risk/game-logic');

// ── fixtures ──────────────────────────────────────────────────────────────────

function makePlayers(count) {
  const users = [
    { id: 'u1', username: 'Alice' },
    { id: 'u2', username: 'Bob'   },
    { id: 'u3', username: 'Carol' },
    { id: 'u4', username: 'Dave'  },
    { id: 'u5', username: 'Eve'   },
    { id: 'u6', username: 'Frank' },
  ].slice(0, count);
  const cfg = risk.getConfigCopy();
  const list = [];
  for (const u of users) list.push(risk.createInitialPlayer(u, list, cfg));
  return list;
}

function makeGame(playerCount = 2) {
  const players = makePlayers(playerCount);
  const config  = risk.getConfigCopy();
  return risk.initGame('test-game', 'Test', players, config);
}

/** Reassign every territory to a single player (for combat/fortify tests). */
function giveAllTerritoriesTo(state, userId, armiesEach = 1) {
  for (const tid of Object.keys(state.territories)) {
    state.territories[tid] = { ownerId: userId, armies: armiesEach };
  }
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — metadata and config', () => {
  test('getGameMetadata returns the expected shape', () => {
    const m = risk.getGameMetadata();
    expect(m.name).toBe('Risk');
    expect(m.minPlayers).toBe(2);
    expect(m.maxPlayers).toBe(6);
  });

  test('STATE_VERSION is exported as a positive integer', () => {
    expect(typeof risk.STATE_VERSION).toBe('number');
    expect(risk.STATE_VERSION).toBeGreaterThanOrEqual(1);
  });

  test('loadConfig returns 42 territories, 6 continents, 44 cards', () => {
    const cfg = risk.loadConfig();
    expect(cfg.board.territories).toHaveLength(42);
    expect(Object.keys(cfg.board.continents)).toHaveLength(6);
    expect(cfg.cards).toHaveLength(44);
  });

  test('getConfigCopy returns an independent clone', () => {
    const a = risk.getConfigCopy();
    const b = risk.getConfigCopy();
    expect(a).not.toBe(b);
    a.settings.attackerMaxDice = 999;
    expect(b.settings.attackerMaxDice).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — initGame', () => {
  test('stamps stateVersion and starts in reinforce phase', () => {
    const s = makeGame(2);
    expect(s.stateVersion).toBe(risk.STATE_VERSION);
    expect(s.status).toBe('playing');
    expect(s.turnState.phase).toBe('reinforce');
    expect(s.turnState.currentPlayerIndex).toBe(0);
  });

  test('distributes all 42 territories with armies to all players', () => {
    const s = makeGame(2);
    const aliceTerritories = risk.getOwnedTerritories(s, 'u1');
    const bobTerritories   = risk.getOwnedTerritories(s, 'u2');
    expect(aliceTerritories.length + bobTerritories.length).toBe(42);
    expect(Math.abs(aliceTerritories.length - bobTerritories.length)).toBeLessThanOrEqual(1);
    // No unowned territories
    const unowned = Object.values(s.territories).filter(t => t.ownerId === null);
    expect(unowned).toHaveLength(0);
  });

  test('places exactly initialArmies per player', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s    = makeGame(n);
      const cfg  = risk.getConfigCopy();
      const want = cfg.settings.initialArmiesByPlayerCount[String(n)];
      for (const p of s.players) {
        const total = Object.values(s.territories)
          .filter(t => t.ownerId === p.userId)
          .reduce((sum, t) => sum + t.armies, 0);
        expect(total).toBe(want);
      }
    }
  });

  test('every owned territory has at least 1 army', () => {
    const s = makeGame(4);
    for (const t of Object.values(s.territories)) {
      if (t.ownerId !== null) expect(t.armies).toBeGreaterThanOrEqual(1);
    }
  });

  test('first player gets reinforcement armies in turnState.armiesToPlace', () => {
    const s = makeGame(2);
    expect(s.turnState.armiesToPlace).toBeGreaterThanOrEqual(3);
  });

  test('deck contains all 44 cards', () => {
    const s = makeGame(2);
    expect(s.deck).toHaveLength(44);
    expect(s.discardPile).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — createInitialPlayer', () => {
  test('assigns unique colours and starts with empty hand', () => {
    const players = makePlayers(4);
    const colors  = players.map(p => p.color);
    expect(new Set(colors).size).toBe(4);
    for (const p of players) {
      expect(p.hand).toEqual([]);
      expect(p.eliminated).toBe(false);
      expect(p.active).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — reinforcement calculation', () => {
  test('minimum reinforcement is 3 even with few territories', () => {
    const s    = makeGame(2);
    // Give Alice exactly 1 territory
    Object.keys(s.territories).forEach((tid, idx) => {
      s.territories[tid] = { ownerId: idx === 0 ? 'u1' : 'u2', armies: 1 };
    });
    expect(risk.computeReinforcements(s, 'u1')).toBeGreaterThanOrEqual(3);
  });

  test('formula is floor(territories/3) when above minimum', () => {
    const s = makeGame(2);
    // Give Alice 21 territories — floor(21/3) = 7 (well above the minimum 3)
    giveAllTerritoriesTo(s, 'u2');
    const half = Object.keys(s.territories).slice(0, 21);
    for (const tid of half) s.territories[tid].ownerId = 'u1';
    const base = risk.computeReinforcements(s, 'u1');
    // 21/3 = 7 base, plus any continent bonuses (could be 0 depending on which 21)
    expect(base).toBeGreaterThanOrEqual(7);
  });

  test('controlling a full continent grants its bonus', () => {
    const s   = makeGame(2);
    const cfg = s.config;
    // Give Alice all of Australia (4 territories, bonus 2), plus filler so base ≥ 3.
    giveAllTerritoriesTo(s, 'u2');
    for (const tid of cfg.board.continents.australia.territories) {
      s.territories[tid] = { ownerId: 'u1', armies: 1 };
    }
    // 4 territories → base = max(3, floor(4/3)) = 3; plus 2 continent bonus = 5.
    expect(risk.computeReinforcements(s, 'u1')).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — placeReinforcement', () => {
  test('places armies on an owned territory and decrements the pool', () => {
    const s   = makeGame(2);
    const tid = risk.getOwnedTerritories(s, s.players[s.turnState.currentPlayerIndex].userId)[0];
    const before = s.territories[tid].armies;
    const pool   = s.turnState.armiesToPlace;
    const result = risk.applyAction(s, s.players[0].userId, 'placeReinforcement', { territoryId: tid, count: 2 });
    expect(result.error).toBeUndefined();
    expect(result.state.territories[tid].armies).toBe(before + 2);
    expect(result.state.turnState.armiesToPlace).toBe(pool - 2);
  });

  test('rejects placement on a territory you do not own', () => {
    const s    = makeGame(2);
    const enemyTid = risk.getOwnedTerritories(s, 'u2')[0];
    const result = risk.applyAction(s, 'u1', 'placeReinforcement', { territoryId: enemyTid, count: 1 });
    expect(result.error).toMatch(/do not own/);
  });

  test('rejects placing more armies than you have', () => {
    const s   = makeGame(2);
    const tid = risk.getOwnedTerritories(s, 'u1')[0];
    const result = risk.applyAction(s, 'u1', 'placeReinforcement', { territoryId: tid, count: 9999 });
    expect(result.error).toMatch(/armies to place/);
  });

  test('rejects placement when it is not your turn', () => {
    const s = makeGame(2);
    const tid = risk.getOwnedTerritories(s, 'u2')[0];
    const result = risk.applyAction(s, 'u2', 'placeReinforcement', { territoryId: tid, count: 1 });
    expect(result.error).toMatch(/not your turn/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — endReinforcePhase', () => {
  test('advances to attack phase when all armies are placed', () => {
    const s = makeGame(2);
    s.turnState.armiesToPlace = 0;
    const result = risk.applyAction(s, 'u1', 'endReinforcePhase');
    expect(result.error).toBeUndefined();
    expect(result.state.turnState.phase).toBe('attack');
  });

  test('refuses to advance if you still have armies to place', () => {
    const s = makeGame(2);
    s.turnState.armiesToPlace = 3;
    const result = risk.applyAction(s, 'u1', 'endReinforcePhase');
    expect(result.error).toMatch(/armies to place/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — combat (resolveCombat is pure)', () => {
  test('one die each: higher attacker wins', () => {
    // We can't pin the dice without mocking Math.random; instead test invariants
    // across many trials.
    for (let i = 0; i < 100; i++) {
      const r = risk.resolveCombat(1, 1);
      expect(r.attackerLosses + r.defenderLosses).toBe(1);
      expect(r.attackerRolls).toHaveLength(1);
      expect(r.defenderRolls).toHaveLength(1);
    }
  });

  test('3 vs 2: max 2 losses per side, sum is exactly 2', () => {
    for (let i = 0; i < 100; i++) {
      const r = risk.resolveCombat(3, 2);
      expect(r.attackerLosses + r.defenderLosses).toBe(2);
      expect(r.attackerRolls).toHaveLength(3);
      expect(r.defenderRolls).toHaveLength(2);
      // Each side's rolls are sorted descending
      expect(r.attackerRolls).toEqual([...r.attackerRolls].sort((a, b) => b - a));
      expect(r.defenderRolls).toEqual([...r.defenderRolls].sort((a, b) => b - a));
    }
  });

  test('ties go to the defender', () => {
    // Manually construct a tie scenario by mocking Math.random
    const original = Math.random;
    Math.random = () => 0; // every die rolls 1
    try {
      const r = risk.resolveCombat(2, 2);
      // Both sides roll 1,1 — pairs are 1==1 and 1==1, both ties → attacker loses both
      expect(r.attackerLosses).toBe(2);
      expect(r.defenderLosses).toBe(0);
    } finally {
      Math.random = original;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — attackTerritory action', () => {
  function makeAttackScenario() {
    // Construct a deterministic 2-player state where u1 owns Alaska (10 armies)
    // and u2 owns Kamchatka (1 army).  These two are adjacent.
    const s = makeGame(2);
    s.turnState.phase = 'attack';
    s.turnState.armiesToPlace = 0;
    // Reset and fully assign
    for (const tid of Object.keys(s.territories)) {
      s.territories[tid] = { ownerId: 'u2', armies: 1 };
    }
    s.territories['alaska']    = { ownerId: 'u1', armies: 10 };
    s.territories['kamchatka'] = { ownerId: 'u2', armies: 1 };
    return s;
  }

  test('rejects attacking your own territory', () => {
    const s = makeAttackScenario();
    s.territories['kamchatka'] = { ownerId: 'u1', armies: 1 };
    const result = risk.applyAction(s, 'u1', 'attackTerritory', { from: 'alaska', to: 'kamchatka', attackerDice: 3 });
    expect(result.error).toMatch(/own territory/);
  });

  test('rejects attacking a non-adjacent territory', () => {
    const s = makeAttackScenario();
    const result = risk.applyAction(s, 'u1', 'attackTerritory', { from: 'alaska', to: 'argentina', attackerDice: 3 });
    expect(result.error).toMatch(/not adjacent/);
  });

  test('rejects attacking with fewer than 2 armies in source', () => {
    const s = makeAttackScenario();
    s.territories['alaska'].armies = 1;
    const result = risk.applyAction(s, 'u1', 'attackTerritory', { from: 'alaska', to: 'kamchatka', attackerDice: 1 });
    expect(result.error).toMatch(/at least 2 armies/);
  });

  test('conquers a 1-army defender when attacker rolls high', () => {
    const s = makeAttackScenario();
    const original = Math.random;
    // Force attacker high (6,6,6) and defender low (1)
    let calls = 0;
    Math.random = () => {
      const v = calls < 3 ? 0.99 : 0; // 0.99 → 6, 0 → 1
      calls++;
      return v;
    };
    try {
      const result = risk.applyAction(s, 'u1', 'attackTerritory', { from: 'alaska', to: 'kamchatka', attackerDice: 3 });
      expect(result.error).toBeUndefined();
      expect(result.state.territories['kamchatka'].ownerId).toBe('u1');
      // attacker moved 3 armies in (= attackerDice per D4)
      expect(result.state.territories['kamchatka'].armies).toBe(3);
      expect(result.state.territories['alaska'].armies).toBe(7); // 10 - 3 moved in - 0 losses
      // marked conqueredThisTurn for end-of-turn card draw
      expect(result.state.players.find(p => p.userId === 'u1').conqueredThisTurn).toBe(true);
      // events fired
      const types = result.events.map(e => e.type);
      expect(types).toContain('ATTACK_DECLARED');
      expect(types).toContain('DICE_ROLLED');
      expect(types).toContain('TERRITORY_CONQUERED');
    } finally {
      Math.random = original;
    }
  });

  test('eliminates a defender who loses their last territory and transfers cards', () => {
    const s = makeAttackScenario();
    // Give u2 only Kamchatka, plus a card in hand
    for (const tid of Object.keys(s.territories)) {
      if (s.territories[tid].ownerId === 'u2' && tid !== 'kamchatka') {
        s.territories[tid] = { ownerId: 'u1', armies: 1 };
      }
    }
    s.players.find(p => p.userId === 'u2').hand = [
      { id: 'card-x', territoryId: 'venezuela', troopType: 'infantry' },
    ];
    const original = Math.random;
    let calls = 0;
    Math.random = () => { const v = calls < 3 ? 0.99 : 0; calls++; return v; };
    try {
      const result = risk.applyAction(s, 'u1', 'attackTerritory', { from: 'alaska', to: 'kamchatka', attackerDice: 3 });
      expect(result.error).toBeUndefined();
      const u2 = result.state.players.find(p => p.userId === 'u2');
      const u1 = result.state.players.find(p => p.userId === 'u1');
      expect(u2.eliminated).toBe(true);
      expect(u2.hand).toEqual([]);
      expect(u1.hand).toHaveLength(1);
      expect(u1.hand[0].id).toBe('card-x');
      // GAME_OVER fired because u1 now owns all territories
      const types = result.events.map(e => e.type);
      expect(types).toContain('PLAYER_ELIMINATED');
      expect(types).toContain('GAME_OVER');
      expect(result.state.status).toBe('finished');
      expect(result.state.winner).toBe('u1');
    } finally {
      Math.random = original;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — fortify connectivity (canFortifyPath)', () => {
  test('returns true for a chain of friendly territories', () => {
    const s = makeGame(2);
    giveAllTerritoriesTo(s, 'u1');
    // Alaska → Kamchatka direct adjacency
    expect(risk.canFortifyPath(s, 'alaska', 'kamchatka', 'u1')).toBe(true);
  });

  test('returns false if every path is blocked by enemy territory', () => {
    const s = makeGame(2);
    giveAllTerritoriesTo(s, 'u1');
    // To reach Siam from Eastern Australia you MUST go through Indonesia
    // (eastern-australia → new-guinea/western-australia → indonesia → siam).
    // Blocking Indonesia disconnects the two.
    s.territories['indonesia'] = { ownerId: 'u2', armies: 1 };
    expect(risk.canFortifyPath(s, 'eastern-australia', 'siam', 'u1')).toBe(false);
  });

  test('returns false if source equals destination', () => {
    const s = makeGame(2);
    giveAllTerritoriesTo(s, 'u1');
    expect(risk.canFortifyPath(s, 'alaska', 'alaska', 'u1')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — card-set validation', () => {
  const inf = (id) => ({ id, territoryId: 't', troopType: 'infantry'  });
  const cav = (id) => ({ id, territoryId: 't', troopType: 'cavalry'   });
  const art = (id) => ({ id, territoryId: 't', troopType: 'artillery' });
  const wld = (id) => ({ id, territoryId: null, troopType: 'wild'     });

  test('three of the same troop type', () => {
    expect(risk.isValidCardSet([inf('1'), inf('2'), inf('3')])).toBe(true);
  });

  test('one of each troop type', () => {
    expect(risk.isValidCardSet([inf('1'), cav('2'), art('3')])).toBe(true);
  });

  test('two of one type plus a wild', () => {
    expect(risk.isValidCardSet([inf('1'), inf('2'), wld('3')])).toBe(true);
  });

  test('two random + wild always works', () => {
    expect(risk.isValidCardSet([inf('1'), cav('2'), wld('3')])).toBe(true);
  });

  test('two of one type without a wild is NOT valid', () => {
    expect(risk.isValidCardSet([inf('1'), inf('2'), cav('3')])).toBe(false);
  });

  test('must be exactly 3 cards', () => {
    expect(risk.isValidCardSet([inf('1'), inf('2')])).toBe(false);
    expect(risk.isValidCardSet([inf('1'), inf('2'), inf('3'), inf('4')])).toBe(false);
  });
});

describe('Risk — escalating card bonuses', () => {
  test('matches the classic 4, 6, 8, 10, 12, 15, 20, 25 sequence', () => {
    const s = makeGame(2);
    s.cardSetsTraded = 0; expect(risk.nextSetBonus(s)).toBe(4);
    s.cardSetsTraded = 1; expect(risk.nextSetBonus(s)).toBe(6);
    s.cardSetsTraded = 2; expect(risk.nextSetBonus(s)).toBe(8);
    s.cardSetsTraded = 3; expect(risk.nextSetBonus(s)).toBe(10);
    s.cardSetsTraded = 4; expect(risk.nextSetBonus(s)).toBe(12);
    s.cardSetsTraded = 5; expect(risk.nextSetBonus(s)).toBe(15);
    s.cardSetsTraded = 6; expect(risk.nextSetBonus(s)).toBe(20);
    s.cardSetsTraded = 7; expect(risk.nextSetBonus(s)).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — getStateForPlayer (SECURITY-CRITICAL)', () => {
  test('the calling player sees their own hand', () => {
    const s = makeGame(2);
    s.players.find(p => p.userId === 'u1').hand = [
      { id: 'c1', territoryId: 'alaska', troopType: 'infantry' },
    ];
    const view = risk.getStateForPlayer(s, 'u1');
    const u1 = view.players.find(p => p.userId === 'u1');
    expect(u1.hand).toEqual([{ id: 'c1', territoryId: 'alaska', troopType: 'infantry' }]);
  });

  test('OTHER players hands are stripped and replaced with handCount', () => {
    const s = makeGame(2);
    s.players.find(p => p.userId === 'u2').hand = [
      { id: 'c1', territoryId: 'brazil',   troopType: 'cavalry' },
      { id: 'c2', territoryId: 'egypt',    troopType: 'infantry' },
      { id: 'c3', territoryId: null,       troopType: 'wild' },
    ];
    const view = risk.getStateForPlayer(s, 'u1');
    const u2 = view.players.find(p => p.userId === 'u2');
    expect(u2).not.toHaveProperty('hand');
    expect(u2.handCount).toBe(3);
  });

  test('the deck and discard contents are replaced with counts', () => {
    const s = makeGame(2);
    const view = risk.getStateForPlayer(s, 'u1');
    expect(view.deck).toEqual({ count: 44 });
    expect(view.discardPile).toEqual({ count: 0 });
  });

  test('does not mutate the input state', () => {
    const s = makeGame(2);
    s.players.find(p => p.userId === 'u2').hand = [
      { id: 'c1', territoryId: 'brazil', troopType: 'cavalry' },
    ];
    const snapshot = JSON.stringify(s);
    risk.getStateForPlayer(s, 'u1');
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  test('a malicious card lookup via the filtered view returns nothing', () => {
    // Even if a client tries to read another player's cards from the view,
    // there is no `hand` property to read.  We probe with a uniquely-named
    // card id that wouldn't legitimately appear elsewhere in the state.
    const s = makeGame(2);
    s.players.find(p => p.userId === 'u2').hand = [
      { id: 'card-secret-canary-xyz', territoryId: 'china', troopType: 'cavalry' },
    ];
    const view = risk.getStateForPlayer(s, 'u1');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('card-secret-canary-xyz');
    // And the masked player has no hand property at all.
    const u2 = view.players.find(p => p.userId === 'u2');
    expect(u2).not.toHaveProperty('hand');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — endTurn and turn rotation', () => {
  test('advances to the next non-eliminated player', () => {
    const s = makeGame(3);
    s.turnState.phase = 'fortify';
    const result = risk.applyAction(s, 'u1', 'endTurn');
    expect(result.error).toBeUndefined();
    expect(result.state.turnState.currentPlayerIndex).toBe(1);
    expect(result.state.turnState.phase).toBe('reinforce');
  });

  test('skips an eliminated player in the rotation', () => {
    const s = makeGame(3);
    s.turnState.phase = 'fortify';
    s.players[1].eliminated = true; // u2 is dead
    const result = risk.applyAction(s, 'u1', 'endTurn');
    expect(result.state.turnState.currentPlayerIndex).toBe(2); // skip to u3
  });

  test('draws a card if the player conquered at least one territory', () => {
    const s = makeGame(2);
    s.turnState.phase = 'fortify';
    s.players[0].conqueredThisTurn = true;
    const before = s.players[0].hand.length;
    const result = risk.applyAction(s, 'u1', 'endTurn');
    expect(result.state.players[0].hand.length).toBe(before + 1);
    expect(result.events.map(e => e.type)).toContain('CARD_DRAWN');
  });

  test('does NOT draw a card if no territory was conquered', () => {
    const s = makeGame(2);
    s.turnState.phase = 'fortify';
    s.players[0].conqueredThisTurn = false;
    const before = s.players[0].hand.length;
    const result = risk.applyAction(s, 'u1', 'endTurn');
    expect(result.state.players[0].hand.length).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — skipTurn (AFK)', () => {
  test('ends the entire current turn and advances to next player', () => {
    const s = makeGame(2);
    s.turnState.phase = 'attack';
    const result = risk.skipTurn(s, 'u1');
    expect(result.state.turnState.currentPlayerIndex).toBe(1);
    expect(result.state.turnState.phase).toBe('reinforce');
    expect(result.events.map(e => e.type)).toContain('TURN_SKIPPED');
  });

  test('isTurnTimerBlocked is always false', () => {
    const s = makeGame(2);
    expect(risk.isTurnTimerBlocked(s)).toBe(false);
    s.turnState.phase = 'attack';
    expect(risk.isTurnTimerBlocked(s)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — getValidActions', () => {
  test('only current player gets actions', () => {
    const s = makeGame(2);
    expect(risk.getValidActions(s, 'u1').length).toBeGreaterThan(0);
    expect(risk.getValidActions(s, 'u2')).toEqual([]);
  });

  test('reinforce phase: includes placeReinforcement', () => {
    const s = makeGame(2);
    expect(risk.getValidActions(s, 'u1')).toContain('placeReinforcement');
    expect(risk.getValidActions(s, 'u1')).not.toContain('endReinforcePhase'); // armies still pending
  });

  test('attack phase: includes attackTerritory and endAttackPhase', () => {
    const s = makeGame(2);
    s.turnState.phase = 'attack';
    expect(risk.getValidActions(s, 'u1')).toEqual(['attackTerritory', 'endAttackPhase']);
  });

  test('fortify phase: fortify gone after use, endTurn always available', () => {
    const s = makeGame(2);
    s.turnState.phase = 'fortify';
    expect(risk.getValidActions(s, 'u1')).toContain('fortify');
    expect(risk.getValidActions(s, 'u1')).toContain('endTurn');
    s.turnState.fortifyUsed = true;
    expect(risk.getValidActions(s, 'u1')).toEqual(['endTurn']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — migrate stub', () => {
  test('throws on any version mismatch (no migrations defined yet)', () => {
    expect(() => risk.migrate({ stateVersion: 0 })).toThrow(/No migration path/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Risk — distributeArmies helper', () => {
  test('sum equals total armies', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const dist = risk.distributeArmies(ids, 17);
    const sum  = Object.values(dist).reduce((s, n) => s + n, 0);
    expect(sum).toBe(17);
  });

  test('max difference between any two counts is at most 1', () => {
    const ids  = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const dist = risk.distributeArmies(ids, 25);
    const counts = Object.values(dist);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});
