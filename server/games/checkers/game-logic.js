'use strict';

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
  return JSON.parse(JSON.stringify(_config));
}

// ── metadata ──────────────────────────────────────────────────────────────────

function getGameMetadata() {
  return {
    name: 'Checkers',
    description: 'Classic American Checkers — capture all opponent pieces or block them completely.',
    minPlayers: 2,
    maxPlayers: 2,
    icon: '🔴',
    estimatedDurationMinutes: 15,
    complexity: 'light',
    tags: ['classic', 'abstract', 'two-player', 'perfect-information'],
  };
}

// ── player creation ───────────────────────────────────────────────────────────

function createInitialPlayer(user, existingPlayers = [], config = null) {
  if (!config?.settings?.playerColors || !config?.settings?.playerTokens) {
    throw new Error(
      'createInitialPlayer requires a config with settings.playerColors and settings.playerTokens',
    );
  }
  const colors = config.settings.playerColors;
  const tokens = config.settings.playerTokens;
  const idx = existingPlayers.length;
  const colorObj = colors[idx] || colors[0];
  return {
    userId: user.id,
    username: user.username,
    color: colorObj.id,
    colorHex: colorObj.hex,
    token: tokens[idx] || colorObj.id,
    pieceCount: config.settings.piecesPerPlayer,
    active: true,
    connected: true,
  };
}

// ── board helpers ─────────────────────────────────────────────────────────────

function isDarkSquare(row, col) {
  return (row + col) % 2 === 1;
}

function isValidPosition(row, col, size) {
  return row >= 0 && row < size && col >= 0 && col < size;
}

function createStartingBoard(size, players) {
  const board = Array.from({ length: size }, () => Array(size).fill(null));
  const rowsPerSide = (size - 2) / 2; // 3 rows each for 8×8

  // Red pieces: bottom rows (rows 5-7 on 8×8). Red = players[0].
  for (let r = size - rowsPerSide; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isDarkSquare(r, c)) {
        board[r][c] = { color: 'red', king: false };
      }
    }
  }

  // Black pieces: top rows (rows 0-2 on 8×8). Black = players[1].
  for (let r = 0; r < rowsPerSide; r++) {
    for (let c = 0; c < size; c++) {
      if (isDarkSquare(r, c)) {
        board[r][c] = { color: 'black', king: false };
      }
    }
  }

  return board;
}

function cloneBoard(board) {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

function countPieces(board, color) {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.color === color) count++;
    }
  }
  return count;
}

// ── move generation ───────────────────────────────────────────────────────────

function getForwardDirections(color) {
  // Red starts at bottom (high rows), moves toward row 0 (up → dr = -1).
  // Black starts at top (low rows), moves toward row 7 (down → dr = +1).
  return color === 'red' ? [-1] : [1];
}

function getMoveDirections(piece) {
  if (piece.king) return [-1, 1];
  return getForwardDirections(piece.color);
}

function getMovesForPiece(board, row, col) {
  const piece = board[row][col];
  if (!piece) return { steps: [], captures: [] };
  const size = board.length;
  const rowDirs = getMoveDirections(piece);
  const colDirs = [-1, 1];
  const steps = [];
  const captures = [];

  for (const dr of rowDirs) {
    for (const dc of colDirs) {
      const toRow = row + dr;
      const toCol = col + dc;
      if (!isValidPosition(toRow, toCol, size)) continue;

      if (board[toRow][toCol] === null) {
        steps.push({ from: { row, col }, to: { row: toRow, col: toCol }, isCapture: false, captures: [] });
      } else if (board[toRow][toCol].color !== piece.color) {
        const jumpRow = toRow + dr;
        const jumpCol = toCol + dc;
        if (isValidPosition(jumpRow, jumpCol, size) && board[jumpRow][jumpCol] === null) {
          captures.push({
            from: { row, col },
            to: { row: jumpRow, col: jumpCol },
            isCapture: true,
            captures: [{ row: toRow, col: toCol }],
          });
        }
      }
    }
  }

  return { steps, captures };
}

function getCapturesForPiece(board, row, col) {
  return getMovesForPiece(board, row, col).captures;
}

function getAvailableCaptures(board, color) {
  const size = board.length;
  const allCaptures = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] && board[r][c].color === color) {
        allCaptures.push(...getCapturesForPiece(board, r, c));
      }
    }
  }
  return allCaptures;
}

