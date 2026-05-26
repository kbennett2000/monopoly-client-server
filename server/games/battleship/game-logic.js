'use strict';

/**
 * Battleship game-logic module.
 * Implements the GameLogic interface defined in server/src/game-logic-interface.js.
 *
 * Standard 2-player Battleship: each player privately places five ships on
 * their own 10×10 grid, then both players take alternating shots at the
 * opponent's grid until one fleet is entirely sunk.
 *
 * ─── Out of scope for v1 (deliberate omissions) ───────────────────────────────
 *   • Salvo mode (one shot per surviving ship per turn).
 *   • "Extra turn on hit" house rule.
 *   • Multi-shot variants, ship abilities, special weapons.
 *   • N-player Battleship (the game is fundamentally a duel; v1 is 2 only).
 *   • Setup-phase timer / kick mechanism. Real games can take 60-180s to set
 *     up; the framework's chat covers this for v1. Adding a per-phase timer
 *     is a separate framework decision.
 *
 * ─── New patterns this game introduces ────────────────────────────────────────
 *   • SIMULTANEOUS SETUP PHASE — both players can act before any turn begins.
 *     Modelled as `state.status='playing'` + `state.turnState.phase='setup'`
 *     with `currentPlayerIndex=null`. The phase auto-transitions to 'firing'
 *     when both players become Ready (a barrier, not a turn).
 *   • HIDDEN GAME STATE — each player's ship positions are private to that
 *     player. Enforced by getStateForPlayer below, which REMOVES the `ships`
 *     field from the opponent's record on every emit (rather than masking).
 *
 * ─── State shape ──────────────────────────────────────────────────────────────
 *
 * GameState {
 *   id, name, gameType: 'battleship', stateVersion, status, config,
 *   createdBy, minPlayers, maxPlayers,
 *   players: Player[],         // length 2
 *   turnState: TurnState,
 *   winner: string | null,     // userId of winner, null until determined
 *   log: LogEntry[]
 * }
 *
 * Player {
 *   userId, username, color, colorHex, token, active, connected,
 *   // ── Setup-phase state (private to this player) ──────────────────
 *   ships: Ship[],             // ships this player has placed
 *   ready: boolean,            // has this player committed their placement?
 *   // ── Play-phase state (mixed visibility) ─────────────────────────
 *   shotsReceived: Shot[],     // shots the opponent fired AT this player
 *   shotsFired:    Shot[],     // shots this player fired AT the opponent
 *   shipsSunk:     string[]    // ids of this player's ships that have been sunk
 * }
 *
 * Ship {
 *   id, length, orientation: 'horizontal' | 'vertical',
 *   origin: { x, y },     // top-left for horizontal, top for vertical
 *   cells:  Cell[],       // derived from origin+orientation+length
 *   hits:   Cell[]        // cells hit so far, derived from shotsReceived
 * }
 *
 * Shot {
 *   cell:        { x, y },
 *   result:      'hit' | 'miss' | 'sunk',
 *   sunkShipId?: string,   // only present when result === 'sunk'
 *   timestamp:   number
 * }
 *
 * TurnState {
 *   phase: 'setup' | 'firing',
 *   currentPlayerIndex: number | null,   // null during setup; 0 or 1 during firing
 *   setupCompleteAt:    number | null    // timestamp of setup→firing transition
 * }
 */

const fs = require('fs');
const path = require('path');
const { validateImplementation } = require('../../src/game-logic-interface');
// NOTE: This is the first game where defaultGetStateForPlayer would be a
// CRITICAL bug — every player's ship positions would leak to the opponent.
// A real getStateForPlayer is implemented below.

const STATE_VERSION = 1;
const CONFIG_DIR = path.join(__dirname, 'config');
let _config = null;

