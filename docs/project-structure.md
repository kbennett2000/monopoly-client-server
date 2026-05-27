# Project Structure

> Annotated directory tree for the LAN Games repository. For a
> higher-level view of how the components interact, see
> [Architecture](architecture.md). Back to [README](../README.md).

```
lan-games/
├── README.md
├── docs/                         ← design notes & active proposals
│   ├── action-descriptors.md     ← optional rich-action interface (5 of 8 games adopted)
│   ├── renderer-contract.md      ← renderer / framework DOM contract; open questions
│   └── state-emission-audit.md   ← security audit of every state-bearing emit path
│
├── server/
│   ├── package.json
│   ├── scripts/
│   │   └── reset-db.js           ← wipe the database (--hard to also delete the file)
│   ├── data/                     ← created at runtime; holds lan-games.db (gitignored)
│   │
│   ├── games/                    ← one subdirectory per game type
│   │   ├── monopoly/
│   │   │   ├── game-logic.js     ← all Monopoly rules (pure functions)
│   │   │   ├── config-loader.js  ← loads & validates the three Monopoly config files
│   │   │   └── config/
│   │   │       ├── board.json    ← 40 board squares (names, prices, rents)
│   │   │       ├── cards.json    ← Chance & Community Chest decks
│   │   │       └── settings.json ← game rules (starting money, jail fine, …)
│   │   ├── connect-four/
│   │   │   ├── game-logic.js     ← Connect Four rules (pure functions)
│   │   │   └── config/
│   │   │       └── settings.json ← board dimensions, win length, colours
│   │   ├── risk/
│   │   │   ├── game-logic.js     ← Risk rules (pure functions)
│   │   │   └── config/
│   │   │       ├── board.json    ← 42 territories across 6 continents + adjacencies
│   │   │       ├── cards.json    ← 44-card deck (42 territory + 2 wild)
│   │   │       └── settings.json ← reinforcement formula, dice caps, card bonuses
│   │   ├── tic-tac-toe/
│   │   │   ├── game-logic.js     ← Tic-Tac-Toe rules (pure functions)
│   │   │   └── config/
│   │   │       └── settings.json ← board size, win length, colours, tokens
│   │   ├── yahtzee/
│   │   │   ├── game-logic.js     ← Yahtzee rules + scoring (pure functions)
│   │   │   └── config/
│   │   │       └── settings.json ← dice count, rolls per turn, category bonuses
│   │   ├── battleship/
│   │   │   ├── game-logic.js     ← Battleship rules + hidden-info filter (pure functions)
│   │   │   └── config/
│   │   │       └── settings.json ← grid size, ship list, first-player selection
│   │   ├── checkers/
│   │   │   ├── game-logic.js     ← Checkers rules (pure functions)
│   │   │   └── config/
│   │   │       └── settings.json ← board size, pieces per player, colours
│   │   └── life/
│   │       ├── game-logic.js     ← Life rules + scoring + hidden-info filter
│   │       ├── config-loader.js  ← loads & validates the six Life config files
│   │       └── config/
│   │           ├── board.json    ← 64 squares with effect types + next[] adjacency
│   │           ├── careers.json  ← 12 careers (6 degree-required, 6 not)
│   │           ├── salaries.json ← 6 salary tiers with tax-by-salary amounts
│   │           ├── houses.json   ← 5 houses (cost / scoring value pairs)
│   │           ├── lifeTiles.json← 20 achievement tiles drawn at CA retirement
│   │           └── settings.json ← starting cash, loan, gift / insurance / stock costs
│   │
│   └── src/                      ← game-agnostic framework
│       ├── index.js              ← entry point; HTTP + Socket.io server
│       ├── database.js           ← SQLite schema + query helpers (better-sqlite3)
│       ├── auth.js               ← bcrypt password hashing + JWT middleware
│       ├── game-logic-interface.js ← interface contract + validateImplementation()
│       ├── game-registry.js      ← maps game-type keys → logic modules
│       ├── game-manager.js       ← in-memory sessions + SQLite persistence
│       ├── state-filter.js       ← shared getStateForPlayer wrapper used by socket + REST
│       ├── socket-handler.js     ← Socket.io event routing
│       └── routes/
│           ├── auth.routes.js    ← /api/auth/*
│           └── game.routes.js    ← /api/games/*
│
└── client/
    ├── index.html                ← single-page application shell
    ├── css/
    │   └── main.css              ← all styles (dark green theme)
    └── js/
        ├── api.js                ← fetch() wrapper for REST calls
        ├── game-state.js         ← client-side state singleton
        ├── ui-manager.js         ← all DOM updates outside the board area
        ├── socket-client.js      ← Socket.io connection + event dispatch
        ├── sound-manager.js      ← audio cues
        ├── app.js                ← wires modules + DOM event listeners
        └── games/
            ├── renderer-interface.js  ← GameRenderer contract + runtime validator
            ├── renderer-registry.js   ← gameType → renderer lookup
            ├── monopoly/
            │   ├── board-grid.js      ← CSS Grid board builder
            │   └── renderer.js
            ├── connect-four/renderer.js
            ├── risk/renderer.js
            ├── tic-tac-toe/renderer.js
            ├── yahtzee/
            │   ├── renderer.js        ← lifecycle + dice tray + roll controls
            │   └── score-sheet.js     ← shared score-sheet table builder + painter
            ├── battleship/
            │   ├── grid.js            ← shared 10×10 grid primitive
            │   ├── setup-phase.js     ← drag-and-drop ship placement
            │   ├── firing-phase.js    ← two-grid shooting + sunk-ship cache
            │   └── renderer.js        ← lifecycle + phase routing
            ├── checkers/renderer.js
            └── life/
                ├── renderer.js        ← lifecycle + phase routing + sidebar title
                ├── board-view.js      ← 64-square board + player cars + movement queue
                ├── action-panel.js    ← phase-dependent actions + CSS-animated spinner
                └── card-display.js    ← inventory panel + game-over tile reveal animation
```