function getAllValidMoves(board, color) {
  const size = board.length;
  const allCaptures = [];
  const allSteps = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] && board[r][c].color === color) {
        const { steps, captures } = getMovesForPiece(board, r, c);
        allCaptures.push(...captures);
        allSteps.push(...steps);
      }
    }
  }
  // Captures are mandatory — if any exist, only captures are legal.
  return allCaptures.length > 0 ? allCaptures : allSteps;
}

// ── game state queries ────────────────────────────────────────────────────────

function playerColor(state, userId) {
  const p = state.players.find((pl) => pl.userId === userId);
  return p ? p.color : null;
}

function playerIndex(state, userId) {
  return state.players.findIndex((p) => p.userId === userId);
}

function coronationRow(color) {
  // Red moves toward row 0; black moves toward row 7.
  return color === 'red' ? 0 : 7;
}

function checkGameOver(state) {
  const currentColor = state.players[state.turnState.currentPlayerIndex].color;
  const moves = getAllValidMoves(state.board, currentColor);
  if (moves.length === 0) {
    // Current player has no moves → they lose.
    const opponentIdx = (state.turnState.currentPlayerIndex + 1) % 2;
    return state.players[opponentIdx].userId;
  }

  // Check if either player has zero pieces.
  for (const p of state.players) {
    if (countPieces(state.board, p.color) === 0) {
      const winner = state.players.find((pl) => pl.color !== p.color);
      return winner.userId;
    }
  }

  return null;
}

// ── game initialisation ───────────────────────────────────────────────────────

function initGame(gameId, name, players, config) {
  const cfg = config || getConfigCopy();
  const size = cfg.settings.boardSize;
  const board = createStartingBoard(size, players);

  const captureRequired = getAvailableCaptures(board, 'red').length > 0;

  return {
    id: gameId,
    name,
    gameType: 'checkers',
    stateVersion: STATE_VERSION,
    status: 'playing',
    config: cfg,
    players: players.map((p) => ({ ...p })),
    board,
    turnState: { currentPlayerIndex: 0, phase: 'move' },
    winner: null,
    captureRequired,
    pendingChainPiece: null,
    lastMove: null,
    log: [],
  };
}

// ── turn helpers ──────────────────────────────────────────────────────────────

function getCurrentPlayer(state) {
  if (!state?.turnState || state.status !== 'playing') return null;
  const p = state.players[state.turnState.currentPlayerIndex];
  if (!p) return null;
  return { userId: p.userId, username: p.username };
}

function isTurnTimerBlocked(state) {
  return state?.pendingChainPiece != null;
}

function getValidActions(state, userId) {
  if (state.status !== 'playing') return [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return [];

  const color = playerColor(state, userId);
  if (!color) return [];

  if (state.pendingChainPiece) {
    const captures = getCapturesForPiece(
      state.board,
      state.pendingChainPiece.row,
      state.pendingChainPiece.col,
    );
    return captures.map(
      (m) => `move:${m.from.row},${m.from.col},${m.to.row},${m.to.col}`,
    );
  }

  const moves = getAllValidMoves(state.board, color);
  return moves.map(
    (m) => `move:${m.from.row},${m.from.col},${m.to.row},${m.to.col}`,
  );
}

// ── action descriptors ────────────────────────────────────────────────────────

function getActionDescriptors(state, userId) {
  if (!state || state.status !== 'playing') return [];
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) return [];

  const color = playerColor(state, userId);
  if (!color) return [];

  let moves;
  if (state.pendingChainPiece) {
    moves = getCapturesForPiece(
      state.board,
      state.pendingChainPiece.row,
      state.pendingChainPiece.col,
    );
  } else {
    moves = getAllValidMoves(state.board, color);
  }

  return moves.map((m) => ({
    action: 'move',
    label: m.isCapture ? 'Capture' : 'Move',
    enabled: true,
    hint: m.isCapture
      ? `Jump from (${m.from.row},${m.from.col}) to (${m.to.row},${m.to.col})`
      : `Move from (${m.from.row},${m.from.col}) to (${m.to.row},${m.to.col})`,
    data: {
      from: m.from,
      to: m.to,
      isCapture: m.isCapture,
      captures: m.captures,
    },
  }));
}

// ── actions ───────────────────────────────────────────────────────────────────

