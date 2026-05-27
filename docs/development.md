# Development

> Developer guide for working on LAN Games: environment variables,
> scripts, testing, hot-reload, and the new-game checklist. For
> high-level architecture, see [Architecture](architecture.md). For the
> game-implementation contract, see [Adding a New Game](adding-a-game.md).
> Back to [README](../README.md).

## Environment variables

All of these can live in `.env` at the repo root.  The `npm run dev` and `npm start` scripts at the root source `.env` automatically; `docker compose` reads it through `env_file`.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | TCP port the server listens on (Docker host port maps to the same value) |
| `HOST` | `0.0.0.0` | Bind address; set to `127.0.0.1` to refuse LAN connections |
| `JWT_SECRET` | *(server refuses to start without one)* | JWT signing secret |
| `JWT_EXPIRES` | `7d` | JWT token lifetime |
| `NODE_ENV` | *(unset)* | Set to `development` to suppress the "bound to all interfaces" startup warning |

## Changing the port

Add a line to `.env`:

```bash
PORT=5050
```

Then restart with `npm run dev` (or `docker compose up`).  Everything follows automatically:

- The server binds to the new port and prints the right URLs at startup
- The client uses relative URLs, so opening `http://<host>:5050` Just Works — Socket.io and `/api/*` traffic inherit the same origin
- Docker maps the host port to the same value, so `http://localhost:5050` works in either dev or containerised mode

No code changes, no rebuild.

## Scripts

```bash
npm start              # run the server
npm run dev            # run with nodemon (auto-restart on file changes)
npm test               # run Jest test suite (server/test/)
npm run test:integration  # integration tests (Express + Socket.io round-trips)
npm run lint           # ESLint
npm run format:check   # Prettier (verify)
npm run format:write   # Prettier (auto-fix)
npm run reset-db       # drop all tables and recreate schema
npm run reset-db:hard  # delete the .db file entirely and recreate it
npm run screenshots    # regenerate README screenshots (requires Playwright)
```

## Tests

```bash
cd server
npm install                 # required — devDependencies (jest, supertest, etc.) must be present
npm test                    # unit tests for every bundled game's game-logic
npm run test:integration    # socket + persistence round-trip tests
```

Tests live in `server/test/` (unit) and `server/test/integration/` (integration). At the time of this README pass: **625 unit tests across the eight bundled games** plus the framework interface, and **40 integration tests** covering socket emission, REST state filtering, action-descriptor wiring, spectator mode, and game-lifecycle round-trips.

> **Note:** `node_modules/` is gitignored. If you skip `npm install`, the unit suite still partially runs (tests that only use relative imports), but suites requiring `supertest`, `uuid`, or `jest-environment-jsdom` will fail to load silently. Always install dependencies before running tests.

The unit suite imports game-logic modules directly and never touches the network, database, or socket layer — making it fast and reliable. The integration suite spins up a real server, a real SQLite database, and real socket clients to verify full round-trips end-to-end.

## Hot-reloading config

After editing a JSON config file:

```bash
curl -X POST http://localhost:3000/api/games/types/monopoly/config/reload \
     -H "Authorization: Bearer <token>"
```

Only games created *after* the reload will use the new config. In-progress games carry their own embedded snapshot.

## Adding a game — quick checklist

- [ ] `server/games/<name>/game-logic.js` — implements all required interface methods; calls `validateImplementation` at the bottom
- [ ] `server/games/<name>/config/settings.json` — minimum viable config
- [ ] `server/src/game-registry.js` — one new line in the `registry` object
- [ ] (optional) `client/js/games/<name>/renderer.js` — visual renderer; self-registers via `GameRendererRegistry.register('<name>', …)` at the bottom of the file
- [ ] (optional) One `<script>` tag in `client/index.html` to load the renderer
- [ ] (recommended) Implement `getActionDescriptors` if the renderer needs dynamic labels / enabled-state logic; see [`action-descriptors.md`](action-descriptors.md)
