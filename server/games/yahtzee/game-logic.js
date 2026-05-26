'use strict';

/**
 * Yahtzee game-logic module.
 * Implements the GameLogic interface defined in server/src/game-logic-interface.js.
 *
 * Standard solo-rolls Yahtzee, multiplayer turn-based.  Each player plays 13
 * rounds; on a turn you get up to 3 rolls (holding any subset between rolls)
 * then must score into one unused category.  Game ends when every player has
 * filled all 13 categories.
 *
 * OUT OF SCOPE for v1: Yahtzee bonuses (rolling a second yahtzee for +100)
 * and joker rules.  Deliberate — keep it simple.  A second yahtzee, if the
 * category is already filled, scores 0 in any other category as normal.
 *
 * ─── State shape ─────────────────────────────────────────────────────────────
 *
 * GameState {
 *   id, name, gameType: 'yahtzee', stateVersion, status, config,
 *   createdBy, minPlayers, maxPlayers,
 *   players: Player[],
 *   turnState: TurnState,
 *   winner: string | string[] | null,  // username, array for ties, null if unfinished
 *   log: LogEntry[]
 * }
 *
 * Player {
 *   userId, username, color, colorHex, token, active, connected,
 *   scoreSheet: {
 *     ones, twos, threes, fours, fives, sixes: number | null,
 *     threeOfAKind, fourOfAKind, fullHouse, smallStraight,
 *     largeStraight, yahtzee, chance: number | null
 *   }
 *   // null = category not yet scored; number = scored value
 *   // (a scored 0 is distinct from null — use `=== null`, not falsy checks)
 * }
 *
 * TurnState {
 *   currentPlayerIndex: number,
 *   dice:             number[]   // length = diceCount; values 1..diceFaces; empty before first roll
 *   held:             boolean[]  // length = diceCount; which dice carry over to next roll
 *   rollsUsed:        number     // 0, 1, 2, or 3
 *   roundsCompleted:  number     // full rounds where every player has taken a turn
 * }
 */

const fs = require('fs');
const path = require('path');
const {
  validateImplementation,
  defaultGetStateForPlayer,
} = require('../../src/game-logic-interface');

const STATE_VERSION = 1;
const CONFIG_DIR = path.join(__dirname, 'config');
let _config = null;

// All 13 categories, ordered upper-then-lower for display.
const CATEGORIES = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'threeOfAKind',
  'fourOfAKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yahtzee',
  'chance',
];
const UPPER_CATEGORIES = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];

// ── config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  const settings = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'settings.json'), 'utf8'));
  _config = { settings };
  return _config;
}

function getConfigCopy() {
  if (!_config) loadConfig();
  return structuredClone(_config);
}

// ── metadata ──────────────────────────────────────────────────────────────────

function getGameMetadata() {
  return {
    name: 'Yahtzee',
    description: 'Roll five dice up to three times per turn, then score into one of 13 categories.',
    minPlayers: 1,
    maxPlayers: 8,
    icon: '🎲',
    estimatedDurationMinutes: 20,
    complexity: 'light',
    tags: ['dice', 'classic', 'family', 'no-spatial', 'solo-friendly'],
  };
}

// ── player creation ───────────────────────────────────────────────────────────

function emptyScoreSheet() {
  const sheet = {};
  for (const c of CATEGORIES) sheet[c] = null;
  return sheet;
}

function createInitialPlayer(user, existingPlayers = [], config = null) {
  if (!config?.settings?.playerColors || !config?.settings?.playerTokens) {
    throw new Error(
      'createInitialPlayer requires a config with settings.playerColors and settings.playerTokens',
    );
  }
  const idx = existingPlayers.length;
  const colorObj = config.settings.playerColors[idx] || config.settings.playerColors[0];
  const token = config.settings.playerTokens[idx] || config.settings.playerTokens[0];
  return {
    userId: user.id,
    username: user.username,
    color: colorObj.id,
    colorHex: colorObj.hex,
    token,
    active: true,
    connected: true,
    scoreSheet: emptyScoreSheet(),
  };
}

// ── game initialisation ───────────────────────────────────────────────────────

function initGame(gameId, name, players, config) {
  const cfg = config || getConfigCopy();
  const diceCount = cfg.settings.diceCount;
  return {
    id: gameId,
    name,
    gameType: 'yahtzee',
    stateVersion: STATE_VERSION,
    status: 'playing',
    config: cfg,
    players: players.map((p) => ({ ...p, scoreSheet: p.scoreSheet || emptyScoreSheet() })),
    turnState: {
      currentPlayerIndex: 0,
      dice: [],
      held: Array(diceCount).fill(false),
      rollsUsed: 0,
      roundsCompleted: 0,
    },
    winner: null,
    log: [],
  };
}

// ── turn helpers ──────────────────────────────────────────────────────────────