function move(state, userId, payload) {
  if (state.status !== 'playing') {
    return { state, events: [], error: 'Game is not in playing state' };
  }
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) {
    return { state, events: [], error: 'Not your turn' };
  }

  const { from, to } = payload;
  if (!from || !to) {
    return { state, events: [], error: 'Move requires from and to positions' };
  }

  const size = state.config.settings.boardSize;
  if (!isValidPosition(from.row, from.col, size) || !isValidPosition(to.row, to.col, size)) {
    return { state, events: [], error: 'Position out of bounds' };
  }

  const piece = state.board[from.row][from.col];
  if (!piece) {
    return { state, events: [], error: 'No piece at the source position' };
  }

  const color = playerColor(state, userId);
  if (piece.color !== color) {
    return { state, events: [], error: 'That piece does not belong to you' };
  }

  // If a chain is pending, must move the chain piece.
  if (state.pendingChainPiece) {
    if (from.row !== state.pendingChainPiece.row || from.col !== state.pendingChainPiece.col) {
      return { state, events: [], error: 'You must continue the capture chain with the same piece' };
    }
  }

  if (state.board[to.row][to.col] !== null) {
    return { state, events: [], error: 'Destination square is occupied' };
  }

  if (!isDarkSquare(to.row, to.col)) {
    return { state, events: [], error: 'Pieces can only move on dark squares' };
  }

  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;

  // Determine if this is a step or a capture.
  const isStep = Math.abs(rowDiff) === 1 && Math.abs(colDiff) === 1;
  const isCapture = Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 2;

  if (!isStep && !isCapture) {
    return { state, events: [], error: 'Invalid move distance' };
  }

  // Direction check: non-king pieces can only move in their forward direction.
  if (!piece.king) {
    const allowedDirs = getForwardDirections(piece.color);
    const dir = rowDiff > 0 ? 1 : -1;
    if (!allowedDirs.includes(dir)) {
      return { state, events: [], error: 'Regular pieces can only move forward' };
    }
  }

  // If in a pending chain, only captures are allowed.
  if (state.pendingChainPiece && !isCapture) {
    return { state, events: [], error: 'You must continue capturing' };
  }

  // Mandatory capture rule: if any capture is available, must capture.
  if (!state.pendingChainPiece && isStep) {
    const allCaptures = getAvailableCaptures(state.board, color);
    if (allCaptures.length > 0) {
      return { state, events: [], error: 'A capture is available — you must take it' };
    }
  }

  // Validate the capture target.
  if (isCapture) {
    const midRow = (from.row + to.row) / 2;
    const midCol = (from.col + to.col) / 2;
    const midPiece = state.board[midRow][midCol];
    if (!midPiece) {
      return { state, events: [], error: 'No piece to capture' };
    }
    if (midPiece.color === color) {
      return { state, events: [], error: 'Cannot capture your own piece' };
    }
  }

  // ── Apply the move ──────────────────────────────────────────────────────────

  const newBoard = cloneBoard(state.board);
  const events = [];
  const player = state.players.find((p) => p.userId === userId);

  // Move the piece.
  newBoard[to.row][to.col] = { ...piece };
  newBoard[from.row][from.col] = null;

  events.push({
    type: 'PIECE_MOVED',
    data: { username: player.username, from, to },
    timestamp: Date.now(),
  });

  let capturedAt = null;

  if (isCapture) {
    const midRow = (from.row + to.row) / 2;
    const midCol = (from.col + to.col) / 2;
    capturedAt = { row: midRow, col: midCol };
    newBoard[midRow][midCol] = null;

    events.push({
      type: 'PIECE_CAPTURED',
      data: { username: player.username, capturedAt, by: to },
      timestamp: Date.now(),
    });
  }

  // Check coronation — piece reached the back row.
  let crowned = false;
  if (!newBoard[to.row][to.col].king && to.row === coronationRow(piece.color)) {
    newBoard[to.row][to.col].king = true;
    crowned = true;
    events.push({
      type: 'PIECE_CROWNED',
      data: { username: player.username, position: to },
      timestamp: Date.now(),
    });
  }

  // Update piece counts on players.
  const newPlayers = state.players.map((p) => ({
    ...p,
    pieceCount: countPieces(newBoard, p.color),
  }));

  // Determine if the chain continues.
  let pendingChainPiece = null;
  let advanceTurn = true;

  if (isCapture && !crowned) {
    const furtherCaptures = getCapturesForPiece(newBoard, to.row, to.col);
    if (furtherCaptures.length > 0) {
      pendingChainPiece = { row: to.row, col: to.col };
      advanceTurn = false;
      events.push({
        type: 'CHAIN_CONTINUE',
        data: { piece: to },
        timestamp: Date.now(),
      });
    }
  }

  const lastMove = {
    from,
    to,
    isCapture,
    capturedAt,
    crowned,
    chainContinues: !advanceTurn,
  };

  let nextIdx = state.turnState.currentPlayerIndex;
  if (advanceTurn) {
    nextIdx = (state.turnState.currentPlayerIndex + 1) % state.players.length;
  }

  let newStatus = 'playing';
  let winner = null;

  // Build provisional state to check game-over.
  const provisionalState = {
    ...state,
    board: newBoard,
    players: newPlayers,
    turnState: { ...state.turnState, currentPlayerIndex: nextIdx },
    pendingChainPiece,
  };

  if (advanceTurn) {
    const winnerId = checkGameOver(provisionalState);
    if (winnerId) {
      newStatus = 'finished';
      winner = winnerId;
      const winnerPlayer = newPlayers.find((p) => p.userId === winnerId);
      events.push({
        type: 'GAME_OVER',
        data: { winner: winnerPlayer.username },
        timestamp: Date.now(),
      });
    }
  }

  const nextColor = newPlayers[nextIdx].color;
  const captureRequired =
    newStatus === 'playing' && advanceTurn
      ? getAvailableCaptures(newBoard, nextColor).length > 0
      : pendingChainPiece
        ? true
        : state.captureRequired;

  const logMsg = isCapture
    ? `${player.username} captured a piece${crowned ? ' and was crowned' : ''}${!advanceTurn ? ' — chain continues' : ''}`
    : `${player.username} moved${crowned ? ' and was crowned' : ''}`;

  const newState = {
    ...state,
    board: newBoard,
    status: newStatus,
    winner,
    players: newPlayers,
    turnState: { ...state.turnState, currentPlayerIndex: nextIdx },
    captureRequired,
    pendingChainPiece,
    lastMove,
    log: [...(state.log || []), { message: logMsg, type: newStatus === 'finished' ? 'game' : 'move', timestamp: Date.now() }],
  };

  return { state: newState, events };
}

