/**
 * capture-screenshots.js
 *
 * Generates fixture game states and captures PNG screenshots for the README.
 *
 * Usage:
 *   cd server
 *   npm run screenshots
 *
 * The script:
 *   1. Generates (or reads cached) fixture states for each game
 *   2. Starts an in-memory server
 *   3. Captures one screenshot per game + a hero image via headless Chromium
 *   4. Writes PNGs to docs/screenshots/
 */

'use strict';

// ── environment (must be set before any require) ────────────────────────────
process.env.JWT_SECRET = 'screenshot-dev-secret';
process.env.TEST_DB_PATH = ':memory:';
process.env.NODE_ENV = 'development';

// ── imports ─────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const database = require('../src/database');
const auth = require('../src/auth');
const bcrypt = require('bcrypt');
const { createServer } = require('../src/app');
const gameRegistry = require('../src/game-registry');

// ── paths ───────────────────────────────────────────────────────────────────
const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'screenshots');
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'docs', 'screenshots');

// ── game definitions ────────────────────────────────────────────────────────
const GAMES = [
  { type: 'tic-tac-toe', viewPlayer: 0 },
  { type: 'connect-four', viewPlayer: 0 },
  { type: 'checkers', viewPlayer: 0 },
  { type: 'yahtzee', viewPlayer: 0 },
  { type: 'battleship', viewPlayer: 0 },
  { type: 'monopoly', viewPlayer: 0 },
  { type: 'risk', viewPlayer: 0 },
  { type: 'life', viewPlayer: 0, isHero: true },
];

// ── helpers ─────────────────────────────────────────────────────────────────

const GLOBAL_NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank'];

function makePlayers(count, gameType) {
  const logic = gameRegistry.getGameLogic(gameType);
  const config = logic.loadConfig();
  const players = [];
  for (let i = 0; i < count; i++) {
    const user = { id: `player-${i + 1}`, username: GLOBAL_NAMES[i] };
    players.push(logic.createInitialPlayer(user, players, config));
  }
  return { players, config };
}

function play(logic, state, userId, action, payload) {
  const result = logic.applyAction(state, userId, action, payload);
  if (result.error) throw new Error(`${action} failed: ${result.error}`);
  return result.state;
}

function currentUserId(state) {
  return state.players[state.turnState.currentPlayerIndex].userId;
}

// ── fixture builders ────────────────────────────────────────────────────────

function buildTicTacToe() {
  const logic = gameRegistry.getGameLogic('tic-tac-toe');
  const { players, config } = makePlayers(2, 'tic-tac-toe');
  let s = logic.initGame('screenshot-tic-tac-toe', 'Tic-Tac-Toe', players, config);

  // X=Alice, O=Bob.  After 6 moves X has diagonal threat at (2,2).
  const moves = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [2, 0],
  ];
  for (const [row, col] of moves) {
    s = play(logic, s, currentUserId(s), 'markCell', { row, col });
  }
  return s;
}

function buildConnectFour() {
  const logic = gameRegistry.getGameLogic('connect-four');
  const { players, config } = makePlayers(2, 'connect-four');
  let s = logic.initGame('screenshot-connect-four', 'Connect Four', players, config);

  // 14 drops — Red ends with 3-in-a-row at (5,3-5) threatening (5,6).
  const cols = [3, 2, 4, 3, 2, 4, 1, 3, 5, 2, 0, 5, 4, 1];
  for (const col of cols) {
    s = play(logic, s, currentUserId(s), 'dropPiece', { column: col });
  }
  return s;
}

function buildCheckers() {
  const logic = gameRegistry.getGameLogic('checkers');
  const { players, config } = makePlayers(2, 'checkers');
  let s = logic.initGame('screenshot-checkers', 'Checkers', players, config);

  // Play moves using action descriptors for guaranteed validity.
  // Use a seeded PRNG for reproducibility.
  let seed = 42;
  function nextRand() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  for (let i = 0; i < 40 && !s.winner; i++) {
    const uid = currentUserId(s);
    const descriptors = logic.getActionDescriptors ? logic.getActionDescriptors(s, uid) : [];
    const moveDescs = descriptors.filter((d) => d.action === 'move' && d.enabled);
    if (moveDescs.length === 0) break;
    const pick = moveDescs[Math.floor(nextRand() * moveDescs.length)];
    try {
      s = play(logic, s, uid, pick.action, pick.payload);
    } catch {
      break;
    }
  }
  return s;
}

