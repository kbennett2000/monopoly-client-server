/**
 * game-logic.js
 *
 * Pure Risk game engine.  All functions are side-effect free: they accept a
 * game state object and return a NEW state object plus an array of events.
 * The caller (game-manager / socket-handler) persists state and broadcasts.
 *
 * ─── State versioning ────────────────────────────────────────────────────────
 *
 * STATE_VERSION must be bumped whenever the GameState shape changes
 * incompatibly.  game-manager.js calls migrate() for any saved game whose
 * stateVersion doesn't match.
 *
 * ─── State shape ─────────────────────────────────────────────────────────────
 *
 * GameState {
 *   id           : string            game UUID
 *   name         : string
 *   gameType     : 'risk'
 *   stateVersion : number            must equal STATE_VERSION
 *   status       : 'waiting' | 'playing' | 'paused' | 'finished'
 *   config       : GameConfig        embedded copy of config-loader output
 *   players      : Player[]
 *   territories  : { [territoryId]: TerritoryState }
 *   turnState    : TurnState
 *   deck         : Card[]            face-down draw pile (shuffled)
 *   discardPile  : Card[]            cards traded back in
 *   cardSetsTraded : number          how many sets have been traded globally
 *   winner       : string | null     userId of conqueror
 *   log          : LogEntry[]
 * }
 *
 * Player {
 *   userId, username, color, colorHex, token   (display)
 *   hand        : Card[]    PRIVATE — masked by getStateForPlayer for others
 *   eliminated  : boolean
 *   active      : boolean
 *   connected   : boolean
 *   conqueredThisTurn : boolean   triggers card draw at endTurn
 * }
 *
 * TerritoryState { ownerId: string | null, armies: number }
 *
 * TurnState {
 *   currentPlayerIndex : number
 *   phase              : 'reinforce' | 'attack' | 'fortify'
 *   armiesToPlace      : number        armies waiting to be deployed this turn
 *   fortifyUsed        : boolean       once-per-turn flag
 *   attackedThisTurn   : boolean       gates card-draw on endTurn
 *   lastDiceRoll       : DiceRoll | null  last combat result (for UI)
 * }
 */

'use strict';

const configLoader = require('./config-loader');
const { validateImplementation } = require('../../src/game-logic-interface');

// Bump this whenever the GameState shape changes incompatibly.
// game-manager.js will call migrate() for any saved game whose
// stateVersion doesn't match.
const STATE_VERSION = 1;

// ── helpers ──────────────────────────────────────────────────────────────────

function clone(obj) {
  return structuredClone(obj);
}

function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}

/** Fisher-Yates shuffle (returns a new array, doesn't mutate input). */
function shuffle(array) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function event(type, data = {}) {
  return { type, data, timestamp: Date.now() };
}

function log(state, message, type = 'info') {
  state.log.push({ timestamp: Date.now(), message, type });
}

// ── config interface methods ─────────────────────────────────────────────────

function loadConfig() {
  return configLoader.loadConfig();
}
function getConfigCopy() {
  return configLoader.getConfigCopy();
}

// ── metadata ─────────────────────────────────────────────────────────────────

function getGameMetadata() {
  return {
    name: 'Risk',
    minPlayers: 2,
    maxPlayers: 6,
    description: 'World domination through dice and diplomacy.',
    icon: '🌍',
    estimatedDurationMinutes: 120,
    complexity: 'heavy',
    tags: ['dice', 'spatial', 'hidden-information', 'elimination', 'classic'],
  };
}

// ── player creation ──────────────────────────────────────────────────────────

function createInitialPlayer(user, existingPlayers, config) {
  if (!config?.settings?.playerColors || !config?.settings?.playerTokens) {
    throw new Error(
      'createInitialPlayer requires a config with settings.playerColors and settings.playerTokens',
    );
  }
  const used = new Set(existingPlayers.map((p) => p.color));
  const slot =
    config.settings.playerColors.find((c) => !used.has(c.id)) ||
    config.settings.playerColors[existingPlayers.length % config.settings.playerColors.length];
  const token =
    config.settings.playerTokens[existingPlayers.length % config.settings.playerTokens.length];

  return {
    userId: user.id,
    username: user.username,
    color: slot.id,
    colorHex: slot.hex,
    token,
    hand: [],
    eliminated: false,
    active: true,
    connected: true,
    conqueredThisTurn: false,
  };
}

