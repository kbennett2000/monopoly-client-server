# CLAUDE.md — LAN Games

## Project structure

- `server/` — Node.js backend (Express + Socket.io + SQLite). All npm dependencies live here.
- `client/` — Vanilla HTML/CSS/JS frontend served as static files by Express.
- `server/games/<name>/` — Each game's server-side logic and config.
- `client/js/games/<name>/` — Each game's client-side renderer.
- `server/test/` — Unit tests (Jest, `npm test`).
- `server/test/integration/` — Integration tests (Jest, `npm run test:integration`).

## First thing every session

```bash
cd server && npm install
```

`node_modules/` is gitignored and does not persist between sessions. Without `npm install`:
- 8 of 17 test suites fail silently (they need `supertest`, `uuid`, and `jest-environment-jsdom`)
- ESLint and Prettier are unavailable
- The remaining 9 unit suites appear to pass, giving a false impression that the suite is healthy

## Verification commands

When claiming that tests, lint, or formatting pass, all four of these must run and succeed:

```bash
cd server
npm test                    # unit tests (11 suites, ~625 tests)
npm run test:integration    # integration tests (6 suites, ~40 tests)
npm run lint                # ESLint — must exit 0 with no errors
npm run format:check        # Prettier — must report "All matched files use Prettier code style!"
```

If any check fails, investigate and fix before claiming clean. Do not report partial results as full passes.

## Key conventions

- All game logic lives in `server/games/<name>/game-logic.js` and implements the interface in `server/src/game-logic-interface.js`.
- Client renderers implement init/update/destroy and self-register via `GameRendererRegistry.register()`.
- Tests import game-logic modules directly; unit tests never touch the network or database.
- Integration tests spin up a real Express + Socket.io server with an in-memory SQLite DB.
- Unused variables must be prefixed with `_` or removed — ESLint's `no-unused-vars` is set to `error`.
