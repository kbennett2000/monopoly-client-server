'use strict';

const {
  validateImplementation,
  defaultGetStateForPlayer,
} = require('../src/game-logic-interface');

// Build a minimal implementation that satisfies every required method.
// Tests override one field at a time to exercise the validator.
function makeImpl(overrides = {}) {
  const base = {
    STATE_VERSION:        1,
    initGame:             () => ({}),
    createInitialPlayer:  () => ({}),
    applyAction:          () => ({ state: {}, events: [] }),
    skipTurn:             () => ({ state: {}, events: [] }),
    getCurrentPlayer:     () => null,
    isTurnTimerBlocked:   () => false,
    getValidActions:      () => [],
    getGameMetadata:      () => ({
      name:                     'Test Game',
      minPlayers:               2,
      maxPlayers:               4,
      description:              'For testing.',
      estimatedDurationMinutes: 10,
      complexity:               'light',
      tags:                     ['test'],
    }),
    loadConfig:           () => ({}),
    getConfigCopy:        () => ({}),
    getStateForPlayer:    defaultGetStateForPlayer,
  };
  // Allow overrides to replace either the whole field or, for getGameMetadata,
  // the returned object.
  if (overrides.getGameMetadata) {
    return { ...base, getGameMetadata: overrides.getGameMetadata };
  }
  return { ...base, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('validateImplementation — required methods', () => {
  test('passes for a fully-formed implementation', () => {
    expect(() => validateImplementation(makeImpl())).not.toThrow();
  });

  test('throws when a required method is missing', () => {
    const impl = makeImpl();
    delete impl.applyAction;
    expect(() => validateImplementation(impl)).toThrow(/applyAction/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('validateImplementation — getGameMetadata fields', () => {
  function withMeta(meta) {
    return makeImpl({ getGameMetadata: () => meta });
  }
  const ok = {
    name: 'X', minPlayers: 2, maxPlayers: 4, description: 'd',
    estimatedDurationMinutes: 10, complexity: 'light', tags: ['t'],
  };

  test('rejects non-object metadata', () => {
    expect(() => validateImplementation(withMeta(null))).toThrow(/object/);
    expect(() => validateImplementation(withMeta('hi'))).toThrow(/object/);
  });

  test('rejects missing or non-positive estimatedDurationMinutes', () => {
    expect(() => validateImplementation(withMeta({ ...ok, estimatedDurationMinutes: undefined })))
      .toThrow(/estimatedDurationMinutes/);
    expect(() => validateImplementation(withMeta({ ...ok, estimatedDurationMinutes: 0 })))
      .toThrow(/estimatedDurationMinutes/);
    expect(() => validateImplementation(withMeta({ ...ok, estimatedDurationMinutes: -5 })))
      .toThrow(/estimatedDurationMinutes/);
    expect(() => validateImplementation(withMeta({ ...ok, estimatedDurationMinutes: NaN })))
      .toThrow(/estimatedDurationMinutes/);
    expect(() => validateImplementation(withMeta({ ...ok, estimatedDurationMinutes: '10' })))
      .toThrow(/estimatedDurationMinutes/);
  });

  test('rejects invalid complexity values', () => {
    expect(() => validateImplementation(withMeta({ ...ok, complexity: undefined })))
      .toThrow(/complexity/);
    expect(() => validateImplementation(withMeta({ ...ok, complexity: 'extreme' })))
      .toThrow(/complexity/);
    expect(() => validateImplementation(withMeta({ ...ok, complexity: 'LIGHT' })))
      .toThrow(/complexity/);
  });

  test('accepts all three valid complexity values', () => {
    for (const c of ['light', 'medium', 'heavy']) {
      expect(() => validateImplementation(withMeta({ ...ok, complexity: c }))).not.toThrow();
    }
  });

  test('rejects non-array tags', () => {
    expect(() => validateImplementation(withMeta({ ...ok, tags: 'one,two' }))).toThrow(/tags/);
    expect(() => validateImplementation(withMeta({ ...ok, tags: null }))).toThrow(/tags/);
    expect(() => validateImplementation(withMeta({ ...ok, tags: undefined }))).toThrow(/tags/);
  });

  test('rejects tags containing non-strings or empty strings', () => {
    expect(() => validateImplementation(withMeta({ ...ok, tags: ['ok', '', 'also'] })))
      .toThrow(/tags/);
    expect(() => validateImplementation(withMeta({ ...ok, tags: ['ok', 42] })))
      .toThrow(/tags/);
    expect(() => validateImplementation(withMeta({ ...ok, tags: ['ok', null] })))
      .toThrow(/tags/);
  });

  test('accepts an empty tags array', () => {
    // Zero tags is permissible — a game that genuinely fits no useful category.
    expect(() => validateImplementation(withMeta({ ...ok, tags: [] }))).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('shipped games satisfy validateImplementation', () => {
  // Loading each module is itself a validation: monopoly's index-time call
  // (via game-registry) and connect-four/risk's bottom-of-file calls will
  // throw at require() time if their metadata is malformed.
  test('monopoly', () => {
    expect(() => require('../games/monopoly/game-logic')).not.toThrow();
  });
  test('connect-four', () => {
    expect(() => require('../games/connect-four/game-logic')).not.toThrow();
  });
  test('risk', () => {
    expect(() => require('../games/risk/game-logic')).not.toThrow();
  });
});