// ── config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  const settings = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'settings.json'), 'utf8'));
  if (settings.firstPlayerSelection !== 'random') {
    // Other plausible value in the future: "first-ready" (the player who
    // committed their placement first goes first). Not implemented in v1.
    throw new Error(
      `[battleship] firstPlayerSelection="${settings.firstPlayerSelection}" not implemented; only "random" is supported in v1.`,
    );
  }
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
    name: 'Battleship',
    description: 'Place your fleet, then guess where the enemy hid theirs.',
    minPlayers: 2,
    maxPlayers: 2,
    icon: '🚢',
    estimatedDurationMinutes: 15,
    complexity: 'light',
    // Battleship outcomes hinge on guessing under uncertainty and reading the
    // opponent — there's no dice or shuffle. Classified as no-luck on the same
    // grounds poker is mostly skill.
    tags: ['spatial', 'hidden-information', 'two-player', 'classic', 'no-luck'],
  };
}

// ── player creation ───────────────────────────────────────────────────────────

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
    ships: [],
    ready: false,
    shotsReceived: [],
    shotsFired: [],
    shipsSunk: [],
  };
}

// ── game initialisation ───────────────────────────────────────────────────────

function initGame(gameId, name, players, config) {
  const cfg = config || getConfigCopy();
  return {
    id: gameId,
    name,
    gameType: 'battleship',
    stateVersion: STATE_VERSION,
    status: 'playing',
    config: cfg,
    players: players.map((p) => ({
      ...p,
      ships: p.ships || [],
      ready: p.ready ?? false,
      shotsReceived: p.shotsReceived || [],
      shotsFired: p.shotsFired || [],
      shipsSunk: p.shipsSunk || [],
    })),
    turnState: {
      phase: 'setup',
      currentPlayerIndex: null,
      setupCompleteAt: null,
    },
    winner: null,
    log: [],
  };
}

// ── geometry helpers ──────────────────────────────────────────────────────────

function computeShipCells(origin, length, orientation) {
  const cells = [];
  for (let i = 0; i < length; i++) {
    if (orientation === 'horizontal') cells.push({ x: origin.x + i, y: origin.y });
    else cells.push({ x: origin.x, y: origin.y + i });
  }
  return cells;
}

function cellKey(c) {
  return `${c.x},${c.y}`;
}

function inBounds(c, w, h) {
  return (
    Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.x < w && c.y >= 0 && c.y < h
  );
}

function shipById(config, shipId) {
  return config.settings.ships.find((s) => s.id === shipId) || null;
}

// ── player lookups ────────────────────────────────────────────────────────────

function indexOfPlayer(state, userId) {
  return state.players.findIndex((p) => p.userId === userId);
}

function opponentIndexOf(state, userId) {
  const me = indexOfPlayer(state, userId);
  if (me < 0) return -1;
  return me === 0 ? 1 : 0;
}

// ── turn helpers ──────────────────────────────────────────────────────────────

/**
 * During the setup phase BOTH players are active simultaneously, so there is no
 * single "current" player. Returns null in that case. The framework's turn-timer
 * and disconnect logic in socket-handler.js already handle null gracefully
 * (verified: both consumers use `cur?.userId` / `!cur` short-circuits).
 */
function getCurrentPlayer(state) {
  if (!state?.turnState || state.turnState.phase !== 'firing') return null;
  const p = state.players[state.turnState.currentPlayerIndex];
  if (!p) return null;
  return { userId: p.userId, username: p.username };
}

/**
 * Setup phase has no turn timer — both players need free time to place
 * ships and the framework's 30s auto-skip would be actively harmful.
 * Matches the `isTurnTimerBlocked` escape-hatch pattern Monopoly uses for
 * auctions and Risk for multi-step phases.
 */
function isTurnTimerBlocked(state) {
  return state?.turnState?.phase === 'setup';
}

/**
 * Rich-shape action descriptors for the Battleship renderer. See
 * docs/action-descriptors.md for the contract. Safe on pre-initGame
 * waiting-room states (returns []).
 *
 * Shape choices documented in the design doc:
 *   • commitPlacement / uncommitPlacement are SEPARATE descriptors;
 *     `enabled` flips between them so the renderer picks the active one.
 *   • placeShip / fireShot are single descriptors (no per-cell / per-ship
 *     enumeration) — the renderer drives the payload via drag / click.
 *   • The `hint` field doubles as button tooltip and status-line text;
 *     the renderer surfaces it in both places.
 */