function buildYahtzee() {
  const logic = gameRegistry.getGameLogic('yahtzee');
  const { players, config } = makePlayers(3, 'yahtzee');
  let s = logic.initGame('screenshot-yahtzee', 'Yahtzee', players, config);

  // Play several complete rounds then leave player mid-turn with dice showing.
  for (let round = 0; round < 3; round++) {
    for (let p = 0; p < 3; p++) {
      const uid = currentUserId(s);
      // Roll
      s = play(logic, s, uid, 'rollDice', {});
      // Pick a category that's still open
      const sheet = s.players[s.turnState.currentPlayerIndex].scoreSheet;
      const cats = [
        'ones',
        'twos',
        'threes',
        'fours',
        'fives',
        'sixes',
        'threeOfAKind',
        'fourOfAKind',
        'fullHouse',
        'smallStraight',
        'largeStraight',
        'yahtzee',
        'chance',
      ];
      const open = cats.find((c) => sheet[c] === null);
      if (!open) break;
      s = play(logic, s, uid, 'scoreCategory', { category: open });
    }
  }

  // Current player: roll once so dice are showing
  const uid = currentUserId(s);
  s = play(logic, s, uid, 'rollDice', {});

  return s;
}

function buildBattleship() {
  const logic = gameRegistry.getGameLogic('battleship');
  const { players, config } = makePlayers(2, 'battleship');
  let s = logic.initGame('screenshot-battleship', 'Battleship', players, config);

  const p1 = players[0].userId;
  const p2 = players[1].userId;

  // Place ships for Player 1
  const p1Ships = [
    { shipId: 'carrier', origin: { x: 0, y: 0 }, orientation: 'horizontal' },
    { shipId: 'battleship', origin: { x: 0, y: 2 }, orientation: 'horizontal' },
    { shipId: 'cruiser', origin: { x: 0, y: 4 }, orientation: 'horizontal' },
    { shipId: 'submarine', origin: { x: 4, y: 4 }, orientation: 'vertical' },
    { shipId: 'destroyer', origin: { x: 7, y: 8 }, orientation: 'vertical' },
  ];
  for (const ship of p1Ships) {
    s = play(logic, s, p1, 'placeShip', ship);
  }

  // Place ships for Player 2
  const p2Ships = [
    { shipId: 'carrier', origin: { x: 5, y: 0 }, orientation: 'vertical' },
    { shipId: 'battleship', origin: { x: 0, y: 3 }, orientation: 'horizontal' },
    { shipId: 'cruiser', origin: { x: 6, y: 6 }, orientation: 'vertical' },
    { shipId: 'submarine', origin: { x: 0, y: 9 }, orientation: 'horizontal' },
    { shipId: 'destroyer', origin: { x: 8, y: 4 }, orientation: 'horizontal' },
  ];
  for (const ship of p2Ships) {
    s = play(logic, s, p2, 'placeShip', ship);
  }

  // Commit placements
  s = play(logic, s, p1, 'commitPlacement', {});
  s = play(logic, s, p2, 'commitPlacement', {});

  // Fire shots — mix of hits and misses on both sides.
  // P2 ships: Carrier at (5,0)v→y0-4, Battleship at (0,3)h→x0-3,
  //           Cruiser at (6,6)v→y6-8, Sub at (0,9)h→x0-2, Destroyer at (8,4)h→x8-9
  // P1 ships: Carrier at (0,0)h→x0-4, Battleship at (0,2)h→x0-3,
  //           Cruiser at (0,4)h→x0-2, Sub at (4,4)v→y4-6, Destroyer at (7,8)v→y8-9
  const shots = [
    // Alternating: P1 fires, then P2, etc.
    [null, { x: 7, y: 7 }], // P1 → miss
    [null, { x: 5, y: 5 }], // P2 → miss
    [null, { x: 0, y: 3 }], // P1 → hit P2 BS
    [null, { x: 0, y: 0 }], // P2 → hit P1 CA
    [null, { x: 1, y: 3 }], // P1 → hit P2 BS
    [null, { x: 0, y: 1 }], // P2 → hit P1 CA
    [null, { x: 2, y: 3 }], // P1 → hit P2 BS
    [null, { x: 3, y: 3 }], // P2 → miss
    [null, { x: 3, y: 3 }], // P1 → hit P2 BS → SUNK!
    [null, { x: 0, y: 2 }], // P2 → hit P1 CA
    [null, { x: 5, y: 0 }], // P1 → hit P2 CA
    [null, { x: 7, y: 7 }], // P2 → miss
    [null, { x: 5, y: 1 }], // P1 → hit P2 CA
    [null, { x: 0, y: 3 }], // P2 → hit P1 CA
    [null, { x: 6, y: 6 }], // P1 → hit P2 CR
    [null, { x: 9, y: 9 }], // P2 → miss
    [null, { x: 8, y: 8 }], // P1 → miss
    [null, { x: 2, y: 2 }], // P2 → hit P1 BS
    [null, { x: 0, y: 9 }], // P1 → hit P2 Sub
    [null, { x: 4, y: 4 }], // P2 → hit P1 Sub
  ];

  for (const [, cell] of shots) {
    const uid = currentUserId(s);
    try {
      s = play(logic, s, uid, 'fireShot', { cell });
    } catch {
      // Skip invalid shots (already-shot cells etc.)
      break;
    }
  }

  return s;
}

