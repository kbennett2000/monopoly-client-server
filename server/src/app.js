/**
 * app.js
 *
 * Builds and returns the Express + Socket.io server without starting it.
 * index.js calls createServer() and then calls httpServer.listen().
 * Integration tests call createServer() directly and bind to port 0 so the OS
 * picks a free ephemeral port.
 *
 * No process.exit() calls live here — startup pre-flight checks belong in
 * index.js only so that test code can require this module safely.
 */

'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server: SocketIO } = require('socket.io');

const authRoutes = require('./routes/auth.routes');
const gameRoutes = require('./routes/game.routes');
const helpRoutes = require('./routes/help.routes');
const socketHandler = require('./socket-handler');
const gameRegistry = require('./game-registry');

/**
 * Build the Express app and Socket.io server.
 * @returns {{ app, httpServer, io }}
 */
function createServer() {
  const app = express();

  // No endpoint legitimately receives more than a few kilobytes; cap the parse
  // budget to reject oversized bodies before they hit a route.
  app.use(express.json({ limit: '100kb' }));
  app.use(cors({ origin: '*', credentials: true }));

  app.use('/api/auth', authRoutes);
  // Help routes are mounted before gameRoutes so /types/:type/help matches
  // before falling through to the broader /api/games router.
  app.use('/api/games/types', helpRoutes);
  app.use('/api/games', gameRoutes);

  app.get('/api/config', (req, res) => {
    try {
      res.json({ config: gameRegistry.getGameLogic('monopoly').getConfigCopy() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // /api/* falls through to a JSON 404 (must come AFTER the routers above so
  // matched routes win).  Without this, the SPA catch-all below would happily
  // return index.html for typos like /api/gmaes and mask client bugs.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Serve static client files (no-op if the client directory doesn't exist,
  // which is the case during integration tests running from server/).
  const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
  app.use(express.static(CLIENT_DIR));

  // SPA catch-all: every non-/api route returns the SPA shell so the client
  // can handle deep links.  Express 4's wildcard syntax is `*`; the /api guard
  // above ensures API typos don't reach this handler.
  app.get('*', (_req, res) => {
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });

  const httpServer = http.createServer(app);

  const io = new SocketIO(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60_000,
    pingInterval: 25_000,
    // Chat is capped at 300 chars and game-action payloads are tiny; reject
    // anything larger before parsing to cap the DoS surface.
    maxHttpBufferSize: 32_768,
  });

  socketHandler.registerHandlers(io);

  return { app, httpServer, io };
}

module.exports = { createServer };