// ── initial game state ───────────────────────────────────────────────────────

/**
 * Distribute armies as evenly as possible across a list of territory ids.
 * Returns an object of territoryId → armyCount.
 */
function distributeArmies(territoryIds, totalArmies) {
  const result = {};
  const base = Math.floor(totalArmies / territoryIds.length);
  let extra = totalArmies - base * territoryIds.length;
  for (const tid of territoryIds) {
    result[tid] = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
  }
  return result;
}

function initGame(gameId, gameName, playerList, config) {
  const playerCount = playerList.length;
  const initial = config.settings.initialArmiesByPlayerCount[String(playerCount)];
  if (typeof initial !== 'number') {
    throw new Error(`No initialArmiesByPlayerCount entry for ${playerCount} players`);
  }

  // Auto-distribute territories: shuffle, then deal round-robin.
  const allTerritoryIds = shuffle(config.board.territories.map((t) => t.id));
  const playerTerritories = playerList.map(() => []);
  allTerritoryIds.forEach((tid, idx) => {
    playerTerritories[idx % playerCount].push(tid);
  });

  // Each player auto-places all initial armies across their territories.
  const territories = {};
  for (const t of config.board.territories) {
    territories[t.id] = { ownerId: null, armies: 0 };
  }
  playerList.forEach((p, pIdx) => {
    const owned = playerTerritories[pIdx];
    const distributed = distributeArmies(owned, initial);
    for (const tid of owned) {
      territories[tid] = { ownerId: p.userId, armies: distributed[tid] };
    }
  });

  // Shuffle the deck.
  const deck = shuffle(config.cards);

  const players = playerList.map((p) => ({
    ...p,
    hand: [],
    eliminated: false,
    active: true,
    connected: true,
    conqueredThisTurn: false,
  }));

  const firstPlayerReinforcements = computeReinforcements(
    {
      players,
      territories,
      config,
    },
    players[0].userId,
  );

  return {
    id: gameId,
    name: gameName,
    gameType: 'risk',
    stateVersion: STATE_VERSION,
    status: 'playing',
    config,
    players,
    territories,
    turnState: {
      currentPlayerIndex: 0,
      phase: 'reinforce',
      armiesToPlace: firstPlayerReinforcements,
      fortifyUsed: false,
      attackedThisTurn: false,
      lastDiceRoll: null,
    },
    deck,
    discardPile: [],
    cardSetsTraded: 0,
    winner: null,
    log: [
      { timestamp: Date.now(), message: 'Game started — world domination awaits.', type: 'info' },
      {
        timestamp: Date.now(),
        message: `${players[0].username} has ${firstPlayerReinforcements} armies to place.`,
        type: 'turn',
      },
    ],
  };
}

// ── derived getters ──────────────────────────────────────────────────────────

function getOwnedTerritories(state, userId) {
  return Object.entries(state.territories)
    .filter(([, t]) => t.ownerId === userId)
    .map(([id]) => id);
}

function getContinentsOwned(state, userId) {
  const continents = state.config.board.continents;
  const owned = [];
  for (const [key, cont] of Object.entries(continents)) {
    if (cont.territories.every((tid) => state.territories[tid].ownerId === userId)) {
      owned.push(key);
    }
  }
  return owned;
}

/**
 * Reinforcements at the start of a player's turn:
 *   max(reinforcementMinimum, floor(territoriesOwned / reinforcementDivisor))
 *   + sum of bonuses for each entire continent owned.
 */
function computeReinforcements(state, userId) {
  const owned = getOwnedTerritories(state, userId);
  const settings = state.config.settings;
  const base = Math.max(
    settings.reinforcementMinimum,
    Math.floor(owned.length / settings.reinforcementDivisor),
  );
  const conts = getContinentsOwned(state, userId);
  const contBonus = conts.reduce((s, key) => s + state.config.board.continents[key].bonus, 0);
  return base + contBonus;
}