function getCurrentPlayer(state) {
  if (!state?.turnState) return null;
  const p = state.players[state.turnState.currentPlayerIndex];
  if (!p) return null;
  return { userId: p.userId, username: p.username };
}

function isTurnTimerBlocked(_state) {
  return false;
}

function getValidActions(state, userId) {
  if (state.status !== 'playing') return [];
  const cur = state.players[state.turnState?.currentPlayerIndex];
  if (!cur || cur.userId !== userId) return [];
  const ts = state.turnState;
  const actions = [];
  if (ts.rollsUsed < state.config.settings.rollsPerTurn) actions.push('rollDice');
  if (ts.rollsUsed >= 1) actions.push('scoreCategory');
  return actions;
}

// ── scoring ──────────────────────────────────────────────────────────────────

/**
 * Pure scoring function: given a category, a 5-die roll, and the config
 * (for category-specific point values), return the points scored.
 *
 * No state dependency.  Validates only the category name; assumes dice are
 * a non-empty array of integers in [1..diceFaces].
 */
function scoreFor(category, dice, config) {
  const sum = dice.reduce((a, b) => a + b, 0);
  const counts = countByFace(dice, config.settings.diceFaces);
  const cfg = config.settings;

  switch (category) {
    case 'ones':
      return sumOfFace(dice, 1);
    case 'twos':
      return sumOfFace(dice, 2);
    case 'threes':
      return sumOfFace(dice, 3);
    case 'fours':
      return sumOfFace(dice, 4);
    case 'fives':
      return sumOfFace(dice, 5);
    case 'sixes':
      return sumOfFace(dice, 6);

    case 'threeOfAKind':
      return counts.some((c) => c >= 3) ? sum : 0;

    case 'fourOfAKind':
      return counts.some((c) => c >= 4) ? sum : 0;

    case 'fullHouse':
      // 3 of one value AND 2 of another.  Standard rule: five of a kind
      // does NOT count as a full house.
      return counts.includes(3) && counts.includes(2) ? cfg.fullHouseScore : 0;

    case 'smallStraight':
      // 4 consecutive faces present
      return hasConsecutiveRun(counts, 4) ? cfg.smallStraightScore : 0;

    case 'largeStraight':
      // 5 consecutive faces present
      return hasConsecutiveRun(counts, 5) ? cfg.largeStraightScore : 0;

    case 'yahtzee':
      return counts.some((c) => c >= 5) ? cfg.yahtzeeScore : 0;

    case 'chance':
      return sum;

    default:
      throw new Error(`Unknown scoring category: ${category}`);
  }
}

function sumOfFace(dice, face) {
  let total = 0;
  for (const d of dice) if (d === face) total += d;
  return total;
}

/** counts[i] = how many dice show face (i+1); length = diceFaces. */
function countByFace(dice, diceFaces) {
  const counts = Array(diceFaces).fill(0);
  for (const d of dice) counts[d - 1]++;
  return counts;
}