function skipTurn(state, userId) {
  if (state.status !== 'playing') {
    return { state, events: [], error: 'Game is not in playing state' };
  }
  const cur = getCurrentPlayer(state);
  if (!cur || cur.userId !== userId) {
    return { state, events: [], error: "Not this player's turn" };
  }

  const events = [];

  // If mid-chain, abandon it.
  if (state.pendingChainPiece) {
    events.push({
      type: 'CHAIN_ABANDONED',
      data: { username: cur.username, piece: state.pendingChainPiece },
      timestamp: Date.now(),
    });
  }

  const nextIdx = (state.turnState.currentPlayerIndex + 1) % state.players.length;
  const nextColor = state.players[nextIdx].color;
  const captureRequired = getAvailableCaptures(state.board, nextColor).length > 0;

  const newState = {
    ...state,
    turnState: { ...state.turnState, currentPlayerIndex: nextIdx },
    pendingChainPiece: null,
    captureRequired,
    log: [
      ...(state.log || []),
      { message: `${cur.username}'s turn was skipped`, type: 'info', timestamp: Date.now() },
    ],
  };

  events.push({
    type: 'TURN_SKIPPED',
    data: { username: cur.username },
    timestamp: Date.now(),
  });

  return { state: newState, events };
}

// ── applyAction dispatcher ────────────────────────────────────────────────────

function applyAction(state, userId, action, payload = {}) {
  switch (action) {
    case 'move':
      return move(state, userId, payload);
    case 'skipTurn':
      return skipTurn(state, userId);
    default:
      return { state, events: [], error: `Unknown action: ${action}` };
  }
}

// ── migration ─────────────────────────────────────────────────────────────────

function migrate(state) {
  throw new Error(
    `[checkers] No migration path from stateVersion ${state.stateVersion} to ${STATE_VERSION}`,
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
  getStateForPlayer: defaultGetStateForPlayer,
  getActionDescriptors,
  migrate,
};

validateImplementation(module.exports);
