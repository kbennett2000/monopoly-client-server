/**
 * config-loader.js
 *
 * Loads and validates the three JSON config files that define a Risk game:
 *   - board.json    — 42 territories grouped into 6 continents (with adjacencies)
 *   - cards.json    — 44 cards (42 territory + 2 wild)
 *   - settings.json — Game rules (army counts, dice limits, card bonuses, …)
 *
 * Returns a single merged "game config" object that is embedded into every
 * new game's state and can also be served to the client for display/editing.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const CONFIG_DIR = path.join(__dirname, 'config');

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

function validateBoard(board) {
  if (!board || typeof board !== 'object') {
    throw new Error('board.json must be an object with continents and territories');
  }
  if (!Array.isArray(board.territories) || board.territories.length !== 42) {
    throw new Error('board.json: territories must be an array of exactly 42 entries');
  }
  if (!board.continents || typeof board.continents !== 'object') {
    throw new Error('board.json: continents must be an object');
  }

  // Every territory has the required shape
  const territoryIds = new Set();
  for (const t of board.territories) {
    if (!t.id || !t.name || !t.continent || !Array.isArray(t.adjacent)) {
      throw new Error(`board.json: territory ${t.id || '(no id)'} is missing required fields`);
    }
    if (territoryIds.has(t.id)) {
      throw new Error(`board.json: duplicate territory id "${t.id}"`);
    }
    territoryIds.add(t.id);
  }

  // Every adjacency points to an existing territory, and adjacencies are symmetric
  for (const t of board.territories) {
    for (const adj of t.adjacent) {
      if (!territoryIds.has(adj)) {
        throw new Error(`board.json: territory "${t.id}" has unknown neighbour "${adj}"`);
      }
      const other = board.territories.find(x => x.id === adj);
      if (!other.adjacent.includes(t.id)) {
        throw new Error(`board.json: adjacency between "${t.id}" and "${adj}" is not symmetric`);
      }
    }
  }

  // Every continent's territory list matches the territories' continent field
  const byContinent = {};
  for (const t of board.territories) byContinent[t.continent] = (byContinent[t.continent] || 0) + 1;
  for (const [key, cont] of Object.entries(board.continents)) {
    if (typeof cont.bonus !== 'number' || cont.bonus < 0) {
      throw new Error(`board.json: continent "${key}" has invalid bonus`);
    }
    if (!Array.isArray(cont.territories)) {
      throw new Error(`board.json: continent "${key}" must list territories`);
    }
    if (cont.territories.length !== (byContinent[key] || 0)) {
      throw new Error(
        `board.json: continent "${key}" lists ${cont.territories.length} territories ` +
        `but ${byContinent[key] || 0} territories claim membership`,
      );
    }
    for (const tid of cont.territories) {
      if (!territoryIds.has(tid)) {
        throw new Error(`board.json: continent "${key}" references unknown territory "${tid}"`);
      }
    }
  }
}

function validateCards(cards) {
  if (!Array.isArray(cards.cards) || cards.cards.length !== 44) {
    throw new Error('cards.json: must contain exactly 44 cards (42 territory + 2 wild)');
  }
  const wilds = cards.cards.filter(c => c.troopType === 'wild');
  if (wilds.length !== 2) {
    throw new Error(`cards.json: must contain exactly 2 wild cards (found ${wilds.length})`);
  }
  const territoryCards = cards.cards.filter(c => c.troopType !== 'wild');
  if (territoryCards.length !== 42) {
    throw new Error(`cards.json: must contain exactly 42 territory cards (found ${territoryCards.length})`);
  }
  for (const c of cards.cards) {
    if (!c.id) throw new Error('cards.json: every card needs an id');
    if (!['infantry', 'cavalry', 'artillery', 'wild'].includes(c.troopType)) {
      throw new Error(`cards.json: card "${c.id}" has invalid troopType "${c.troopType}"`);
    }
    if (c.troopType !== 'wild' && !c.territoryId) {
      throw new Error(`cards.json: non-wild card "${c.id}" must have a territoryId`);
    }
  }
}

function validateSettings(settings) {
  const required = [
    'reinforcementMinimum', 'reinforcementDivisor',
    'attackerMaxDice', 'defenderMaxDice',
    'minPlayers', 'maxPlayers',
  ];
  for (const key of required) {
    if (typeof settings[key] !== 'number') {
      throw new Error(`settings.json: "${key}" must be a number`);
    }
  }
  if (!settings.initialArmiesByPlayerCount || typeof settings.initialArmiesByPlayerCount !== 'object') {
    throw new Error('settings.json: initialArmiesByPlayerCount must be an object');
  }
  if (!Array.isArray(settings.cardTradeBonuses) || settings.cardTradeBonuses.length === 0) {
    throw new Error('settings.json: cardTradeBonuses must be a non-empty array');
  }
  if (!Array.isArray(settings.playerColors) || settings.playerColors.length < settings.maxPlayers) {
    throw new Error(`settings.json: playerColors must contain at least ${settings.maxPlayers} entries`);
  }
}

// ── derived data ─────────────────────────────────────────────────────────────

function buildTerritoryIndex(board) {
  const byId = {};
  for (const t of board.territories) byId[t.id] = t;
  return byId;
}

function buildContinentIndex(board) {
  const idToContinent = {};
  for (const t of board.territories) idToContinent[t.id] = t.continent;
  return idToContinent;
}

// ── main loader ──────────────────────────────────────────────────────────────

let _cachedConfig = null;

function loadConfig(force = false) {
  if (_cachedConfig && !force) return _cachedConfig;

  const board    = readJSON('board.json');
  const cards    = readJSON('cards.json');
  const settings = readJSON('settings.json');

  validateBoard(board);
  validateCards(cards);
  validateSettings(settings);

  _cachedConfig = {
    board,
    cards:    cards.cards,
    settings,
    territoryById:   buildTerritoryIndex(board),
    continentByTerritory: buildContinentIndex(board),
  };
  return _cachedConfig;
}

function getConfigCopy() {
  return JSON.parse(JSON.stringify(loadConfig()));
}

function reloadConfig() {
  return loadConfig(true);
}

module.exports = { loadConfig, getConfigCopy, reloadConfig };
