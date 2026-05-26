/**
 * help.routes.js
 *
 *   GET /api/games/types/:type/help
 *
 * Returns the per-game-type rules document as raw markdown.  Content lives at
 * server/games/<type>/help.md and is authored by hand.  Responses are cached
 * in memory after the first read so repeated opens don't touch the disk.
 *
 * Mounted at /api/games/types so the route pattern is just ':type/help'.
 * Auth is required, matching the other /api/games/types/:type/* endpoints.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const auth = require('../auth');
const gameRegistry = require('../game-registry');

const router = express.Router();
router.use(auth.requireAuth);

// type → markdown string.  Populated on first hit per type.
const cache = new Map();

function helpFilePath(type) {
  return path.join(__dirname, '..', '..', 'games', type, 'help.md');
}

router.get('/:type/help', (req, res) => {
  const { type } = req.params;

  // Reject unknown game types up front so a missing config can't be probed
  // through the help endpoint.
  try {
    gameRegistry.getGameLogic(type);
  } catch {
    return res.status(404).json({ error: `Unknown game type: "${type}"` });
  }

  if (cache.has(type)) {
    return res.json({ gameType: type, content: cache.get(type) });
  }

  let content;
  try {
    content = fs.readFileSync(helpFilePath(type), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: `No help content for "${type}"` });
    }
    console.error('[help] read error:', err);
    return res.status(500).json({ error: 'Could not load help content' });
  }

  cache.set(type, content);
  res.json({ gameType: type, content });
});

module.exports = router;
