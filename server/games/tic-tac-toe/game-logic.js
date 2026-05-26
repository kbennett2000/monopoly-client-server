'use strict';

/**
 * Tic-Tac-Toe game-logic module.
 * Implements the GameLogic interface defined in server/src/game-logic-interface.js.
 *
 * State shape:
 *   {
 *     id, name, gameType, createdBy, stateVersion, status, config,
 *     players: [{ userId, username, color, colorHex, token, active, connected }],
 *     board:   (string|null)[][] — [row][col], null = empty, userId = cell owner
 *     turnState: { currentPlayerIndex, phase: 'mark' }
 *     winner:  string | null   (userId of winner, or null for draw)
 *     log:     [{ message, type, timestamp }]
 *   }
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
    name: 'Tic-Tac-Toe',
    description: 'Mark three in a row to win.',
    minPlayers: 2,
    maxPlayers: 2,
    icon: '✕',
    estimatedDurationMinutes: 2,
    complexity: 'light',
    tags: ['no-luck', 'family', 'classic', 'two-player'],
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
  };
}

// ── game initialisation ───────────────────────────────────────────────────────

function initGame(gameId, name, players, config) {
  const cfg = config || getConfigCopy();
  const size = cfg.settings.boardSize;
  const board = Array.from({ length: size }, () => Array(size).fill(null));
  return {
    id: gameId,
    name,
    gameType: 'tic-tac-toe',
    stateVersion: STATE_VERSION,
    status: 'playing',
    config: cfg,
    players: players.map((p) => ({ ...p })),
    board,
    turnState: { currentPlayerIndex: 0, phase: 'mark' },
    winner: null,
    log: [],
  };
}

// ── turn helpers ──────────────────────────────────────────────────────────────

function getCurrentPlayer(state) {
  if (!state?.turnState) return null;
  return state.players[state.turnState.currentPlayerIndex] || null;
}

function isTurnTimerBlocked(_state) {
  return false;
}

function getValidActions(state, userId) {
  if (state.status !== 'playing') return [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return [];
  const size = state.config.settings.boardSize;
  const actions = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (state.board[r][c] === null) actions.push(`markCell:${r},${c}`);
    }
  }
  return actions;
}

// ── win detection ─────────────────────────────────────────────────────────────

function checkWinner(board, row, col, userId, winLength) {
  const size = board.length;
  // Four directions: horizontal, vertical, diagonal-↘, diagonal-↙
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (let i = 1; i < winLength; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r][c] !== userId) break;
      count++;
    }
    for (let i = 1; i < winLength; i++) {
      const r = row - dr * i;
      const c = col - dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r][c] !== userId) break;
      count++;
    }
    if (count >= winLength) return true;
  }
  return false;
}

function isBoardFull(board) {
  for (const row of board) {
    for (const cell of row) {
      if (cell === null) return false;
    }
  }
  return true;
}

// ── actions ───────────────────────────────────────────────────────────────────

function markCell(state, userId, payload) {
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) {
    return { state, events: [], error: 'Not your turn' };
  }
  if (state.status !== 'playing') {
    return { state, events: [], error: 'Game is not in playing state' };
  }

  const size = state.config.settings.boardSize;
  const row = Number(payload?.row);
  const col = Number(payload?.col);
  if (
    !Number.isInteger(row) ||
    row < 0 ||
    row >= size ||
    !Number.isInteger(col) ||
    col < 0 ||
    col >= size
  ) {
    return { state, events: [], error: 'Invalid cell coordinates' };
  }
  if (state.board[row][col] !== null) {
    return { state, events: [], error: 'Cell is already marked' };
  }

  const newBoard = state.board.map((r) => [...r]);
  newBoard[row][col] = userId;

  const player = state.players.find((p) => p.userId === userId);
  const events = [
    {
      type: 'CELL_MARKED',
      data: { username: player.username, row, col, token: player.token },
      timestamp: Date.now(),
    },
  ];

  const { winLength } = state.config.settings;
  let newStatus = 'playing';
  let winner = null;
  let logMsg = `${player.username} marked (${row + 1},${col + 1})`;
  let logType = 'move';

  if (checkWinner(newBoard, row, col, userId, winLength)) {
    newStatus = 'finished';
    winner = userId;
    logMsg = `${player.username} wins!`;
    logType = 'game';
    events.push({
      type: 'GAME_OVER',
      data: { winner: player.username },
      timestamp: Date.now(),
    });
  } else if (isBoardFull(newBoard)) {
    newStatus = 'finished';
    logMsg = "It's a draw!";
    logType = 'game';
    events.push({ type: 'GAME_OVER', data: { winner: null }, timestamp: Date.now() });
  }

  const nextIdx =
    newStatus === 'playing'
      ? (state.turnState.currentPlayerIndex + 1) % state.players.length
      : state.turnState.currentPlayerIndex;

  const newState = {
    ...state,
    board: newBoard,
    status: newStatus,
    winner,
    turnState: { ...state.turnState, currentPlayerIndex: nextIdx },
    log: [...(state.log || []), { message: logMsg, type: logType, timestamp: Date.now() }],
  };

  return { state: newState, events };
}

function skipTurn(state, userId) {
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) {
    return { state, events: [], error: "Not this player's turn" };
  }
  const nextIdx = (state.turnState.currentPlayerIndex + 1) % state.players.length;
  const newState = {
    ...state,
    turnState: { ...state.turnState, currentPlayerIndex: nextIdx },
    log: [
      ...(state.log || []),
      { message: `${cur.username}'s turn was skipped`, type: 'info', timestamp: Date.now() },
    ],
  };
  return {
    state: newState,
    events: [{ type: 'TURN_SKIPPED', data: { username: cur.username }, timestamp: Date.now() }],
  };
}

// ── applyAction dispatcher ────────────────────────────────────────────────────

function applyAction(state, userId, action, payload = {}) {
  switch (action) {
    case 'markCell':
      return markCell(state, userId, payload);
    case 'skipTurn':
      return skipTurn(state, userId);
    default:
      return { state, events: [], error: `Unknown action: ${action}` };
  }
}

// ── migration ─────────────────────────────────────────────────────────────────

function migrate(state) {
  throw new Error(
    `[tic-tac-toe] No migration path from stateVersion ${state.stateVersion} to ${STATE_VERSION}`,
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
  getStateForPlayer: defaultGetStateForPlayer,
  migrate,
};

validateImplementation(module.exports);