function getCurrentPlayer(state) {
  if (!state?.turnState) return null;
  const p = state.players[state.turnState.currentPlayerIndex];
  if (!p) return null;
  return { userId: p.userId, username: p.username };
}

// Attack resolution is atomic (defender auto-rolls), so no phase ever
// requires us to pause the AFK timer.
function isTurnTimerBlocked(_state) {
  return false;
}

function getValidActions(state, userId) {
  if (state.status !== 'playing') return [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return [];

  switch (state.turnState.phase) {
    case 'reinforce': {
      const actions = ['placeReinforcement'];
      if (state.turnState.armiesToPlace === 0) actions.push('endReinforcePhase');
      const player = state.players.find((p) => p.userId === userId);
      if (player && hasAnyValidCardSet(player.hand)) actions.push('tradeCards');
      return actions;
    }
    case 'attack':
      return ['attackTerritory', 'endAttackPhase'];
    case 'fortify':
      return state.turnState.fortifyUsed ? ['endTurn'] : ['fortify', 'endTurn'];
    default:
      return [];
  }
}

// ── card-set validation ──────────────────────────────────────────────────────

/**
 * A valid trade-in is exactly 3 cards that form one of:
 *   • three of the same troop type, OR
 *   • one of each of the three troop types, OR
 *   • any 2 cards plus a wild.
 */
function isValidCardSet(cards) {
  if (!Array.isArray(cards) || cards.length !== 3) return false;
  const wilds = cards.filter((c) => c.troopType === 'wild').length;
  const types = new Set(cards.filter((c) => c.troopType !== 'wild').map((c) => c.troopType));

  if (wilds >= 1) return true; // wild matches anything
  if (types.size === 1) return true; // three of a kind
  if (types.size === 3) return true; // one of each
  return false;
}

function hasAnyValidCardSet(hand) {
  if (!hand || hand.length < 3) return false;
  // Brute force over 3-combinations is fine — hand is bounded (max ~10).
  for (let i = 0; i < hand.length - 2; i++) {
    for (let j = i + 1; j < hand.length - 1; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        if (isValidCardSet([hand[i], hand[j], hand[k]])) return true;
      }
    }
  }
  return false;
}

/**
 * Bonus armies for the (cardSetsTraded + 1)-th set globally traded.
 * Sequence from settings.cardTradeBonuses [4, 6, 8, 10, 12, 15], then
 * +cardTradeIncrement (5) each subsequent set.
 */
function nextSetBonus(state) {
  const { cardTradeBonuses, cardTradeIncrement } = state.config.settings;
  const setIdx = state.cardSetsTraded;
  if (setIdx < cardTradeBonuses.length) return cardTradeBonuses[setIdx];
  return (
    cardTradeBonuses[cardTradeBonuses.length - 1] +
    cardTradeIncrement * (setIdx - cardTradeBonuses.length + 1)
  );
}

// ── pathfinding (fortify connectivity) ───────────────────────────────────────

/**
 * True if `to` is reachable from `from` walking only through territories
 * owned by `userId`, including `from` and `to` themselves.
 */
function canFortifyPath(state, from, to, userId) {
  if (from === to) return false;
  if (state.territories[from].ownerId !== userId) return false;
  if (state.territories[to].ownerId !== userId) return false;

  const territoryById = state.config.territoryById;
  const visited = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) return true;
    for (const neighbour of territoryById[cur].adjacent) {
      if (visited.has(neighbour)) continue;
      if (state.territories[neighbour].ownerId !== userId) continue;
      visited.add(neighbour);
      queue.push(neighbour);
    }
  }
  return false;
}

// ── combat ───────────────────────────────────────────────────────────────────

/**
 * Resolve one round of combat. Returns the dice each side rolled (sorted desc)
 * and the resulting losses for each side.  Pure / deterministic given inputs.
 */