function buildMonopoly() {
  const logic = gameRegistry.getGameLogic('monopoly');
  const { players, config } = makePlayers(4, 'monopoly');
  let s = logic.initGame('screenshot-monopoly', 'Monopoly', players, config);

  // Override state for a visually rich mid-game scene.
  // Player 1 (Alice): owns brown monopoly + houses, good cash
  s.players[0].position = 24; // Illinois Avenue area
  s.players[0].money = 1120;

  // Player 2 (Bob): owns some light blues
  s.players[1].position = 11; // St. Charles Place
  s.players[1].money = 680;

  // Player 3 (Charlie): owns railroads + a utility
  s.players[2].position = 5; // Reading Railroad
  s.players[2].money = 950;

  // Player 4 (Diana): low on cash
  s.players[3].position = 19; // New York Avenue
  s.players[3].money = 230;

  // Property ownership: brown monopoly for P1, light blues for P2,
  // railroads for P3, scattered others.
  const p1Id = players[0].userId;
  const p2Id = players[1].userId;
  const p3Id = players[2].userId;
  const p4Id = players[3].userId;

  // Brown: positions 1 (Mediterranean), 3 (Baltic)
  s.properties[1] = { ownerId: p1Id, houses: 3, mortgaged: false };
  s.properties[3] = { ownerId: p1Id, houses: 3, mortgaged: false };

  // Light blue: 6 (Oriental), 8 (Vermont), 9 (Connecticut)
  s.properties[6] = { ownerId: p2Id, houses: 0, mortgaged: false };
  s.properties[8] = { ownerId: p2Id, houses: 0, mortgaged: false };
  s.properties[9] = { ownerId: p2Id, houses: 0, mortgaged: false };

  // Pink: 11 (St. Charles), 13 (States), 14 (Virginia)
  s.properties[11] = { ownerId: p4Id, houses: 0, mortgaged: false };
  s.properties[13] = { ownerId: p4Id, houses: 0, mortgaged: true };
  s.properties[14] = { ownerId: p2Id, houses: 0, mortgaged: false };

  // Railroads: 5, 15, 25, 35
  s.properties[5] = { ownerId: p3Id, houses: 0, mortgaged: false };
  s.properties[15] = { ownerId: p3Id, houses: 0, mortgaged: false };
  s.properties[25] = { ownerId: p3Id, houses: 0, mortgaged: false };

  // Orange: 16 (St. James), 18 (Tennessee), 19 (New York)
  s.properties[16] = { ownerId: p1Id, houses: 0, mortgaged: false };
  s.properties[18] = { ownerId: p3Id, houses: 0, mortgaged: false };
  s.properties[19] = { ownerId: p4Id, houses: 0, mortgaged: false };

  // Red: 21 (Kentucky), 23 (Indiana), 24 (Illinois)
  s.properties[21] = { ownerId: p1Id, houses: 0, mortgaged: false };
  s.properties[23] = { ownerId: p2Id, houses: 0, mortgaged: false };
  s.properties[24] = { ownerId: p1Id, houses: 0, mortgaged: false };

  // Utilities: 12 (Electric), 28 (Water)
  s.properties[12] = { ownerId: p3Id, houses: 0, mortgaged: false };

  // Set turn state: Alice's turn, post-roll on a property
  s.turnState = {
    currentPlayerIndex: 0,
    phase: 'post-roll',
    dice: [4, 3],
    doubles: 0,
    cardDrawn: null,
  };

  // Trim log and add flavor
  s.log = [
    { timestamp: Date.now() - 20000, message: 'Diana paid $75 rent to Bob', type: 'rent' },
    { timestamp: Date.now() - 15000, message: 'Charlie collected $200 for passing Go', type: 'go' },
    { timestamp: Date.now() - 10000, message: 'Bob built on Oriental Avenue', type: 'build' },
    {
      timestamp: Date.now() - 5000,
      message: 'Alice rolled 4+3 and moved to Illinois Avenue',
      type: 'roll',
    },
  ];

  return s;
}