/** True if `counts` contains `n` consecutive non-zero entries. */
function hasConsecutiveRun(counts, n) {
  let run = 0;
  for (const c of counts) {
    if (c > 0) {
      run++;
      if (run >= n) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

// ── derived score-sheet totals ────────────────────────────────────────────────

/**
 * Compute upper-section subtotal, upper bonus, lower-section total, and grand
 * total for a player.  Treats unscored categories (null) as zero so this is
 * safe to call mid-game for display.
 */
function computeTotals(scoreSheet, config) {
  let upperSubtotal = 0;
  for (const c of UPPER_CATEGORIES) {
    if (typeof scoreSheet[c] === 'number') upperSubtotal += scoreSheet[c];
  }
  const upperBonus =
    upperSubtotal >= config.settings.upperBonusThreshold ? config.settings.upperBonus : 0;
  let lowerTotal = 0;
  for (const c of CATEGORIES) {
    if (!UPPER_CATEGORIES.includes(c) && typeof scoreSheet[c] === 'number') {
      lowerTotal += scoreSheet[c];
    }
  }
  return {
    upperSubtotal,
    upperBonus,
    lowerTotal,
    grandTotal: upperSubtotal + upperBonus + lowerTotal,
  };
}

function allCategoriesFilled(scoreSheet) {
  for (const c of CATEGORIES) if (scoreSheet[c] === null) return false;
  return true;
}

/**
 * Finalize a game whose every player has filled every category.  Pure:
 * returns the post-game state (status='finished', winner set) and the
 * caller's event/log arrays appended with GAME_OVER and a winner message.
 *
 * Exported for unit testing — extracted from scoreCategory so edge cases
 * like three-way ties and upper-bonus thresholds can be exercised without
 * driving through dozens of scripted dice rolls.
 *
 * @param {Object} state       Pre-finalization state (config/log carry over).
 * @param {Array}  players     Player array with all 13 categories filled.
 * @param {Array}  baseEvents  Events accumulated before the game-over check.
 * @param {Array}  baseLog     Log entries accumulated before the game-over check.
 * @returns {{ state, events }}
 */
function finalizeGame(state, players, baseEvents, baseLog) {
  const finalScores = players.map((p) => ({
    username: p.username,
    ...computeTotals(p.scoreSheet, state.config),
  }));
  const top = Math.max(...finalScores.map((s) => s.grandTotal));
  const winners = finalScores.filter((s) => s.grandTotal === top).map((s) => s.username);
  const winner = winners.length === 1 ? winners[0] : winners;

  const events = [
    ...baseEvents,
    { type: 'GAME_OVER', data: { winner, finalScores }, timestamp: Date.now() },
  ];
  const log = [
    ...baseLog,
    {
      message: Array.isArray(winner)
        ? `Tie! ${winner.join(' & ')} all finished with ${top}.`
        : `${winner} wins with ${top}!`,
      type: 'game',
      timestamp: Date.now(),
    },
  ];

  return {
    state: { ...state, players, status: 'finished', winner, log },
    events,
  };
}

// ── actions ───────────────────────────────────────────────────────────────────

function rollDie(faces) {
  return 1 + Math.floor(Math.random() * faces);
}

function rollDice(state, userId, payload) {
  const cur = state.players[state.turnState.currentPlayerIndex];
  if (!cur || cur.userId !== userId) {
    return { state, events: [], error: 'Not your turn' };
  }
  if (state.status !== 'playing') {
    return { state, events: [], error: 'Game is not in playing state' };
  }
  const ts = state.turnState;
  if (ts.rollsUsed >= state.config.settings.rollsPerTurn) {
    return { state, events: [], error: 'No rolls remaining this turn' };
  }

  const { diceCount, diceFaces } = state.config.settings;
  let held = payload?.held;
  if (held === undefined) {
    held = Array(diceCount).fill(false);
  } else if (
    !Array.isArray(held) ||
    held.length !== diceCount ||
    !held.every((v) => typeof v === 'boolean')
  ) {
    return { state, events: [], error: `held must be an array of ${diceCount} booleans` };
  }
  // First roll of the turn: ignore any holds (nothing to hold yet).
  if (ts.rollsUsed === 0 && held.some(Boolean)) {
    return { state, events: [], error: 'Cannot hold dice on the first roll' };
  }

  const newDice = [];
  for (let i = 0; i < diceCount; i++) {
    if (ts.rollsUsed > 0 && held[i]) {
      newDice.push(ts.dice[i]);
    } else {
      newDice.push(rollDie(diceFaces));
    }
  }

  const player = state.players.find((p) => p.userId === userId);
  const newState = {
    ...state,
    turnState: {
      ...ts,
      dice: newDice,
      held: held.slice(),
      rollsUsed: ts.rollsUsed + 1,
    },
    log: [
      ...(state.log || []),
      {
        message: `${player.username} rolled [${newDice.join(',')}] (roll ${ts.rollsUsed + 1}/${state.config.settings.rollsPerTurn})`,
        type: 'dice',
        timestamp: Date.now(),
      },
    ],
  };

  return {
    state: newState,
    events: [
      {
        type: 'DICE_ROLLED',
        data: {
          username: player.username,
          dice: newDice,
          held: held.slice(),
          rollsUsed: ts.rollsUsed + 1,
        },
        timestamp: Date.now(),
      },
    ],
  };
}

function scoreCategory(state, userId, payload) {
  const curIndex = state.turnState.currentPlayerIndex;
  const cur = state.players[curIndex];
  if (!cur || cur.userId !== userId) {
    return { state, events: [], error: 'Not your turn' };
  }
  if (state.status !== 'playing') {
    return { state, events: [], error: 'Game is not in playing state' };
  }
  if (state.turnState.rollsUsed < 1) {
    return { state, events: [], error: 'You must roll at least once before scoring' };
  }
  const category = payload?.category;
  if (!CATEGORIES.includes(category)) {
    return { state, events: [], error: `Unknown category: ${category}` };
  }
  if (cur.scoreSheet[category] !== null) {
    return { state, events: [], error: `Category "${category}" is already used` };
  }

  const dice = state.turnState.dice;
  const points = scoreFor(category, dice, state.config);

  const events = [];
  // Update score sheet for the current player (immutable copy).
  const newPlayers = state.players.map((p, idx) => {
    if (idx !== curIndex) return p;
    return { ...p, scoreSheet: { ...p.scoreSheet, [category]: points } };
  });

  events.push({
    type: 'CATEGORY_SCORED',
    data: { username: cur.username, category, dice: dice.slice(), points },
    timestamp: Date.now(),
  });
  const logs = [
    ...(state.log || []),
    {
      message: `${cur.username} scored ${points} in ${category} with [${dice.join(',')}]`,
      type: 'score',
      timestamp: Date.now(),
    },
  ];

  // Check for game over: every player has every category filled.
  if (newPlayers.every((p) => allCategoriesFilled(p.scoreSheet))) {
    return finalizeGame(state, newPlayers, events, logs);
  }

  // Otherwise advance the turn.
  const { nextIdx, roundsCompleted } = nextPlayerIndex(state, curIndex);
  const nextPlayer = newPlayers[nextIdx];
  events.push({
    type: 'TURN_ENDED',
    data: { username: cur.username },
    timestamp: Date.now(),
  });
  events.push({
    type: 'TURN_STARTED',
    data: { username: nextPlayer.username },
    timestamp: Date.now(),
  });
  logs.push({
    message: `${nextPlayer.username}'s turn.`,
    type: 'turn',
    timestamp: Date.now(),
  });

  return {
    state: {
      ...state,
      players: newPlayers,
      turnState: freshTurnState(state.config, nextIdx, roundsCompleted),
      log: logs,
    },
    events,
  };
}

/**
 * Advance to the next non-disconnected, non-inactive player.  If the loop
 * wraps past the highest-indexed player, increment `roundsCompleted`.
 * Returns `{ nextIdx, roundsCompleted }`.
 */
function nextPlayerIndex(state, fromIdx) {
  const n = state.players.length;
  let roundsCompleted = state.turnState.roundsCompleted;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIdx + step) % n;
    if (idx <= fromIdx) roundsCompleted++; // wrapped past end of player list
    const p = state.players[idx];
    if (p.active !== false) return { nextIdx: idx, roundsCompleted };
  }
  // All other players are inactive — stay on the current player.
  return { nextIdx: fromIdx, roundsCompleted };
}

function freshTurnState(config, currentPlayerIndex, roundsCompleted) {
  return {
    currentPlayerIndex,
    dice: [],
    held: Array(config.settings.diceCount).fill(false),
    rollsUsed: 0,
    roundsCompleted,
  };
}

function skipTurn(state, userId) {
  const curIndex = state.turnState.currentPlayerIndex;
  const cur = state.players[curIndex];
  if (!cur || cur.userId !== userId) {
    return { state, events: [], error: "Not this player's turn" };
  }
  const { nextIdx, roundsCompleted } = nextPlayerIndex(state, curIndex);
  const nextPlayer = state.players[nextIdx];
  return {
    state: {
      ...state,
      turnState: freshTurnState(state.config, nextIdx, roundsCompleted),
      log: [
        ...(state.log || []),
        { message: `${cur.username}'s turn was skipped`, type: 'info', timestamp: Date.now() },
      ],
    },
    events: [
      { type: 'TURN_SKIPPED', data: { username: cur.username }, timestamp: Date.now() },
      { type: 'TURN_STARTED', data: { username: nextPlayer.username }, timestamp: Date.now() },
    ],
  };
}

// ── applyAction dispatcher ────────────────────────────────────────────────────

function applyAction(state, userId, action, payload = {}) {
  switch (action) {
    case 'rollDice':
      return rollDice(state, userId, payload);
    case 'scoreCategory':
      return scoreCategory(state, userId, payload);
    case 'skipTurn':
      return skipTurn(state, userId);
    default:
      return { state, events: [], error: `Unknown action: ${action}` };
  }
}

// ── migration ─────────────────────────────────────────────────────────────────

// STATE_VERSION 1 is the initial release — nothing to migrate yet.  The stub
// satisfies the optional interface method; future versions add `if` branches.
function migrate(state) {
  if (state.stateVersion === STATE_VERSION) return state;
  throw new Error(
    `[yahtzee] No migration path from stateVersion ${state.stateVersion} to ${STATE_VERSION}`,
  );
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  STATE_VERSION,
  initGame,
  createInitialPlayer,
  applyAction,
  skipTurn,
  getCurrentPlayer,
  isTurnTimerBlocked,
  getValidActions,
  getGameMetadata,
  loadConfig,
  getConfigCopy,
  // See note in game-logic-interface.js about waiting-room safety.
  // Yahtzee is perfect-information (everyone sees everyone's score sheet),
  // so the default identity filter is safe.
  getStateForPlayer: defaultGetStateForPlayer,
  migrate,

  // Internal helpers exported for unit tests.
  scoreFor,
  computeTotals,
  finalizeGame,
  CATEGORIES,
  UPPER_CATEGORIES,
};

validateImplementation(module.exports, {
  internalExports: ['scoreFor', 'computeTotals', 'finalizeGame', 'CATEGORIES', 'UPPER_CATEGORIES'],
});
