'use strict';

/**
 * state-filter.js
 *
 * Single chokepoint for converting canonical server-side game state into the
 * per-recipient view sent over the wire. Both the socket pipeline
 * (socket-handler.js → emitToRoom / emitToSocket) and the REST routes
 * (game.routes.js → GET /api/games/:id, POST /api/games/:id/start) MUST go
 * through this helper. See docs/state-emission-audit.md for the rationale
 * — hidden-information games depend on this being the only path.
 */

/**
 * Return the player-specific view of game state.
 *
 * Routes through the game's getStateForPlayer if the registered game logic
 * implements one; falls back to returning the raw state otherwise. The
 * fallback is defensive — every game in the registry currently implements
 * getStateForPlayer (validated by validateImplementation at module load),
 * but a missing function shouldn't crash the framework.
 *
 * gameRegistry is passed in rather than required at the top of this module
 * so the helper stays free of any circular-import risk and remains testable
 * with a stub registry.
 *
 * @param {object} state - Canonical server-side game state
 * @param {string} userId - The recipient's userId
 * @param {object} gameRegistry - The game registry module
 * @returns {object} Filtered state safe to emit to the named user
 */
function filterStateForUser(state, userId, gameRegistry) {
  const logic = gameRegistry.getGameLogic(state.gameType);
  return typeof logic.getStateForPlayer === 'function'
    ? logic.getStateForPlayer(state, userId)
    : state;
}

module.exports = { filterStateForUser };
