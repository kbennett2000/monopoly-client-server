# Screenshot & Banner Generation

The README's game gallery and hero image are generated from hand-authored fixture states via headless Chromium. To regenerate:

```bash
cd server
npm run screenshots
```

This starts an in-memory server, loads each game from its fixture state, opens it in a headless browser, and captures a PNG to `docs/screenshots/`.

## Banner

The README banner (`docs/banner.png`) is a designed wordmark — not a gameplay screenshot. It is rendered from an inline HTML/SVG template styled with the app's brand palette (see `client/css/main.css`) via the same headless Chromium dependency:

```bash
cd server
npm run banner
```

The script (`server/scripts/generate-banner.js`) renders at a 2× device scale for a crisp ~2560×800 PNG. To restyle the banner, edit the `COLORS` map and `bannerHtml()` template in that file and re-run the command — no server or fixtures are needed.

## Prerequisites

Playwright and its Chromium browser must be installed:

```bash
cd server
npm install          # installs playwright as a devDependency
npx playwright install chromium
```

## How it works

1. The script generates (or reads cached) fixture states for each game using the game-logic modules directly. Fixtures are saved to `server/test/fixtures/screenshots/<game-type>.json`.
2. An in-memory SQLite server starts on an ephemeral port.
3. For each game, a Playwright browser context authenticates as the active player, navigates to the lobby, rejoins the game, waits for the renderer to paint, then captures a screenshot.
4. CSS animations are paused before capture for deterministic output.

## When to regenerate

- After a game's visual treatment changes substantially.
- After adding a new game (also add a fixture builder — see below).
- After refactoring the player panel, action panel, or board-wrapper CSS.

## Adding a screenshot for a new game

1. Add a fixture builder function in `server/scripts/capture-screenshots.js` (see the existing `buildTicTacToe`, `buildMonopoly`, etc. as examples).
2. Register the game in the `BUILDERS` and `GAMES` objects in the same file.
3. Run `npm run screenshots`.
4. The new PNG will appear in `docs/screenshots/`. Update the README gallery table to reference it.

## Updating an existing fixture

Delete the cached fixture to force regeneration:

```bash
rm server/test/fixtures/screenshots/<game-type>.json
npm run screenshots
```

Or edit the JSON fixture directly — the script reads it as-is if it exists.

## Output

| File | Resolution | Description |
|------|-----------|-------------|
| `docs/screenshots/hero.png` | 1600 x 900 | Hero image (The Game of Life) |
| `docs/screenshots/<game>.png` | 1280 x 800 | Gallery thumbnail per game |

Total image size is under 1 MB for all nine PNGs.