function getActionDescriptors(state, userId) {
  if (!state || state.status !== 'playing') return [];
  const idx = indexOfPlayer(state, userId);
  if (idx < 0) return [];
  const me = state.players[idx];
  const phase = state.turnState?.phase;
  const total = state.config.settings.ships.length;

  if (phase === 'setup') {
    const placed = me.ships.length;
    const remaining = total - placed;
    const allPlaced = placed === total;
    const editing = !me.ready;
    const placeHint = me.ready
      ? "You've committed — un-ready to rearrange."
      : allPlaced
        ? `All ${total} placed — click Ready when you're set.`
        : `Place your ships — ${placed} of ${total} placed.`;
    return [
      {
        action: 'placeShip',
        label: 'Drag a ship onto your grid',
        enabled: editing,
        hint: placeHint,
        data: { shipsPlaced: placed, shipsRequired: total },
      },
      {
        action: 'removeShip',
        label: 'Pick up a placed ship',
        enabled: editing && placed > 0,
        hint: editing
          ? placed > 0
            ? 'Drag a placed ship to reposition it.'
            : 'No ships placed yet.'
          : "You've committed — un-ready to rearrange.",
      },
      {
        action: 'commitPlacement',
        label: 'Ready',
        enabled: editing && allPlaced,
        hint: me.ready
          ? 'Already committed.'
          : allPlaced
            ? 'Click to commit your placement.'
            : remaining === total
              ? 'Place all 5 ships first.'
              : `Place all ${total} ships first (${remaining} remaining).`,
        data: { shipsPlaced: placed, shipsRequired: total },
      },
      {
        action: 'uncommitPlacement',
        label: 'Unready',
        // Per uncommitPlacement's server check: phase must still be 'setup'
        // and player.ready must be true. Both are encoded by `me.ready`
        // here — once both players ready, the phase transitions to firing
        // and this descriptor is no longer returned at all.
        enabled: me.ready,
        hint: me.ready ? 'Take back your commitment.' : "You haven't committed yet.",
      },
    ];
  }

  if (phase === 'firing') {
    const isMyTurn = state.turnState.currentPlayerIndex === idx;
    const opp = state.players[opponentIndexOf(state, userId)];
    return [
      {
        action: 'fireShot',
        label: `Fire at ${opp?.username || 'opponent'}'s waters`,
        enabled: isMyTurn,
        hint: isMyTurn ? 'Click an unshot cell.' : `${opp?.username || 'Opponent'}'s turn.`,
      },
    ];
  }

  return [];
}

