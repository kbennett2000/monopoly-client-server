'use strict';

const gl = require('../games/checkers/game-logic');

// ── fixtures ─────────────────────────────────────────────────────────────────

const CFG = {
  settings: {
    boardSize: 8,
    piecesPerPlayer: 12,
    playerColors: [
      { id: 'red', hex: '#e74c3c' },
      { id: 'black', hex: '#2c3e50' },
    ],
    playerTokens: ['🔴', '⚫'],
  },
};

const PLAYERS = [
  {
    userId: 'p1',
    username: 'Alice',
    color: 'red',
    colorHex: '#e74c3c',
    token: '🔴',
    pieceCount: 12,
    active: true,
    connected: true,
  },
  {
    userId: 'p2',
    username: 'Bob',
    color: 'black',
    colorHex: '#2c3e50',
    token: '⚫',
    pieceCount: 12,
    active: true,
    connected: true,
  },
];

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

function makeState(overrides = {}) {
  return {
    id: 'test-game',
    name: 'Test Game',
    gameType: 'checkers',
    stateVersion: 1,
    status: 'playing',
    config: CFG,
    players: PLAYERS.map((p) => ({ ...p })),
    board: emptyBoard(),
    turnState: { currentPlayerIndex: 0, phase: 'move' },
    winner: null,
    captureRequired: false,
    pendingChainPiece: null,
    lastMove: null,
    log: [],
    ...overrides,
  };
}

function startingState() {
  return gl.initGame('g1', 'Test', PLAYERS, CFG);
}

// Place a piece helper.
function place(board, row, col, color, king = false) {
  board[row][col] = { color, king };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Metadata & init
// ═══════════════════════════════════════════════════════════════════════════════

describe('Checkers — metadata', () => {
  const meta = gl.getGameMetadata();

  test('returns required fields with correct types', () => {
    expect(meta.name).toBe('Checkers');
    expect(typeof meta.description).toBe('string');
    expect(meta.minPlayers).toBe(2);
    expect(meta.maxPlayers).toBe(2);
    expect(typeof meta.icon).toBe('string');
    expect(typeof meta.estimatedDurationMinutes).toBe('number');
    expect(meta.complexity).toBe('light');
    expect(Array.isArray(meta.tags)).toBe(true);
  });

  test('tags include expected values', () => {
    expect(meta.tags).toContain('classic');
    expect(meta.tags).toContain('two-player');
    expect(meta.tags).toContain('perfect-information');
  });
});

describe('Checkers — initGame', () => {
  const state = startingState();

  test('sets gameType, status, and currentPlayerIndex', () => {
    expect(state.gameType).toBe('checkers');
    expect(state.status).toBe('playing');
    expect(state.turnState.currentPlayerIndex).toBe(0);
  });

  test('assigns red to first player and black to second', () => {
    expect(state.players[0].color).toBe('red');
    expect(state.players[1].color).toBe('black');
  });

  test('each side starts with 12 pieces on the correct squares', () => {
    let redCount = 0;
    let blackCount = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = state.board[r][c];
        if (cell) {
          expect((r + c) % 2).toBe(1); // dark square
          if (cell.color === 'red') redCount++;
          if (cell.color === 'black') blackCount++;
        }
      }
    }
    expect(redCount).toBe(12);
    expect(blackCount).toBe(12);
  });

  test('red pieces are in rows 5-7, black in rows 0-2', () => {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) {
        if (state.board[r][c]) expect(state.board[r][c].color).toBe('black');
      }
    }
    for (let r = 5; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (state.board[r][c]) expect(state.board[r][c].color).toBe('red');
      }
    }
  });

  test('middle rows are empty', () => {
    for (let r = 3; r < 5; r++) {
      for (let c = 0; c < 8; c++) {
        expect(state.board[r][c]).toBeNull();
      }
    }
  });
});