function buildRisk() {
  const logic = gameRegistry.getGameLogic('risk');
  const { players, config } = makePlayers(4, 'risk');
  let s = logic.initGame('screenshot-risk', 'Risk', players, config);

  const pIds = players.map((p) => p.userId);

  // Override territory ownership for a mid-game scene.
  // P1: most of North America + some SA
  // P2: Europe + North Africa
  // P3: most of Asia + Australia
  // P4: rest of Africa + leftover territories
  const territories = Object.keys(s.territories);

  // Build continent-based assignment using the config
  const board = config.board || config;
  const continentMembers = {};
  if (board.continents) {
    for (const [cId, cData] of Object.entries(board.continents)) {
      continentMembers[cId] = cData.territories;
    }
  }

  // Assign by continent if possible, else distribute evenly
  const assignment = {};
  if (continentMembers['north-america']) {
    for (const t of continentMembers['north-america']) assignment[t] = pIds[0];
    for (const t of continentMembers['south-america']) assignment[t] = pIds[0];
    for (const t of continentMembers['europe']) assignment[t] = pIds[1];
    for (const t of continentMembers['africa']) assignment[t] = pIds[3];
    for (const t of continentMembers['asia']) assignment[t] = pIds[2];
    for (const t of continentMembers['australia']) assignment[t] = pIds[2];

    // Give P2 some African territories and P4 some Asian
    const africa = continentMembers['africa'];
    if (africa.length > 3) {
      for (let i = 0; i < 3; i++) assignment[africa[i]] = pIds[1];
    }
    const asia = continentMembers['asia'];
    if (asia.length > 6) {
      for (let i = 6; i < asia.length; i++) assignment[asia[i]] = pIds[3];
    }
  } else {
    let idx = 0;
    for (const t of territories) {
      assignment[t] = pIds[idx % 4];
      idx++;
    }
  }

  // Apply assignment with varied army counts
  let armySeed = 17;
  for (const t of territories) {
    armySeed = (armySeed * 31 + 7) % 100;
    const owner = assignment[t] || pIds[0];
    const isBorder = armySeed % 3 === 0;
    s.territories[t] = {
      ownerId: owner,
      armies: isBorder ? 1 + (armySeed % 4) : 3 + (armySeed % 8),
    };
  }

  // Set turn state: P1 in attack phase
  s.turnState = {
    currentPlayerIndex: 0,
    phase: 'attack',
    armiesToPlace: 0,
    fortifyUsed: false,
    attackedThisTurn: true,
    lastDiceRoll: null,
  };

  // Give P1 some cards
  if (s.players[0].hand !== undefined) {
    s.players[0].hand = (s.deck || []).slice(0, 3);
    s.deck = (s.deck || []).slice(3);
  }

  s.log = [
    { timestamp: Date.now() - 10000, message: 'Alice placed 5 armies on Alaska', type: 'action' },
    {
      timestamp: Date.now() - 5000,
      message: 'Alice attacked Kamchatka from Alaska',
      type: 'action',
    },
  ];

  return s;
}