function getValidActions(state, userId) {
  if (!state || state.status !== 'playing') return [];
  const idx = indexOfPlayer(state, userId);
  if (idx < 0) return [];
  const me = state.players[idx];
  const phase = state.turnState?.phase;
  const shipsConfigured = state.config.settings.ships.length;

  if (phase === 'setup') {
    if (me.ready) {
      // Once both players become Ready the phase auto-transitions to firing,
      // so this branch is only reachable for the first player to commit.
      // uncommit is only valid while the phase is still setup.
      return ['uncommitPlacement'];
    }
    const actions = ['placeShip', 'removeShip'];
    if (me.ships.length === shipsConfigured) actions.push('commitPlacement');
    return actions;
  }

  if (phase === 'firing') {
    const cur = state.players[state.turnState.currentPlayerIndex];
    if (cur?.userId === userId) return ['fireShot'];
    return [];
  }

  return [];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACTIONS — setup phase
// ═══════════════════════════════════════════════════════════════════════════════

function placeShip(state, userId, payload) {
  const idx = indexOfPlayer(state, userId);
  if (idx < 0) return { state, events: [], error: 'Not a player in this game' };
  if (state.turnState.phase !== 'setup') {
    return { state, events: [], error: 'Ship placement is only allowed during setup' };
  }
  const me = state.players[idx];
  if (me.ready) {
    return {
      state,
      events: [],
      error: 'Cannot rearrange after committing — uncommitPlacement first',
    };
  }

  const shipId = payload?.shipId;
  const shipDef = shipById(state.config, shipId);
  if (!shipDef) {
    return { state, events: [], error: `Unknown shipId: ${shipId}` };
  }
  const orientation = payload?.orientation;
  if (orientation !== 'horizontal' && orientation !== 'vertical') {
    return { state, events: [], error: 'orientation must be "horizontal" or "vertical"' };
  }
  const origin = payload?.origin;
  if (!origin || !Number.isInteger(origin.x) || !Number.isInteger(origin.y)) {
    return { state, events: [], error: 'origin must be { x: integer, y: integer }' };
  }
  const { gridWidth, gridHeight } = state.config.settings;
  if (!inBounds(origin, gridWidth, gridHeight)) {
    return { state, events: [], error: 'origin is out of bounds' };
  }
  const cells = computeShipCells(origin, shipDef.length, orientation);
  if (!cells.every((c) => inBounds(c, gridWidth, gridHeight))) {
    return { state, events: [], error: 'ship extends out of bounds' };
  }
  // Overlap check: ignore this shipId (placeShip doubles as "move").
  const otherCells = new Set();
  for (const ship of me.ships) {
    if (ship.id === shipId) continue;
    for (const c of ship.cells) otherCells.add(cellKey(c));
  }
  for (const c of cells) {
    if (otherCells.has(cellKey(c))) {
      return { state, events: [], error: 'ship overlaps another placed ship' };
    }
  }

  const newShip = {
    id: shipDef.id,
    length: shipDef.length,
    orientation,
    origin: { x: origin.x, y: origin.y },
    cells,
    hits: [],
  };
  const newShips = me.ships.filter((s) => s.id !== shipId).concat(newShip);
  const newPlayers = state.players.map((p, i) => (i === idx ? { ...p, ships: newShips } : p));

  return {
    state: {
      ...state,
      players: newPlayers,
      log: [
        ...(state.log || []),
        {
          message: `${me.username} placed ${shipDef.name}`,
          type: 'setup',
          timestamp: Date.now(),
        },
      ],
    },
    // SHIP_PLACED is broadcast to BOTH players, so position MUST NOT be in
    // the event payload — that would leak ship locations during setup.
    events: [
      {
        type: 'SHIP_PLACED',
        data: { username: me.username, shipId },
        timestamp: Date.now(),
      },
    ],
  };
}

function removeShip(state, userId, payload) {
  const idx = indexOfPlayer(state, userId);
  if (idx < 0) return { state, events: [], error: 'Not a player in this game' };
  if (state.turnState.phase !== 'setup') {
    return { state, events: [], error: 'Ship removal is only allowed during setup' };
  }
  const me = state.players[idx];
  if (me.ready) {
    return {
      state,
      events: [],
      error: 'Cannot rearrange after committing — uncommitPlacement first',
    };
  }
  const shipId = payload?.shipId;
  if (!me.ships.find((s) => s.id === shipId)) {
    return { state, events: [], error: 'Ship is not currently placed' };
  }
  const newShips = me.ships.filter((s) => s.id !== shipId);
  const newPlayers = state.players.map((p, i) => (i === idx ? { ...p, ships: newShips } : p));
  return {
    state: {
      ...state,
      players: newPlayers,
      log: [
        ...(state.log || []),
        { message: `${me.username} removed a ship`, type: 'setup', timestamp: Date.now() },
      ],
    },
    // Same privacy rule as SHIP_PLACED — no positional info in the event.
    events: [
      { type: 'SHIP_REMOVED', data: { username: me.username, shipId }, timestamp: Date.now() },
    ],
  };
}

function commitPlacement(state, userId) {
  const idx = indexOfPlayer(state, userId);
  if (idx < 0) return { state, events: [], error: 'Not a player in this game' };
  if (state.turnState.phase !== 'setup') {
    return { state, events: [], error: 'Commit is only allowed during setup' };
  }
  const me = state.players[idx];
  if (me.ready) {
    return { state, events: [], error: 'Already committed' };
  }
  const shipsConfigured = state.config.settings.ships.length;
  if (me.ships.length !== shipsConfigured) {
    return {
      state,
      events: [],
      error: `All ${shipsConfigured} ships must be placed before committing (currently ${me.ships.length})`,
    };
  }

  const newPlayers = state.players.map((p, i) => (i === idx ? { ...p, ready: true } : p));
  const events = [{ type: 'PLAYER_READY', data: { username: me.username }, timestamp: Date.now() }];
  const log = [
    ...(state.log || []),
    { message: `${me.username} is ready`, type: 'setup', timestamp: Date.now() },
  ];

  // Both ready? Auto-transition to the firing phase.
  if (newPlayers.every((p) => p.ready)) {
    const firstIdx = Math.random() < 0.5 ? 0 : 1;
    const first = newPlayers[firstIdx];
    const now = Date.now();
    events.push({
      type: 'SETUP_COMPLETE',
      data: { firstPlayer: first.username },
      timestamp: now,
    });
    // Emit TURN_STARTED here too so the renderer has one consistent
    // signal for "this player is up" across the first and all subsequent
    // turns; otherwise the renderer would need a separate branch for the
    // first turn after setup.
    events.push({
      type: 'TURN_STARTED',
      data: { username: first.username },
      timestamp: now,
    });
    log.push({
      message: `Both players ready — ${first.username} fires first`,
      type: 'game',
      timestamp: now,
    });
    return {
      state: {
        ...state,
        players: newPlayers,
        turnState: {
          phase: 'firing',
          currentPlayerIndex: firstIdx,
          setupCompleteAt: now,
        },
        log,
      },
      events,
    };
  }

  return { state: { ...state, players: newPlayers, log }, events };
}

function uncommitPlacement(state, userId) {
  const idx = indexOfPlayer(state, userId);
  if (idx < 0) return { state, events: [], error: 'Not a player in this game' };
  // Once both players become Ready the phase transitions to 'firing' and
  // un-readying is no longer possible — the single phase check covers this.
  if (state.turnState.phase !== 'setup') {
    return { state, events: [], error: 'Cannot un-ready after firing has begun' };
  }
  const me = state.players[idx];
  if (!me.ready) {
    return { state, events: [], error: 'Not currently ready' };
  }
  const newPlayers = state.players.map((p, i) => (i === idx ? { ...p, ready: false } : p));
  return {
    state: {
      ...state,
      players: newPlayers,
      log: [
        ...(state.log || []),
        { message: `${me.username} un-readied`, type: 'setup', timestamp: Date.now() },
      ],
    },
    events: [{ type: 'PLAYER_UNREADY', data: { username: me.username }, timestamp: Date.now() }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACTIONS — firing phase
// ═══════════════════════════════════════════════════════════════════════════════

function fireShot(state, userId, payload) {
  if (state.status !== 'playing') {
    return { state, events: [], error: 'Game is not in playing state' };
  }
  if (state.turnState.phase !== 'firing') {
    return { state, events: [], error: 'Cannot fire during setup' };
  }
  const meIdx = indexOfPlayer(state, userId);
  if (meIdx < 0) return { state, events: [], error: 'Not a player in this game' };
  if (state.turnState.currentPlayerIndex !== meIdx) {
    return { state, events: [], error: 'Not your turn' };
  }
  const oppIdx = opponentIndexOf(state, userId);
  const me = state.players[meIdx];
  const opp = state.players[oppIdx];

  const cell = payload?.cell;
  const { gridWidth, gridHeight } = state.config.settings;
  if (!cell || !inBounds(cell, gridWidth, gridHeight)) {
    return { state, events: [], error: 'cell is out of bounds or malformed' };
  }
  if (me.shotsFired.some((s) => s.cell.x === cell.x && s.cell.y === cell.y)) {
    return { state, events: [], error: 'Cell has already been targeted' };
  }

  // Determine the result by scanning the opponent's actual (server-side) ship
  // layout. The renderer never sees opp.ships — only the resolved Shot record.
  let hitShip = null;
  for (const ship of opp.ships) {
    if (ship.cells.some((c) => c.x === cell.x && c.y === cell.y)) {
      hitShip = ship;
      break;
    }
  }

  const now = Date.now();
  let shot;
  let updatedOppShips = opp.ships;
  let updatedSunk = opp.shipsSunk;
  let sunkShipDef = null;

  if (!hitShip) {
    shot = { cell: { x: cell.x, y: cell.y }, result: 'miss', timestamp: now };
  } else {
    const newHits = hitShip.hits.concat({ x: cell.x, y: cell.y });
    const allHit = newHits.length >= hitShip.length;
    const updatedShip = { ...hitShip, hits: newHits };
    updatedOppShips = opp.ships.map((s) => (s.id === hitShip.id ? updatedShip : s));
    if (allHit) {
      shot = {
        cell: { x: cell.x, y: cell.y },
        result: 'sunk',
        sunkShipId: hitShip.id,
        timestamp: now,
      };
      updatedSunk = opp.shipsSunk.concat(hitShip.id);
      sunkShipDef = updatedShip;
    } else {
      shot = { cell: { x: cell.x, y: cell.y }, result: 'hit', timestamp: now };
    }
  }

  const events = [
    {
      type: 'SHOT_FIRED',
      data: {
        shooter: me.username,
        target: opp.username,
        cell: { x: cell.x, y: cell.y },
        result: shot.result,
      },
      timestamp: now,
    },
  ];
  const logs = [
    ...(state.log || []),
    {
      message: `${me.username} fires at (${cell.x + 1},${cell.y + 1}): ${shot.result}`,
      type: shot.result === 'miss' ? 'info' : 'hit',
      timestamp: now,
    },
  ];

  if (sunkShipDef) {
    // SHIP_SUNK reveals the ship's full cell footprint — by rule, a sunk ship
    // is no longer hidden information. The renderer paints all cells as sunk.
    events.push({
      type: 'SHIP_SUNK',
      data: {
        owner: opp.username,
        shipId: sunkShipDef.id,
        shipName: shipById(state.config, sunkShipDef.id)?.name || sunkShipDef.id,
        length: sunkShipDef.length,
        cells: sunkShipDef.cells.map((c) => ({ x: c.x, y: c.y })),
      },
      timestamp: now,
    });
    logs.push({
      message: `${me.username} sunk ${opp.username}'s ${shipById(state.config, sunkShipDef.id)?.name || sunkShipDef.id}!`,
      type: 'game',
      timestamp: now,
    });
  }

  // Build the updated player records.
  const newMe = { ...me, shotsFired: me.shotsFired.concat(shot) };
  const newOpp = {
    ...opp,
    ships: updatedOppShips,
    shotsReceived: opp.shotsReceived.concat(shot),
    shipsSunk: updatedSunk,
  };
  const newPlayers = state.players.map((p, i) => {
    if (i === meIdx) return newMe;
    if (i === oppIdx) return newOpp;
    return p;
  });

  // Game over?
  const totalShips = state.config.settings.ships.length;
  if (updatedSunk.length === totalShips) {
    // Reveal both fleets at game over. The state filter still hides opp
    // ships at all times (status-independent for security clarity); the
    // reveal travels through the event channel, which is broadcast
    // identically to every player. Once the game is finished, the hidden
    // information no longer matters by rule.
    events.push({
      type: 'GAME_OVER',
      data: {
        winner: me.userId,
        winnerUsername: me.username,
        finalFleets: {
          [newMe.userId]: newMe.ships,
          [newOpp.userId]: newOpp.ships,
        },
      },
      timestamp: now,
    });
    logs.push({
      message: `${me.username} wins! All of ${opp.username}'s ships are sunk.`,
      type: 'game',
      timestamp: now,
    });
    return {
      state: {
        ...state,
        players: newPlayers,
        status: 'finished',
        winner: me.userId,
        log: logs,
      },
      events,
    };
  }

  // Otherwise advance to the opponent.
  events.push({
    type: 'TURN_STARTED',
    data: { username: newOpp.username },
    timestamp: now,
  });
  return {
    state: {
      ...state,
      players: newPlayers,
      turnState: { ...state.turnState, currentPlayerIndex: oppIdx },
      log: logs,
    },
    events,
  };
}

function skipTurn(state, userId) {
  // Skipping during setup is meaningless — both players are placing ships in
  // parallel and there is no turn to skip. isTurnTimerBlocked already
  // prevents the framework from invoking this during setup, but return an
  // explicit error in case anything else calls it directly.
  if (state.turnState?.phase !== 'firing') {
    return { state, events: [], error: 'Cannot skip a turn during setup' };
  }
  const meIdx = indexOfPlayer(state, userId);
  if (meIdx < 0 || state.turnState.currentPlayerIndex !== meIdx) {
    return { state, events: [], error: "Not this player's turn" };
  }
  const oppIdx = opponentIndexOf(state, userId);
  const me = state.players[meIdx];
  const opp = state.players[oppIdx];
  const now = Date.now();
  return {
    state: {
      ...state,
      turnState: { ...state.turnState, currentPlayerIndex: oppIdx },
      log: [
        ...(state.log || []),
        { message: `${me.username}'s turn was skipped`, type: 'info', timestamp: now },
      ],
    },
    events: [
      { type: 'TURN_SKIPPED', data: { username: me.username }, timestamp: now },
      { type: 'TURN_STARTED', data: { username: opp.username }, timestamp: now },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  applyAction dispatcher
// ═══════════════════════════════════════════════════════════════════════════════

function applyAction(state, userId, action, payload = {}) {
  switch (action) {
    case 'placeShip':
      return placeShip(state, userId, payload);
    case 'removeShip':
      return removeShip(state, userId, payload);
    case 'commitPlacement':
      return commitPlacement(state, userId);
    case 'uncommitPlacement':
      return uncommitPlacement(state, userId);
    case 'fireShot':
      return fireShot(state, userId, payload);
    case 'skipTurn':
      return skipTurn(state, userId);
    default:
      return { state, events: [], error: `Unknown action: ${action}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  getStateForPlayer
//
// SECURITY CRITICAL: This function is the only thing standing between an
// opponent and full knowledge of your ship positions. The `ships` field must
// be REMOVED from the opponent's player record on every emit, not masked. A
// masked field (e.g. ships: []) is still better than nothing, but removing
// the field entirely is the simplest defensive posture — there is no field
// for a malicious client to introspect for length, orientation, or cell
// data, and any future field added to Ship is automatically hidden too.
// ═══════════════════════════════════════════════════════════════════════════════

function getStateForPlayer(state, userId) {
  if (!state || !Array.isArray(state.players)) return state;
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.userId === userId) return p;
      // Safe on waiting-room states: players placed via createInitialPlayer
      // have a ships field (empty array) already; pre-initGame players might
      // not. Either way, destructuring `{ ships: _ships, ...rest }` produces
      // an object without a `ships` key.
      const { ships, ...rest } = p;
      // Expose a count (not positions) of the opponent's placed ships so
      // the renderer can show "N of 5 placed" during setup. The count
      // reveals strictly less than PLAYER_READY (which implies 5/5); no
      // security boundary moves.
      return { ...rest, placementCount: ships?.length ?? 0 };
    }),
  };
}

// ── migration ────────────────────────────────────────────────────────────────

function migrate(state) {
  if (state.stateVersion === STATE_VERSION) return state;
  throw new Error(
    `[battleship] No migration path from stateVersion ${state.stateVersion} to ${STATE_VERSION}`,
  );
}

// ── exports ──────────────────────────────────────────────────────────────────

module.exports = {
  STATE_VERSION,
  initGame,
  createInitialPlayer,
  applyAction,
  skipTurn,
  getCurrentPlayer,
  isTurnTimerBlocked,
  getValidActions,
  getActionDescriptors,
  getGameMetadata,
  loadConfig,
  getConfigCopy,
  getStateForPlayer,
  migrate,

  // Internal helpers exported for unit tests.
  computeShipCells,
  cellKey,
  inBounds,
};

validateImplementation(module.exports, {
  internalExports: ['computeShipCells', 'cellKey', 'inBounds'],
});