describe('Checkers — createInitialPlayer', () => {
  test('throws without config containing playerColors', () => {
    expect(() => gl.createInitialPlayer({ id: 'u', username: 'X' }, [], null)).toThrow(
      /playerColors/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Movement validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Checkers — movement validation', () => {
  test('regular red piece moves diagonally forward (toward row 0)', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    const { state: s, error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 4, col: 1 },
    });
    expect(error).toBeUndefined();
    expect(s.board[4][1]).toEqual({ color: 'red', king: false });
    expect(s.board[5][0]).toBeNull();
  });

  test('regular red piece cannot move backward', () => {
    const state = makeState();
    place(state.board, 4, 1, 'red');
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 4, col: 1 },
      to: { row: 5, col: 0 },
    });
    expect(error).toMatch(/forward/i);
  });

  test('regular piece cannot move to a non-diagonal square', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 4, col: 0 },
    });
    expect(error).toBeDefined();
  });

  test('cannot move to an occupied square', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'red');
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 4, col: 1 },
    });
    expect(error).toMatch(/occupied/i);
  });

  test('cannot move to a light square', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 4, col: 0 },
    });
    expect(error).toBeDefined();
  });

  test('king moves diagonally forward', () => {
    const state = makeState();
    place(state.board, 4, 3, 'red', true);
    const { state: s, error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 4, col: 3 },
      to: { row: 3, col: 4 },
    });
    expect(error).toBeUndefined();
    expect(s.board[3][4]).toEqual({ color: 'red', king: true });
  });

  test('king moves diagonally backward', () => {
    const state = makeState();
    place(state.board, 4, 3, 'red', true);
    const { state: s, error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 4, col: 3 },
      to: { row: 5, col: 4 },
    });
    expect(error).toBeUndefined();
    expect(s.board[5][4]).toEqual({ color: 'red', king: true });
  });

  test('king cannot move more than one square (no flying kings)', () => {
    const state = makeState();
    place(state.board, 4, 3, 'red', true);
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 4, col: 3 },
      to: { row: 2, col: 5 },
    });
    expect(error).toBeDefined();
  });

  test('moving when not your turn is rejected', () => {
    const state = makeState();
    place(state.board, 2, 1, 'black');
    const { error } = gl.applyAction(state, 'p2', 'move', {
      from: { row: 2, col: 1 },
      to: { row: 3, col: 0 },
    });
    expect(error).toMatch(/turn/i);
  });

  test("moving an opponent's piece is rejected", () => {
    const state = makeState();
    place(state.board, 2, 1, 'black');
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 2, col: 1 },
      to: { row: 3, col: 0 },
    });
    expect(error).toMatch(/belong/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Captures
// ═══════════════════════════════════════════════════════════════════════════════

describe('Checkers — captures', () => {
  test('single capture: jump over opponent to empty square', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    const {
      state: s,
      error,
      events,
    } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(error).toBeUndefined();
    expect(s.board[3][2].color).toBe('red');
    expect(s.board[4][1]).toBeNull();
    expect(s.board[5][0]).toBeNull();
    expect(events.some((e) => e.type === 'PIECE_CAPTURED')).toBe(true);
  });

  test('cannot capture your own piece', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'red');
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(error).toMatch(/own/i);
  });

  test('jump must land on empty square', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    place(state.board, 3, 2, 'black');
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(error).toMatch(/occupied/i);
  });

  test('regular piece can capture a king', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black', true);
    const { state: s, error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(error).toBeUndefined();
    expect(s.board[4][1]).toBeNull();
  });

  test('captures are mandatory: non-capture rejected when capture available', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    // Try to move a different piece instead of capturing.
    place(state.board, 5, 4, 'red');
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 4 },
      to: { row: 4, col: 5 },
    });
    expect(error).toMatch(/capture.*available/i);
  });

  test('multiple captures available: player may choose any', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    place(state.board, 5, 4, 'red');
    place(state.board, 4, 5, 'black');
    // Either capture is valid — take the second one.
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 4 },
      to: { row: 3, col: 6 },
    });
    expect(error).toBeUndefined();
  });

  test('after capture with no further captures, turn advances', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    const { state: s } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(s.turnState.currentPlayerIndex).toBe(1);
    expect(s.pendingChainPiece).toBeNull();
  });

  test('after capture with further capture available, chain continues', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    place(state.board, 2, 3, 'black');
    const { state: s } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(s.turnState.currentPlayerIndex).toBe(0); // still red's turn
    expect(s.pendingChainPiece).toEqual({ row: 3, col: 2 });
    expect(s.lastMove.chainContinues).toBe(true);
  });

  test('multi-jump chain: two captures in one turn', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    place(state.board, 2, 3, 'black');
    // First jump.
    const { state: s1 } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(s1.pendingChainPiece).toEqual({ row: 3, col: 2 });
    // Second jump.
    const { state: s2, error } = gl.applyAction(s1, 'p1', 'move', {
      from: { row: 3, col: 2 },
      to: { row: 1, col: 4 },
    });
    expect(error).toBeUndefined();
    expect(s2.pendingChainPiece).toBeNull();
    expect(s2.turnState.currentPlayerIndex).toBe(1);
    expect(s2.board[4][1]).toBeNull();
    expect(s2.board[2][3]).toBeNull();
    expect(s2.board[1][4].color).toBe('red');
  });

  test('chain abandonment via skipTurn resets state', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    place(state.board, 2, 3, 'black');
    const { state: s1 } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(s1.pendingChainPiece).not.toBeNull();
    const { state: s2, events } = gl.skipTurn(s1, 'p1');
    expect(s2.pendingChainPiece).toBeNull();
    expect(s2.turnState.currentPlayerIndex).toBe(1);
    expect(events.some((e) => e.type === 'CHAIN_ABANDONED')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Coronation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Checkers — coronation', () => {
  test('red piece reaching row 0 becomes king', () => {
    const state = makeState();
    place(state.board, 1, 0, 'red');
    const { state: s, events } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 1, col: 0 },
      to: { row: 0, col: 1 },
    });
    expect(s.board[0][1].king).toBe(true);
    expect(events.some((e) => e.type === 'PIECE_CROWNED')).toBe(true);
  });

  test('black piece reaching row 7 becomes king', () => {
    const state = makeState({ turnState: { currentPlayerIndex: 1, phase: 'move' } });
    place(state.board, 6, 1, 'black');
    const { state: s, events } = gl.applyAction(state, 'p2', 'move', {
      from: { row: 6, col: 1 },
      to: { row: 7, col: 0 },
    });
    expect(s.board[7][0].king).toBe(true);
    expect(events.some((e) => e.type === 'PIECE_CROWNED')).toBe(true);
  });

  test('capture into back row crowns piece and ENDS chain', () => {
    const state = makeState();
    place(state.board, 2, 1, 'red');
    place(state.board, 1, 2, 'black');
    // Another black piece positioned so that IF the chain continued, it would be capturable.
    // But coronation must end the chain.
    place(state.board, 0, 5, 'black');
    const { state: s, error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 2, col: 1 },
      to: { row: 0, col: 3 },
    });
    expect(error).toBeUndefined();
    expect(s.board[0][3].king).toBe(true);
    expect(s.pendingChainPiece).toBeNull();
    expect(s.turnState.currentPlayerIndex).toBe(1); // turn advanced
  });

  test('a king moving normally does not trigger another coronation event', () => {
    const state = makeState();
    place(state.board, 3, 2, 'red', true);
    const { events } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 3, col: 2 },
      to: { row: 2, col: 3 },
    });
    expect(events.some((e) => e.type === 'PIECE_CROWNED')).toBe(false);
  });

  test('PIECE_CROWNED event includes position data', () => {
    const state = makeState();
    place(state.board, 1, 0, 'red');
    const { events } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 1, col: 0 },
      to: { row: 0, col: 1 },
    });
    const crowned = events.find((e) => e.type === 'PIECE_CROWNED');
    expect(crowned.data.position).toEqual({ row: 0, col: 1 });
  });

  test('both players can crown pieces', () => {
    // Red crowns at row 0.
    const s1 = makeState();
    place(s1.board, 1, 0, 'red');
    const { state: rs } = gl.applyAction(s1, 'p1', 'move', {
      from: { row: 1, col: 0 },
      to: { row: 0, col: 1 },
    });
    expect(rs.board[0][1].king).toBe(true);

    // Black crowns at row 7.
    const s2 = makeState({ turnState: { currentPlayerIndex: 1, phase: 'move' } });
    place(s2.board, 6, 1, 'black');
    const { state: bs } = gl.applyAction(s2, 'p2', 'move', {
      from: { row: 6, col: 1 },
      to: { row: 7, col: 0 },
    });
    expect(bs.board[7][0].king).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Game over
// ═══════════════════════════════════════════════════════════════════════════════

describe('Checkers — game over', () => {
  test('player with zero pieces loses', () => {
    const state = makeState();
    // Red has one piece, black has one piece. Red captures black's last piece.
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    state.players[0].pieceCount = 1;
    state.players[1].pieceCount = 1;
    const { state: s, events } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(s.status).toBe('finished');
    expect(s.winner).toBe('p1');
    expect(events.some((e) => e.type === 'GAME_OVER')).toBe(true);
  });

  test('player with no legal moves on their turn loses (stalemate-as-loss)', () => {
    // Black's turn, but black has no legal moves.
    const state = makeState({ turnState: { currentPlayerIndex: 1, phase: 'move' } });
    // Black piece in corner, blocked by red pieces.
    place(state.board, 0, 1, 'black');
    place(state.board, 1, 0, 'red');
    place(state.board, 1, 2, 'red');
    state.players[0].pieceCount = 2;
    state.players[1].pieceCount = 1;
    // Set up so black is completely boxed in: blocked moves AND blocked jump landings.
    // Black at (0,1). Forward diags: (1,0) red, (1,2) red.
    // Capture over (1,0) lands at (2,-1) — off board.
    // Capture over (1,2) lands at (2,3) — must also be blocked.
    const redState = makeState();
    place(redState.board, 0, 1, 'black');
    place(redState.board, 1, 0, 'red');
    place(redState.board, 1, 2, 'red');
    place(redState.board, 2, 3, 'red'); // block capture landing
    place(redState.board, 6, 3, 'red');
    // Red moves a piece to pass the turn to black, which has no legal moves.
    const { state: s } = gl.applyAction(redState, 'p1', 'move', {
      from: { row: 6, col: 3 },
      to: { row: 5, col: 4 },
    });
    expect(s.status).toBe('finished');
    expect(s.winner).toBe('p1');
  });

  test('winner field is set correctly on game over', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    state.players[0].pieceCount = 1;
    state.players[1].pieceCount = 1;
    const { state: s } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(s.winner).toBe('p1');
  });

  test('GAME_OVER event includes winner info', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    state.players[0].pieceCount = 1;
    state.players[1].pieceCount = 1;
    const { events } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    const gameOver = events.find((e) => e.type === 'GAME_OVER');
    expect(gameOver.data.winner).toBe('Alice');
  });

  test('status transitions to finished', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    state.players[0].pieceCount = 1;
    state.players[1].pieceCount = 1;
    const { state: s } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(s.status).toBe('finished');
  });

  test('after game over, no further moves are accepted', () => {
    const state = makeState({ status: 'finished', winner: 'p1' });
    place(state.board, 5, 0, 'red');
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 4, col: 1 },
    });
    expect(error).toMatch(/not in playing/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Descriptor logic
// ═══════════════════════════════════════════════════════════════════════════════

describe('Checkers — action descriptors', () => {
  test('descriptors emitted for active player, empty for opponent', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    const active = gl.getActionDescriptors(state, 'p1');
    const inactive = gl.getActionDescriptors(state, 'p2');
    expect(active.length).toBeGreaterThan(0);
    expect(inactive).toEqual([]);
  });

  test('descriptors respect captureRequired — only captures when available', () => {
    const state = makeState({ captureRequired: true });
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    place(state.board, 5, 4, 'red');
    const descs = gl.getActionDescriptors(state, 'p1');
    for (const d of descs) {
      expect(d.data.isCapture).toBe(true);
    }
  });

  test('descriptors respect pendingChainPiece — only that piece captures', () => {
    const state = makeState({
      pendingChainPiece: { row: 3, col: 2 },
    });
    place(state.board, 3, 2, 'red');
    place(state.board, 2, 3, 'black');
    place(state.board, 5, 4, 'red');
    const descs = gl.getActionDescriptors(state, 'p1');
    for (const d of descs) {
      expect(d.data.from).toEqual({ row: 3, col: 2 });
      expect(d.data.isCapture).toBe(true);
    }
  });

  test('each descriptor carries from/to/isCapture/captures', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    const descs = gl.getActionDescriptors(state, 'p1');
    expect(descs.length).toBeGreaterThan(0);
    for (const d of descs) {
      expect(d.action).toBe('move');
      expect(d.data).toHaveProperty('from');
      expect(d.data).toHaveProperty('to');
      expect(d.data).toHaveProperty('isCapture');
      expect(d.data).toHaveProperty('captures');
    }
  });

  test('king descriptors include backward moves', () => {
    const state = makeState();
    place(state.board, 4, 3, 'red', true);
    const descs = gl.getActionDescriptors(state, 'p1');
    const backward = descs.filter((d) => d.data.to.row > 4);
    const forward = descs.filter((d) => d.data.to.row < 4);
    expect(backward.length).toBeGreaterThan(0);
    expect(forward.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('Checkers — edge cases', () => {
  test('piece in corner with no moves does not cause stalemate if other pieces can move', () => {
    const state = makeState();
    // Red piece in corner (0,1) — a king that might be blocked.
    place(state.board, 0, 1, 'red', true);
    place(state.board, 1, 0, 'black');
    place(state.board, 1, 2, 'black');
    // But another red piece has moves.
    place(state.board, 5, 4, 'red');
    const actions = gl.getValidActions(state, 'p1');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('piece blocked by friendly pieces — other pieces can still move', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'red');
    // 5,0 is blocked forward, but 4,1 can move.
    const actions = gl.getValidActions(state, 'p1');
    expect(actions.length).toBeGreaterThan(0);
    // The blocked piece at 5,0 has no valid moves, but 4,1 does.
    const movesFrom50 = actions.filter((a) => a.startsWith('move:5,0'));
    expect(movesFrom50).toHaveLength(0);
  });

  test('lastMove is populated correctly', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    const { state: s } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 4, col: 1 },
    });
    expect(s.lastMove).toEqual({
      from: { row: 5, col: 0 },
      to: { row: 4, col: 1 },
      isCapture: false,
      capturedAt: null,
      crowned: false,
      chainContinues: false,
    });
  });

  test('captureRequired is updated after each move', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 2, 1, 'black');
    // No captures available for red initially (red piece at 5,0, black at 2,1 — too far).
    expect(state.captureRequired).toBe(false);
    // Red moves forward.
    const { state: s1 } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 4, col: 1 },
    });
    // Now it's black's turn. Check captureRequired for black.
    // Black at (2,1), red at (4,1) — not adjacent diagonally for capture.
    // So captureRequired should be false.
    expect(s1.captureRequired).toBe(false);
  });

  test('moving different piece during pending chain is rejected', () => {
    const state = makeState({
      pendingChainPiece: { row: 3, col: 2 },
    });
    place(state.board, 3, 2, 'red');
    place(state.board, 2, 3, 'black');
    place(state.board, 5, 4, 'red');
    const { error } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 4 },
      to: { row: 4, col: 5 },
    });
    expect(error).toMatch(/same piece/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Turn timer & skip
// ═══════════════════════════════════════════════════════════════════════════════

describe('Checkers — turn mechanics', () => {
  test('isTurnTimerBlocked returns true during pending chain', () => {
    const state = makeState({ pendingChainPiece: { row: 3, col: 2 } });
    expect(gl.isTurnTimerBlocked(state)).toBe(true);
  });

  test('isTurnTimerBlocked returns false normally', () => {
    const state = makeState();
    expect(gl.isTurnTimerBlocked(state)).toBe(false);
  });

  test('skipTurn advances to next player', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    const { state: s, events } = gl.skipTurn(state, 'p1');
    expect(s.turnState.currentPlayerIndex).toBe(1);
    expect(events.some((e) => e.type === 'TURN_SKIPPED')).toBe(true);
  });

  test('skipTurn rejects non-current player', () => {
    const state = makeState();
    const { error } = gl.skipTurn(state, 'p2');
    expect(error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PIECE_MOVED event
// ═══════════════════════════════════════════════════════════════════════════════

describe('Checkers — events', () => {
  test('PIECE_MOVED emitted on regular move', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    const { events } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 4, col: 1 },
    });
    const moved = events.find((e) => e.type === 'PIECE_MOVED');
    expect(moved).toBeDefined();
    expect(moved.data.from).toEqual({ row: 5, col: 0 });
    expect(moved.data.to).toEqual({ row: 4, col: 1 });
  });

  test('CHAIN_CONTINUE emitted when chain is not finished', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    place(state.board, 4, 1, 'black');
    place(state.board, 2, 3, 'black');
    const { events } = gl.applyAction(state, 'p1', 'move', {
      from: { row: 5, col: 0 },
      to: { row: 3, col: 2 },
    });
    expect(events.some((e) => e.type === 'CHAIN_CONTINUE')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  getValidActions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Checkers — getValidActions', () => {
  test('returns empty for non-playing game', () => {
    const state = makeState({ status: 'finished' });
    expect(gl.getValidActions(state, 'p1')).toEqual([]);
  });

  test('returns empty for non-current player', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    expect(gl.getValidActions(state, 'p2')).toEqual([]);
  });

  test('returns move actions for current player', () => {
    const state = makeState();
    place(state.board, 5, 0, 'red');
    const actions = gl.getValidActions(state, 'p1');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]).toMatch(/^move:/);
  });

  test('early-game starting position has valid moves for red', () => {
    const state = startingState();
    const actions = gl.getValidActions(state, 'p1');
    expect(actions.length).toBe(7); // 4 pieces on row 5 can each move to 1-2 spots
  });
});