function buildLife() {
  const logic = gameRegistry.getGameLogic('life');
  const { players, config } = makePlayers(4, 'life');
  let s = logic.initGame('screenshot-life', 'The Game of Life', players, config);

  // Override for a visually rich mid-game:
  // P1: on main track, married with 1 child, has career + salary + house
  // P2: on main track, just past payday, has career + salary
  // P3: on college path nearing the merge
  // P4: on career path nearing the merge

  // Use real square IDs from the board config
  const boardSquares = config.board || [];
  const mainSquares = boardSquares.filter((sq) => sq.id.startsWith('sq-m'));
  const careerSquares = boardSquares.filter((sq) => sq.id.startsWith('sq-c'));
  const collegeSquares = boardSquares.filter((sq) => sq.id.startsWith('sq-u'));

  // Careers and salaries from config
  const careers = config.careers || [];
  const salaries = config.salaries || [];
  const houses = config.houses || [];

  const noDegCareers = careers.filter((c) => !c.degreeRequired);
  const degCareers = careers.filter((c) => c.degreeRequired);

  // P1: well along the main track
  if (mainSquares.length > 15) s.players[0].position = mainSquares[15].id;
  s.players[0].cash = 85000;
  s.players[0].path = 'career';
  s.players[0].career = noDegCareers[0] || null;
  s.players[0].salary = salaries[2] || null;
  s.players[0].spouse = true;
  s.players[0].children = 1;
  s.players[0].house = houses[1] || null;
  s.players[0].retired = false;
  s.players[0].pending = null;
  s.players[0].midTurn = false;
  s.players[0].autoInsurance = true;
  s.players[0].lifeInsurance = false;
  s.players[0].stockNumber = 7;
  s.players[0].lifeTiles = [];
  s.players[0].spinAgain = false;

  // P2: earlier on main track
  if (mainSquares.length > 8) s.players[1].position = mainSquares[8].id;
  s.players[1].cash = 120000;
  s.players[1].path = 'college';
  s.players[1].career = degCareers[0] || null;
  s.players[1].salary = salaries[4] || null;
  s.players[1].spouse = true;
  s.players[1].children = 2;
  s.players[1].house = houses[2] || null;
  s.players[1].retired = false;
  s.players[1].pending = null;
  s.players[1].midTurn = false;
  s.players[1].autoInsurance = false;
  s.players[1].lifeInsurance = true;
  s.players[1].stockNumber = null;
  s.players[1].lifeTiles = [];
  s.players[1].spinAgain = false;

  // P3: on college path
  if (collegeSquares.length > 5) s.players[2].position = collegeSquares[5].id;
  else if (collegeSquares.length > 0)
    s.players[2].position = collegeSquares[collegeSquares.length - 1].id;
  s.players[2].cash = -20000;
  s.players[2].path = 'college';
  s.players[2].career = degCareers[1] || null;
  s.players[2].salary = salaries[5] || null;
  s.players[2].spouse = false;
  s.players[2].children = 0;
  s.players[2].house = null;
  s.players[2].retired = false;
  s.players[2].pending = null;
  s.players[2].midTurn = false;
  s.players[2].autoInsurance = false;
  s.players[2].lifeInsurance = false;
  s.players[2].stockNumber = null;
  s.players[2].lifeTiles = [];
  s.players[2].spinAgain = false;

  // P4: on career path
  if (careerSquares.length > 4) s.players[3].position = careerSquares[4].id;
  else if (careerSquares.length > 0)
    s.players[3].position = careerSquares[careerSquares.length - 1].id;
  s.players[3].cash = 45000;
  s.players[3].path = 'career';
  s.players[3].career = noDegCareers[1] || null;
  s.players[3].salary = salaries[1] || null;
  s.players[3].spouse = false;
  s.players[3].children = 0;
  s.players[3].house = null;
  s.players[3].retired = false;
  s.players[3].pending = null;
  s.players[3].midTurn = false;
  s.players[3].autoInsurance = false;
  s.players[3].lifeInsurance = false;
  s.players[3].stockNumber = 3;
  s.players[3].lifeTiles = [];
  s.players[3].spinAgain = false;

  // P1's turn, about to spin
  s.turnState = { currentPlayerIndex: 0 };

  s.log = [
    { timestamp: Date.now() - 15000, message: 'Bob collected payday: $80,000', type: 'action' },
    {
      timestamp: Date.now() - 10000,
      message: 'Charlie paid $40,000 in college loans',
      type: 'action',
    },
    { timestamp: Date.now() - 5000, message: "Alice's stock #7 paid out $10,000!", type: 'action' },
  ];

  return s;
}

// ── fixture registry ────────────────────────────────────────────────────────
const BUILDERS = {
  'tic-tac-toe': buildTicTacToe,
  'connect-four': buildConnectFour,
  checkers: buildCheckers,
  yahtzee: buildYahtzee,
  battleship: buildBattleship,
  monopoly: buildMonopoly,
  risk: buildRisk,
  life: buildLife,
};

// ── load or generate a fixture ──────────────────────────────────────────────
function getFixture(gameType) {
  const fixturePath = path.join(FIXTURES_DIR, `${gameType}.json`);

  if (fs.existsSync(fixturePath)) {
    console.log(`  Reading cached fixture: ${gameType}`);
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  }

  console.log(`  Generating fixture: ${gameType}`);
  const state = BUILDERS[gameType]();

  // Ensure config is embedded
  if (!state.config || Object.keys(state.config).length === 0) {
    state.config = gameRegistry.getGameLogic(gameType).loadConfig();
  }

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify(state, null, 2));
  return state;
}