function resolveCombat(attackerDieCount, defenderDieCount) {
  const attackerRolls = Array.from({ length: attackerDieCount }, rollDie).sort((a, b) => b - a);
  const defenderRolls = Array.from({ length: defenderDieCount }, rollDie).sort((a, b) => b - a);
  let attackerLosses = 0;
  let defenderLosses = 0;
  const pairs = Math.min(attackerRolls.length, defenderRolls.length);
  for (let i = 0; i < pairs; i++) {
    if (attackerRolls[i] > defenderRolls[i]) defenderLosses++;
    else attackerLosses++;
  }
  return { attackerRolls, defenderRolls, attackerLosses, defenderLosses };
}

// ── deck management ──────────────────────────────────────────────────────────

// Mutates state.deck, state.discardPile, and state.log in place — caller
// must have cloned state before invoking.
function drawCard(state) {
  if (state.deck.length === 0 && state.discardPile.length > 0) {
    state.deck = shuffle(state.discardPile);
    state.discardPile = [];
    log(state, 'The discard pile was reshuffled into the deck.', 'info');
  }
  return state.deck.shift() || null;
}

// ── action handlers ──────────────────────────────────────────────────────────

function placeReinforcement(state, userId, payload) {
  const events = [];
  const player = state.players.find((p) => p.userId === userId);
  const cur = getCurrentPlayer(state);

  if (!cur || cur.userId !== userId) return { state, events, error: 'It is not your turn' };
  if (state.turnState.phase !== 'reinforce')
    return { state, events, error: 'You are not in the reinforce phase' };

  const { territoryId, count } = payload || {};
  if (!territoryId || !Number.isInteger(count) || count <= 0) {
    return { state, events, error: 'Invalid reinforcement payload' };
  }
  const territory = state.territories[territoryId];
  if (!territory) return { state, events, error: 'Unknown territory' };
  if (territory.ownerId !== userId)
    return { state, events, error: 'You do not own that territory' };
  if (count > state.turnState.armiesToPlace) {
    return {
      state,
      events,
      error: `You only have ${state.turnState.armiesToPlace} armies to place`,
    };
  }

  state = clone(state);
  state.territories[territoryId].armies += count;
  state.turnState.armiesToPlace -= count;
  log(
    state,
    `${player.username} placed ${count} ${count === 1 ? 'army' : 'armies'} on ${territoryName(state, territoryId)}.`,
    'reinforce',
  );
  events.push(
    event('REINFORCEMENT_PLACED', {
      username: player.username,
      territoryId,
      count,
    }),
  );

  return { state, events };
}

