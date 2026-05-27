/**
 * config-loader.js
 *
 * Loads and validates the four JSON config files that define a Life game:
 *   - board.json     — ~60 board squares with effect references and graph edges
 *   - careers.json   — career cards (degree-required and not)
 *   - salaries.json  — salary cards
 *   - settings.json  — starting cash, loan amount, board entry points, etc.
 *
 * The validation here is non-trivial: the board is a directed graph and a
 * typo in a `next` pointer breaks the game in subtle ways at runtime.  We
 * catch that — plus card-ID duplicates and unknown effect types — at startup.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const CONFIG_DIR = path.join(__dirname, 'config');

// ── known effect types ───────────────────────────────────────────────────────
// Keep this in sync with the EFFECTS registry in game-logic.js.  The loader
// references this set so a board referring to an unknown effect type fails at
// startup rather than at the moment a player happens to land there.
const KNOWN_EFFECT_TYPES = new Set([
  'career-fork',
  'draw-career-no-degree',
  'draw-career-degree',
  'draw-salary',
  'pay-loans',
  'pay-bank',
  'pay-tax-by-salary',
  'collect-bank',
  'pay-each-player',
  'collect-each-player',
  'payday',
  'spin-again',
  'marry',
  'have-baby',
  'have-twins',
  'buy-house',
  'auto-accident',
  'life-accident',
  'retirement-fork',
  'countryside-retirement',
  'millionaire-retirement',
]);

// ── helpers ──────────────────────────────────────────────────────────────────

function readJSON(filename) {
  const filepath = path.join(CONFIG_DIR, filename);
  try {
    const raw = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to load ${filename}: ${err.message}`);
  }
}

// ── validation ───────────────────────────────────────────────────────────────

function validateBoard(board, settings) {
  if (!Array.isArray(board) || board.length === 0) {
    throw new Error('board.json must be a non-empty array of squares');
  }

  const byId = new Map();
  for (const sq of board) {
    if (!sq.id || typeof sq.id !== 'string') {
      throw new Error('board.json: every square must have a string id');
    }
    if (byId.has(sq.id)) {
      throw new Error(`board.json: duplicate square id "${sq.id}"`);
    }
    if (!sq.type || !sq.label) {
      throw new Error(`board.json: square "${sq.id}" is missing type or label`);
    }
    if (!Array.isArray(sq.next)) {
      throw new Error(`board.json: square "${sq.id}".next must be an array`);
    }
    if (!KNOWN_EFFECT_TYPES.has(sq.type)) {
      throw new Error(`board.json: square "${sq.id}" has unknown effect type "${sq.type}"`);
    }
    byId.set(sq.id, sq);
  }

  // Every `next` references an existing square.
  for (const sq of board) {
    for (const n of sq.next) {
      if (!byId.has(n)) {
        throw new Error(`board.json: square "${sq.id}".next references unknown id "${n}"`);
      }
    }
  }

  // Start square must exist.
  const startId = settings.startSquareId;
  if (!byId.has(startId)) {
    throw new Error(`board.json: settings.startSquareId "${startId}" does not exist on the board`);
  }

  // Every square is reachable from the start.
  const reachable = new Set();
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const n of byId.get(id).next) stack.push(n);
  }
  for (const sq of board) {
    if (!reachable.has(sq.id)) {
      throw new Error(`board.json: square "${sq.id}" is unreachable from "${startId}"`);
    }
  }

  // Retirement-terminal squares must have an empty `next` (or self-loop):
  // a player who has retired stays there until game-over.
  for (const sq of board) {
    if (sq.type !== 'countryside-retirement' && sq.type !== 'millionaire-retirement') continue;
    const ok = sq.next.length === 0 || (sq.next.length === 1 && sq.next[0] === sq.id);
    if (!ok) {
      throw new Error(
        `board.json: retirement square "${sq.id}" must have empty next or a self-loop`,
      );
    }
  }
}

function validateHouses(houses) {
  if (!houses || !Array.isArray(houses.houses) || houses.houses.length === 0) {
    throw new Error('houses.json: must contain a non-empty "houses" array');
  }
  const seen = new Set();
  for (const h of houses.houses) {
    if (!h.id || typeof h.id !== 'string') {
      throw new Error('houses.json: every house must have a string id');
    }
    if (seen.has(h.id)) {
      throw new Error(`houses.json: duplicate house id "${h.id}"`);
    }
    seen.add(h.id);
    if (typeof h.cost !== 'number' || h.cost <= 0) {
      throw new Error(`houses.json: house "${h.id}".cost must be a positive number`);
    }
    if (typeof h.value !== 'number' || h.value <= 0) {
      throw new Error(`houses.json: house "${h.id}".value must be a positive number`);
    }
    if (!h.name || typeof h.name !== 'string') {
      throw new Error(`houses.json: house "${h.id}".name must be a non-empty string`);
    }
  }
}

function validateLifeTiles(tiles) {
  if (!tiles || !Array.isArray(tiles.tiles) || tiles.tiles.length === 0) {
    throw new Error('lifeTiles.json: must contain a non-empty "tiles" array');
  }
  const seen = new Set();
  for (const t of tiles.tiles) {
    if (!t.id || typeof t.id !== 'string') {
      throw new Error('lifeTiles.json: every tile must have a string id');
    }
    if (seen.has(t.id)) {
      throw new Error(`lifeTiles.json: duplicate tile id "${t.id}"`);
    }
    seen.add(t.id);
    if (typeof t.value !== 'number' || t.value <= 0) {
      throw new Error(`lifeTiles.json: tile "${t.id}".value must be a positive number`);
    }
    if (!t.name || typeof t.name !== 'string') {
      throw new Error(`lifeTiles.json: tile "${t.id}".name must be a non-empty string`);
    }
  }
}

function validateCardDeck(deck, filename) {
  if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
    throw new Error(`${filename}: must contain a non-empty "cards" array`);
  }
  const seen = new Set();
  for (const c of deck.cards) {
    if (!c.id || typeof c.id !== 'string') {
      throw new Error(`${filename}: every card must have a string id`);
    }
    if (seen.has(c.id)) {
      throw new Error(`${filename}: duplicate card id "${c.id}"`);
    }
    seen.add(c.id);
  }
}

function validateCareers(careers) {
  validateCardDeck(careers, 'careers.json');
  const degree = careers.cards.filter((c) => c.degreeRequired === true);
  const noDegree = careers.cards.filter((c) => c.degreeRequired === false);
  if (degree.length === 0) {
    throw new Error('careers.json: must contain at least one degreeRequired=true card');
  }
  if (noDegree.length === 0) {
    throw new Error('careers.json: must contain at least one degreeRequired=false card');
  }
  for (const c of careers.cards) {
    if (typeof c.degreeRequired !== 'boolean') {
      throw new Error(`careers.json: card "${c.id}" must have a boolean degreeRequired`);
    }
  }
}

function validateSalaries(salaries) {
  validateCardDeck(salaries, 'salaries.json');
  for (const c of salaries.cards) {
    if (typeof c.amount !== 'number' || c.amount <= 0) {
      throw new Error(`salaries.json: card "${c.id}".amount must be a positive number`);
    }
    if (typeof c.taxDue !== 'number' || c.taxDue < 0) {
      throw new Error(`salaries.json: card "${c.id}".taxDue must be a non-negative number`);
    }
  }
}

function validateSettings(settings) {
  const required = [
    'startingCash',
    'collegeLoanAmount',
    'spinMin',
    'spinMax',
    'careerOptionsCount',
    'salaryOptionsCount',
    'houseOptionsCount',
    'weddingGiftPerPlayer',
    'babyGiftPerPlayer',
    'twinsGiftPerPlayer',
    'autoInsuranceCost',
    'autoAccidentCost',
    'lifeInsuranceCost',
    'lifeAccidentCost',
    'stockCost',
    'stockPayoutAmount',
    'minPlayers',
    'maxPlayers',
  ];
  for (const key of required) {
    if (typeof settings[key] !== 'number') {
      throw new Error(`settings.json: "${key}" must be a number`);
    }
  }
  if (settings.spinMin >= settings.spinMax) {
    throw new Error('settings.json: spinMin must be less than spinMax');
  }
  if (!settings.startSquareId || typeof settings.startSquareId !== 'string') {
    throw new Error('settings.json: "startSquareId" must be a string');
  }
  if (!Array.isArray(settings.playerColors) || settings.playerColors.length < settings.maxPlayers) {
    throw new Error(
      `settings.json: playerColors must contain at least ${settings.maxPlayers} entries`,
    );
  }
  if (!Array.isArray(settings.playerTokens) || settings.playerTokens.length < settings.maxPlayers) {
    throw new Error(
      `settings.json: playerTokens must contain at least ${settings.maxPlayers} entries`,
    );
  }
}

// ── derived data ─────────────────────────────────────────────────────────────

function buildBoardIndex(board) {
  const byId = {};
  for (const sq of board) byId[sq.id] = sq;
  return byId;
}

// ── main loader ──────────────────────────────────────────────────────────────

let _cachedConfig = null;

function loadConfig(force = false) {
  if (_cachedConfig && !force) return _cachedConfig;

  const board = readJSON('board.json');
  const careers = readJSON('careers.json');
  const salaries = readJSON('salaries.json');
  const settings = readJSON('settings.json');
  const lifeTiles = readJSON('lifeTiles.json');
  const houses = readJSON('houses.json');

  // Settings first — board validation needs settings.startSquareId.
  validateSettings(settings);
  validateBoard(board, settings);
  validateCareers(careers);
  validateSalaries(salaries);
  validateLifeTiles(lifeTiles);
  validateHouses(houses);

  _cachedConfig = {
    board,
    careers: careers.cards,
    salaries: salaries.cards,
    lifeTiles: lifeTiles.tiles,
    houses: houses.houses,
    settings,
    boardById: buildBoardIndex(board),
  };
  return _cachedConfig;
}

function getConfigCopy() {
  return structuredClone(loadConfig());
}

function reloadConfig() {
  return loadConfig(true);
}

module.exports = {
  loadConfig,
  getConfigCopy,
  reloadConfig,
  KNOWN_EFFECT_TYPES,
  // Exposed for testing — the validators are pure and easy to unit-test directly.
  _validators: {
    validateBoard,
    validateCareers,
    validateSalaries,
    validateSettings,
    validateLifeTiles,
    validateHouses,
  },
};