// ── database seeding ────────────────────────────────────────────────────────
async function seedDatabase(fixtures, passwordHash) {
  // Create global user pool once
  const createdUsers = new Set();
  for (const { state } of fixtures) {
    for (const player of state.players) {
      if (!createdUsers.has(player.userId)) {
        if (!database.getUserById(player.userId)) {
          database.createUser(player.userId, player.username, passwordHash);
        }
        createdUsers.add(player.userId);
      }
    }
  }

  // Create each game
  for (const { gameType, state } of fixtures) {
    const createdBy = state.createdBy || state.players[0].userId;
    database.createGame(
      state.id,
      state.name,
      createdBy,
      state,
      state.config,
      state.gameType || gameType,
    );
    database.updateGame(state.id, state.status || 'playing', state);
    for (const player of state.players) {
      database.addPlayerToGame(state.id, player.userId);
    }
  }
}

// ── screenshot capture ──────────────────────────────────────────────────────
async function captureGame(browser, port, token, gameName, outputPath, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  try {
    // Inject auth token before navigation (runs in browser context)
    // eslint-disable-next-line no-undef
    await page.addInitScript((t) => localStorage.setItem('monopoly_token', t), token);

    await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle' });

    // Wait for lobby
    await page.waitForSelector('#lobby-screen.active', { timeout: 15000 });

    // Wait for the "My Active Games" section, then find the right game card
    await page.waitForSelector('#my-games-section:not([style*="display: none"])', {
      timeout: 15000,
    });
    // Click the Rejoin button on the card matching this game's name
    const card = page.locator('#my-games-list .game-card', { hasText: gameName });
    await card.locator('button', { hasText: 'Rejoin' }).click();

    // Wait for game screen to fully render
    await page.waitForSelector('#game-screen.active', { timeout: 15000 });
    await page.waitForSelector('.board-wrapper > *', { timeout: 15000 });

    // Let animations settle and CSS paint
    await page.waitForTimeout(2000);

    // Pause CSS animations for deterministic captures
    await page.addStyleTag({
      content:
        '*, *::after, *::before { caret-color: transparent !important; animation-play-state: paused !important; }',
    });
    await page.waitForTimeout(200);

    await page.screenshot({ path: outputPath, fullPage: false });
  } finally {
    await context.close();
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  console.log('Generating fixtures...');
  const fixtures = [];
  for (const game of GAMES) {
    const state = getFixture(game.type);
    const viewPlayer = state.players[game.viewPlayer];
    const token = auth.generateToken({
      id: viewPlayer.userId,
      username: viewPlayer.username,
    });
    fixtures.push({ gameType: game.type, state, token, ...game });
  }

  console.log('\nSeeding database...');
  const passwordHash = await bcrypt.hash('screenshot', 1);
  await seedDatabase(
    fixtures.map((f) => ({ gameType: f.type, state: f.state })),
    passwordHash,
  );

  console.log('Starting server...');
  const { httpServer } = createServer();
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  console.log(`  Listening on port ${port}\n`);

  const browser = await chromium.launch();

  try {
    for (const game of fixtures) {
      const name = game.state.name || game.type;
      process.stdout.write(`Capturing ${name}...`);

      // Gallery screenshot (1280×800)
      const outPath = path.join(OUTPUT_DIR, `${game.type}.png`);
      await captureGame(browser, port, game.token, name, outPath, {
        width: 1280,
        height: 800,
      });
      console.log(' done');

      // Hero screenshot at larger resolution (Life)
      if (game.isHero) {
        process.stdout.write(`Capturing hero (${name})...`);
        const heroPath = path.join(OUTPUT_DIR, 'hero.png');
        await captureGame(browser, port, game.token, name, heroPath, {
          width: 1600,
          height: 900,
        });
        console.log(' done');
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => httpServer.close(resolve));
  }

  // Summary
  const pngs = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.png'));
  console.log(`\n✓ ${pngs.length} screenshots saved to docs/screenshots/`);
  for (const f of pngs) {
    const size = fs.statSync(path.join(OUTPUT_DIR, f)).size;
    console.log(`  ${f} (${(size / 1024).toFixed(0)} KB)`);
  }
}

main().catch((err) => {
  console.error('\nScreenshot capture failed:', err);
  process.exit(1);
});