function tradeCards(state, userId, payload) {
  const events = [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return { state, events, error: 'It is not your turn' };
  if (state.turnState.phase !== 'reinforce')
    return { state, events, error: 'You can only trade cards during the reinforce phase' };

  const player = state.players.find((p) => p.userId === userId);
  const ids = Array.isArray(payload?.cardIds) ? payload.cardIds : [];
  if (ids.length !== 3) return { state, events, error: 'You must trade exactly 3 cards' };

  // Resolve ids → card objects (preserving order)
  const cards = ids.map((id) => player.hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) return { state, events, error: 'You do not hold one of those cards' };
  if (!isValidCardSet(cards))
    return { state, events, error: 'Those 3 cards do not form a valid set' };

  state = clone(state);
  const updatedPlayer = state.players.find((p) => p.userId === userId);
  const bonus = nextSetBonus(state);

  // Bonus armies if you own any of the territories on the traded cards (+2 to that territory).
  let territoryBonus = 0;
  let bonusTerritoryId = null;
  for (const c of cards) {
    if (c.troopType === 'wild' || !c.territoryId) continue;
    if (state.territories[c.territoryId].ownerId === userId) {
      state.territories[c.territoryId].armies += 2;
      territoryBonus = 2;
      bonusTerritoryId = c.territoryId;
      break; // Only one card grants the territory bonus, per classic rules
    }
  }

  // Remove cards from hand, push to discard pile, bump set counter, grant bonus armies
  updatedPlayer.hand = updatedPlayer.hand.filter((c) => !ids.includes(c.id));
  state.discardPile.push(...cards);
  state.cardSetsTraded += 1;
  state.turnState.armiesToPlace += bonus;

  log(state, `${updatedPlayer.username} traded a set of cards for ${bonus} armies.`, 'cards');
  if (territoryBonus > 0) {
    log(
      state,
      `${updatedPlayer.username} gained +2 armies on ${territoryName(state, bonusTerritoryId)} from a matching card.`,
      'cards',
    );
  }
  events.push(
    event('CARDS_TRADED', {
      username: updatedPlayer.username,
      cardIds: ids,
      bonusArmies: bonus,
      setNumber: state.cardSetsTraded,
      territoryBonus,
      bonusTerritoryId,
    }),
  );

  return { state, events };
}

function endReinforcePhase(state, userId) {
  const events = [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return { state, events, error: 'It is not your turn' };
  if (state.turnState.phase !== 'reinforce')
    return { state, events, error: 'You are not in the reinforce phase' };
  if (state.turnState.armiesToPlace > 0) {
    return {
      state,
      events,
      error: `You still have ${state.turnState.armiesToPlace} armies to place`,
    };
  }

  state = clone(state);
  state.turnState.phase = 'attack';
  log(state, `${cur.username} ended the reinforce phase.`, 'phase');
  events.push(event('PHASE_CHANGED', { phase: 'attack', username: cur.username }));
  return { state, events };
}

function attackTerritory(state, userId, payload) {
  const events = [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return { state, events, error: 'It is not your turn' };
  if (state.turnState.phase !== 'attack')
    return { state, events, error: 'You are not in the attack phase' };

  const { from, to, attackerDice } = payload || {};
  const fromT = state.territories[from];
  const toT = state.territories[to];
  if (!fromT || !toT) return { state, events, error: 'Unknown territory' };
  if (fromT.ownerId !== userId)
    return { state, events, error: 'You do not own the attacking territory' };
  if (toT.ownerId === userId)
    return { state, events, error: 'You cannot attack your own territory' };

  if (!state.config.territoryById[from].adjacent.includes(to)) {
    return { state, events, error: 'Those territories are not adjacent' };
  }

  if (fromT.armies < state.config.settings.minArmiesToAttack) {
    return { state, events, error: 'You need at least 2 armies in the attacking territory' };
  }

  const maxAttackerDice = Math.min(state.config.settings.attackerMaxDice, fromT.armies - 1);
  const dice = typeof attackerDice === 'number' ? attackerDice : maxAttackerDice;
  if (dice < 1 || dice > maxAttackerDice) {
    return { state, events, error: `You can use 1 to ${maxAttackerDice} dice from this territory` };
  }
  const defenderDice = Math.min(state.config.settings.defenderMaxDice, toT.armies);

  state = clone(state);
  const result = resolveCombat(dice, defenderDice);

  // Apply losses
  state.territories[from].armies -= result.attackerLosses;
  state.territories[to].armies -= result.defenderLosses;

  const attacker = state.players.find((p) => p.userId === userId);
  const defender = state.players.find((p) => p.userId === toT.ownerId);

  events.push(
    event('ATTACK_DECLARED', {
      from,
      to,
      attacker: attacker.username,
      defender: defender ? defender.username : null,
      attackerDice: dice,
      defenderDice,
    }),
  );
  events.push(
    event('DICE_ROLLED', {
      from,
      to,
      attackerRolls: result.attackerRolls,
      defenderRolls: result.defenderRolls,
      attackerLosses: result.attackerLosses,
      defenderLosses: result.defenderLosses,
    }),
  );
  log(
    state,
    `${attacker.username} attacked ${territoryName(state, to)} from ${territoryName(state, from)}: ` +
      `[${result.attackerRolls.join(',')}] vs [${result.defenderRolls.join(',')}] ` +
      `→ attacker -${result.attackerLosses}, defender -${result.defenderLosses}.`,
    'combat',
  );

  state.turnState.attackedThisTurn = true;
  state.turnState.lastDiceRoll = {
    from,
    to,
    attackerRolls: result.attackerRolls,
    defenderRolls: result.defenderRolls,
    attackerLosses: result.attackerLosses,
    defenderLosses: result.defenderLosses,
  };

  // Conquest?
  if (state.territories[to].armies === 0) {
    state.territories[to].ownerId = userId;
    // Per design D4: move exactly the attacker dice count into the new territory.
    const armiesMovedIn = dice;
    state.territories[from].armies -= armiesMovedIn;
    state.territories[to].armies += armiesMovedIn;
    attacker.conqueredThisTurn = true;
    log(state, `${attacker.username} conquered ${territoryName(state, to)}!`, 'conquest');
    events.push(
      event('TERRITORY_CONQUERED', {
        username: attacker.username,
        from,
        to,
        armiesMovedIn,
      }),
    );

    // Is the defender eliminated?
    if (defender) {
      const defenderLeft = getOwnedTerritories(state, defender.userId);
      if (defenderLeft.length === 0 && !defender.eliminated) {
        // Transfer all of defender's cards to the attacker
        attacker.hand = attacker.hand.concat(defender.hand);
        defender.hand = [];
        defender.eliminated = true;
        defender.active = false;
        log(state, `${attacker.username} eliminated ${defender.username}.`, 'elimination');
        events.push(
          event('PLAYER_ELIMINATED', {
            username: defender.username,
            eliminatedBy: attacker.username,
          }),
        );
      }
    }

    // Victory?
    const ownedNow = getOwnedTerritories(state, userId);
    if (ownedNow.length === state.config.board.territories.length) {
      state.status = 'finished';
      state.winner = userId;
      log(state, `${attacker.username} has achieved world domination!`, 'victory');
      events.push(event('GAME_OVER', { winner: attacker.username }));
    }
  }

  return { state, events };
}

function endAttackPhase(state, userId) {
  const events = [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return { state, events, error: 'It is not your turn' };
  if (state.turnState.phase !== 'attack')
    return { state, events, error: 'You are not in the attack phase' };

  state = clone(state);
  state.turnState.phase = 'fortify';
  log(state, `${cur.username} ended the attack phase.`, 'phase');
  events.push(event('PHASE_CHANGED', { phase: 'fortify', username: cur.username }));
  return { state, events };
}

function fortify(state, userId, payload) {
  const events = [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return { state, events, error: 'It is not your turn' };
  if (state.turnState.phase !== 'fortify')
    return { state, events, error: 'You are not in the fortify phase' };
  if (state.turnState.fortifyUsed)
    return { state, events, error: 'You have already fortified this turn' };

  const { from, to, count } = payload || {};
  if (!from || !to || !Number.isInteger(count) || count <= 0) {
    return { state, events, error: 'Invalid fortify payload' };
  }
  const fromT = state.territories[from];
  const toT = state.territories[to];
  if (!fromT || !toT) return { state, events, error: 'Unknown territory' };
  if (fromT.ownerId !== userId)
    return { state, events, error: 'You do not own the source territory' };
  if (toT.ownerId !== userId)
    return { state, events, error: 'You do not own the destination territory' };
  if (count >= fromT.armies)
    return { state, events, error: 'You must leave at least 1 army behind' };
  if (!canFortifyPath(state, from, to, userId)) {
    return { state, events, error: 'Those territories are not connected through your territory' };
  }

  state = clone(state);
  state.territories[from].armies -= count;
  state.territories[to].armies += count;
  state.turnState.fortifyUsed = true;
  log(
    state,
    `${cur.username} fortified ${territoryName(state, to)} with ${count} armies from ${territoryName(state, from)}.`,
    'fortify',
  );
  events.push(
    event('ARMIES_FORTIFIED', {
      username: cur.username,
      from,
      to,
      count,
    }),
  );

  return { state, events };
}

function endTurn(state, userId) {
  const events = [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return { state, events, error: 'It is not your turn' };
  if (state.turnState.phase !== 'fortify')
    return { state, events, error: 'You can only end the turn after fortifying' };

  state = clone(state);
  const player = state.players.find((p) => p.userId === userId);

  // Draw a card if you conquered at least one territory this turn.
  if (player.conqueredThisTurn) {
    const card = drawCard(state);
    if (card) {
      player.hand.push(card);
      log(state, `${player.username} drew a card for conquering territory this turn.`, 'cards');
      events.push(event('CARD_DRAWN', { username: player.username }));
    }
  }
  player.conqueredThisTurn = false;

  const advanced = advanceToNextPlayer(state);
  return { state: advanced.state, events: events.concat(advanced.events) };
}

function declareBankruptcy(state, userId) {
  const events = [];
  const player = state.players.find((p) => p.userId === userId);
  if (!player) return { state, events, error: 'Player not found' };
  if (player.eliminated) return { state, events, error: 'You are already eliminated' };

  state = clone(state);
  const target = state.players.find((p) => p.userId === userId);
  target.eliminated = true;
  target.active = false;

  // Free all their territories — armies are removed (reset to 0, ownerless).
  for (const tid of Object.keys(state.territories)) {
    if (state.territories[tid].ownerId === userId) {
      state.territories[tid] = { ownerId: null, armies: 0 };
    }
  }
  // Discard their cards.
  state.discardPile.push(...target.hand);
  target.hand = [];

  log(state, `${target.username} declared bankruptcy.`, 'elimination');
  events.push(event('PLAYER_ELIMINATED', { username: target.username, eliminatedBy: null }));

  // If it's their turn, advance.
  if (getCurrentPlayer(state)?.userId === userId) {
    const result = advanceToNextPlayer(state);
    state = result.state;
    events.push(...result.events);
  }

  // Did someone win by default?
  const remaining = state.players.filter((p) => !p.eliminated);
  if (remaining.length === 1 && state.status === 'playing') {
    state.status = 'finished';
    state.winner = remaining[0].userId;
    log(state, `${remaining[0].username} wins by elimination!`, 'victory');
    events.push(event('GAME_OVER', { winner: remaining[0].username }));
  }

  return { state, events };
}

// Helper used by skipTurn and declareBankruptcy — moves to the next non-eliminated
// player, resets per-turn state.  Caller must pass an already-cloned state.
function advanceToNextPlayer(state) {
  const events = [];
  const playerCount = state.players.length;
  let nextIdx = state.turnState.currentPlayerIndex;
  for (let i = 0; i < playerCount; i++) {
    nextIdx = (nextIdx + 1) % playerCount;
    if (!state.players[nextIdx].eliminated) break;
  }
  state.turnState.currentPlayerIndex = nextIdx;
  state.turnState.phase = 'reinforce';
  state.turnState.fortifyUsed = false;
  state.turnState.attackedThisTurn = false;
  state.turnState.lastDiceRoll = null;
  const nextPlayer = state.players[nextIdx];
  state.turnState.armiesToPlace = computeReinforcements(state, nextPlayer.userId);

  // Surface continent bonuses contributing to this turn's reinforcement count.
  for (const key of getContinentsOwned(state, nextPlayer.userId)) {
    events.push(
      event('CONTINENT_HELD', {
        username: nextPlayer.username,
        continent: key,
        bonus: state.config.board.continents[key].bonus,
      }),
    );
  }

  log(
    state,
    `${nextPlayer.username}'s turn — ${state.turnState.armiesToPlace} armies to place.`,
    'turn',
  );
  events.push(event('PHASE_CHANGED', { phase: 'reinforce', username: nextPlayer.username }));
  return { state, events };
}

// ── interface: applyAction ───────────────────────────────────────────────────

function applyAction(state, userId, action, payload = {}) {
  switch (action) {
    case 'placeReinforcement':
      return placeReinforcement(state, userId, payload);
    case 'tradeCards':
      return tradeCards(state, userId, payload);
    case 'endReinforcePhase':
      return endReinforcePhase(state, userId);
    case 'attackTerritory':
      return attackTerritory(state, userId, payload);
    case 'endAttackPhase':
      return endAttackPhase(state, userId);
    case 'fortify':
      return fortify(state, userId, payload);
    case 'endTurn':
      return endTurn(state, userId);
    case 'declareBankruptcy':
      return declareBankruptcy(state, userId);
    default:
      return { state, events: [], error: `Unknown action: ${action}` };
  }
}

// ── interface: skipTurn (D5 — skip the entire turn, all phases) ──────────────

function skipTurn(state, userId) {
  const events = [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return { state, events: [] };

  state = clone(state);
  // Draw a card if the player conquered at least one territory this turn.
  const player = state.players.find((p) => p.userId === userId);
  if (player.conqueredThisTurn) {
    const card = drawCard(state);
    if (card) {
      player.hand.push(card);
      events.push(event('CARD_DRAWN', { username: player.username }));
    }
    player.conqueredThisTurn = false;
  }

  log(state, `${cur.username}'s turn was skipped (AFK).`, 'turn');
  events.push(event('TURN_SKIPPED', { username: cur.username }));

  const result = advanceToNextPlayer(state);
  state = result.state;
  events.push(...result.events);

  return { state, events };
}

// ── interface: getStateForPlayer ─────────────────────────────────────────────
//
// SECURITY-CRITICAL.  Risk is the platform's first hidden-information game.
// Every other player's `hand` field must be replaced with a numeric handCount
// before the state is sent over the socket.  The acting player sees their
// own cards.
//
// Do NOT swap this out for defaultGetStateForPlayer — that would broadcast
// every player's full hand to every opponent.
//
// IMPORTANT: This function must be safe to call on every state the framework
// might emit, including waiting-room states that exist before initGame() has
// run.  At that point, game-specific fields (deck, board, properties, hand,
// turnState, etc.) are not yet populated.  Use optional chaining and explicit
// guards against missing fields, not assumptions about shape.  Crashing here
// breaks lobby join for the whole game.

function getStateForPlayer(state, userId) {
  const view = {
    ...state,
    players: state.players.map((p) => {
      if (p.userId === userId) return p;
      // Players in waiting-room state haven't been through initGame() yet so
      // their hand may be absent — treat as empty.
      const hand = p.hand || [];
      const { hand: _h, ...rest } = p;
      return { ...rest, handCount: hand.length };
    }),
  };
  // Strip the global deck/discard contents too — clients only need counts.
  // Waiting-room states predate initGame() and have no deck at all.
  if (Array.isArray(state.deck)) view.deck = { count: state.deck.length };
  if (Array.isArray(state.discardPile)) view.discardPile = { count: state.discardPile.length };
  return view;
}

// ── interface: migrate ───────────────────────────────────────────────────────

function migrate(state) {
  // No structural changes yet — STATE_VERSION 1 is the initial release.
  // Future migrations follow this pattern:
  //
  //   if (state.stateVersion < 2) {
  //     state = { ...state, newField: defaultValue, stateVersion: 2 };
  //   }
  throw new Error(
    `[risk] No migration path from stateVersion ${state.stateVersion} to ${STATE_VERSION}`,
  );
}

// ── small utility: territory name lookup for log messages ────────────────────

function territoryName(state, territoryId) {
  return state.config.territoryById[territoryId].name;
}

// ── exports ──────────────────────────────────────────────────────────────────

module.exports = {
  STATE_VERSION,

  // ── GameLogic interface methods ────────────────────────────────────────────
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
  getStateForPlayer,
  migrate,

  // ── Internal helpers exported for tests ────────────────────────────────────
  computeReinforcements,
  getOwnedTerritories,
  getContinentsOwned,
  isValidCardSet,
  hasAnyValidCardSet,
  nextSetBonus,
  resolveCombat,
  canFortifyPath,
  distributeArmies,
};

validateImplementation(module.exports, {
  internalExports: [
    'computeReinforcements',
    'getOwnedTerritories',
    'getContinentsOwned',
    'isValidCardSet',
    'hasAnyValidCardSet',
    'nextSetBonus',
    'resolveCombat',
    'canFortifyPath',
    'distributeArmies',
  ],
});
