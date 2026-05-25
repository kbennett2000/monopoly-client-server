'use strict';

const gl = require('../games/tic-tac-toe/game-logic');

// ── fixtures ──────────────────────────────────────────────────────────────────

const CFG = {
  settings: {
    boardSize: 3,
    winLength: 3,
    playerColors: [
      { id: 'x', hex: '#3a86ff' },
      { id: 'o', hex: '#e63946' },
    ],
    playerTokens: ['✕', '◯'],
  },
};

const PLAYERS = [
  {
    userId: 'p1',
    username: 'Alice',
    color: 'x',
    colorHex: '#3a86ff',
    token: '✕',
    active: true,
    isBankrupt: false,
    connected: true,
  },
  {
    userId: 'p2',
    username: 'Bob',
    color: 'o',
    colorHex: '#e63946',
    token: '◯',
    active: true,
    isBankrupt: false,
    connected: true,
  },
];

function emptyBoard() {
  return Array.from({ length: 3 }, () => Array(3).fill(null));
}

function makeState(overrides = {}) {
  return {
    id: 'test-game',
    name: 'Test Game',
    gameType: 'tic-tac-toe',
    stateVersion: 1,
    status: 'playing',
    config: CFG,
    players: PLAYERS.map((p) => ({ ...p })),
    board: emptyBoard(),
    turnState: { currentPlayerIndex: 0, phase: 'mark' },
    winner: null,
    log: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Tic-Tac-Toe — metadata', () => {
  test('getGameMetadata satisfies the validator (shipped game registers cleanly)', () => {
    expect(() => require('../games/tic-tac-toe/game-logic')).not.toThrow();
  });

  test('reports as 2-player, light, no-luck', () => {
    const m = gl.getGameMetadata();
    expect(m.minPlayers).toBe(2);
    expect(m.maxPlayers).toBe(2);
    expect(m.complexity).toBe('light');
    expect(m.tags).toContain('no-luck');
    expect(m.tags).toContain('two-player');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Tic-Tac-Toe — initGame', () => {
  test('produces a 3×3 empty board and starts on player 0', () => {
    const s = gl.initGame('g1', 'T', PLAYERS, CFG);
    expect(s.status).toBe('playing');
    expect(s.board).toHaveLength(3);
    for (const row of s.board) {
      expect(row).toHaveLength(3);
      for (const cell of row) expect(cell).toBeNull();
    }
    expect(s.turnState.currentPlayerIndex).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Tic-Tac-Toe — createInitialPlayer', () => {
  test('throws without a config containing playerColors/playerTokens', () => {
    expect(() => gl.createInitialPlayer({ id: 'x', username: 'X' }, [], null)).toThrow(
      /playerColors/,
    );
    expect(() => gl.createInitialPlayer({ id: 'x', username: 'X' }, [], { settings: {} })).toThrow(
      /playerColors/,
    );
  });

  test('assigns the next colour/token slot for each new player', () => {
    const a = gl.createInitialPlayer({ id: 'a', username: 'A' }, [], CFG);
    const b = gl.createInitialPlayer({ id: 'b', username: 'B' }, [a], CFG);
    expect(a.color).toBe('x');
    expect(b.color).toBe('o');
    expect(a.token).toBe('✕');
    expect(b.token).toBe('◯');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Tic-Tac-Toe — markCell basic mechanics', () => {
  test("marks an empty cell on the current player's turn", () => {
    const { state, error } = gl.applyAction(makeState(), 'p1', 'markCell', { row: 1, col: 1 });
    expect(error).toBeUndefined();
    expect(state.board[1][1]).toBe('p1');
    expect(state.turnState.currentPlayerIndex).toBe(1); // turn advances
  });

  test('rejects when it is not your turn', () => {
    const { error } = gl.applyAction(makeState(), 'p2', 'markCell', { row: 0, col: 0 });
    expect(error).toMatch(/not your turn/i);
  });

  test('rejects a cell that is already marked', () => {
    const s = makeState();
    s.board[1][1] = 'p2';
    const { error } = gl.applyAction(s, 'p1', 'markCell', { row: 1, col: 1 });
    expect(error).toMatch(/already marked/i);
  });

  test('rejects out-of-range coordinates', () => {
    expect(gl.applyAction(makeState(), 'p1', 'markCell', { row: 3, col: 0 }).error).toMatch(
      /invalid/i,
    );
    expect(gl.applyAction(makeState(), 'p1', 'markCell', { row: -1, col: 0 }).error).toMatch(
      /invalid/i,
    );
    expect(gl.applyAction(makeState(), 'p1', 'markCell', { row: 1.5, col: 0 }).error).toMatch(
      /invalid/i,
    );
  });

  test("emits CELL_MARKED with the player's token in the data", () => {
    const { events } = gl.applyAction(makeState(), 'p1', 'markCell', { row: 0, col: 0 });
    const ce = events.find((e) => e.type === 'CELL_MARKED');
    expect(ce).toBeDefined();
    expect(ce.data.token).toBe('✕');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Tic-Tac-Toe — win detection', () => {
  // Helper: play a scripted sequence of moves, alternating starting with p1.
  // Each move is [row, col].  Returns the final state.
  function play(moves) {
    let s = makeState();
    let turn = 0;
    for (const [r, c] of moves) {
      const userId = turn % 2 === 0 ? 'p1' : 'p2';
      const result = gl.applyAction(s, userId, 'markCell', { row: r, col: c });
      if (result.error) throw new Error(`move ${turn} (${r},${c}) by ${userId}: ${result.error}`);
      s = result.state;
      turn++;
    }
    return s;
  }

  test('horizontal win', () => {
    // p1: (0,0) (0,1) (0,2)  p2: (1,0) (1,1)
    const s = play([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 2],
    ]);
    expect(s.status).toBe('finished');
    expect(s.winner).toBe('p1');
  });

  test('vertical win', () => {
    // p1: (0,2) (1,2) (2,2)  p2: (0,0) (0,1)
    const s = play([
      [0, 2],
      [0, 0],
      [1, 2],
      [0, 1],
      [2, 2],
    ]);
    expect(s.status).toBe('finished');
    expect(s.winner).toBe('p1');
  });

  test('diagonal win (top-left to bottom-right)', () => {
    const s = play([
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 2],
      [2, 2],
    ]);
    expect(s.status).toBe('finished');
    expect(s.winner).toBe('p1');
  });

  test('anti-diagonal win (top-right to bottom-left)', () => {
    const s = play([
      [0, 2],
      [0, 0],
      [1, 1],
      [0, 1],
      [2, 0],
    ]);
    expect(s.status).toBe('finished');
    expect(s.winner).toBe('p1');
  });

  test("GAME_OVER event includes the winner's username", () => {
    let s = makeState();
    const moves = [
      ['p1', 0, 0],
      ['p2', 1, 0],
      ['p1', 0, 1],
      ['p2', 1, 1],
      ['p1', 0, 2],
    ];
    let lastEvents;
    for (const [uid, r, c] of moves) {
      const result = gl.applyAction(s, uid, 'markCell', { row: r, col: c });
      s = result.state;
      lastEvents = result.events;
    }
    const go = lastEvents.find((e) => e.type === 'GAME_OVER');
    expect(go).toBeDefined();
    expect(go.data.winner).toBe('Alice');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Tic-Tac-Toe — draw detection', () => {
  test('full board with no winner ends as a draw', () => {
    // Classic stalemate:
    //   X O X
    //   X O O
    //   O X X
    // Moves: p1 (0,0), p2 (0,1), p1 (0,2), p2 (1,1), p1 (1,0), p2 (1,2),
    //        p1 (2,1), p2 (2,0), p1 (2,2)
    let s = makeState();
    const moves = [
      ['p1', 0, 0],
      ['p2', 0, 1],
      ['p1', 0, 2],
      ['p2', 1, 1],
      ['p1', 1, 0],
      ['p2', 1, 2],
      ['p1', 2, 1],
      ['p2', 2, 0],
      ['p1', 2, 2],
    ];
    let last;
    for (const [uid, r, c] of moves) {
      const result = gl.applyAction(s, uid, 'markCell', { row: r, col: c });
      if (result.error) throw new Error(result.error);
      s = result.state;
      last = result.events;
    }
    expect(s.status).toBe('finished');
    expect(s.winner).toBeNull();
    const go = last.find((e) => e.type === 'GAME_OVER');
    expect(go.data.winner).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Tic-Tac-Toe — getValidActions', () => {
  test('returns all 9 cells for the starting player on an empty board', () => {
    const a = gl.getValidActions(makeState(), 'p1');
    expect(a).toHaveLength(9);
    expect(a).toContain('markCell:0,0');
    expect(a).toContain('markCell:2,2');
  });

  test('returns nothing for the non-current player', () => {
    expect(gl.getValidActions(makeState(), 'p2')).toEqual([]);
  });

  test('omits cells that are already marked', () => {
    const s = makeState();
    s.board[1][1] = 'p2';
    const a = gl.getValidActions(s, 'p1');
    expect(a).toHaveLength(8);
    expect(a).not.toContain('markCell:1,1');
  });

  test('returns nothing when the game is finished', () => {
    const s = makeState({ status: 'finished', winner: 'p1' });
    expect(gl.getValidActions(s, 'p1')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Tic-Tac-Toe — skipTurn (AFK)', () => {
  test('advances to the next player and emits TURN_SKIPPED', () => {
    const { state, events } = gl.skipTurn(makeState(), 'p1');
    expect(state.turnState.currentPlayerIndex).toBe(1);
    expect(events.map((e) => e.type)).toContain('TURN_SKIPPED');
  });

  test('isTurnTimerBlocked is always false', () => {
    expect(gl.isTurnTimerBlocked(makeState())).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Tic-Tac-Toe — migrate', () => {
  test('throws on any version mismatch (no migrations defined yet)', () => {
    expect(() => gl.migrate({ stateVersion: 0 })).toThrow(/No migration path/);
  });
});
