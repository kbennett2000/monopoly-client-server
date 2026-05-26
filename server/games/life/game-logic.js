'use strict';

/**
 * game-logic.js — The Game of Life (server-side, through session 2b).
 *
 * Implements the GameLogic interface defined in server/src/game-logic-interface.js.
 *
 * ─── Sessions ────────────────────────────────────────────────────────────────
 *
 * Session 1: board, spinner, college/career fork, career/salary card draws,
 *   pending-choice state machine, basic pay/collect effect handlers.
 *
 * Session 2a: real implementations of marriage, children (baby and twins),
 *   auto and life insurance, and stocks.  Stock payouts trigger on any
 *   spinner match across ALL players' turns.
 *
 * Session 2b (this): end-game.  Real retirement-fork handler.  Countryside
 *   Acres and Millionaire Estates as the two terminal retirement tracks.
 *   Retired-but-still-in-game pattern: retired players are skipped in turn
 *   rotation but stay in state until everyone retires.  Life tiles (drawn
 *   at CA retirement, revealed at game over) implemented with hidden
 *   information from non-self viewpoints.  Final scoring formula and the
 *   ME cash-gamble (highest cash among ME retirees wins outright; losing
 *   ME retirees score zero).  pay-tax-by-salary effect type added to wire
 *   up the previously-dead taxDue field on salary cards.
 *
 * Session 3 (deferred): renderer (client/).
 *
 * ─── State shape ─────────────────────────────────────────────────────────────
 *
 * GameState {
 *   id, name, gameType: 'life', stateVersion, status, config,
 *   players: Player[],
 *   turnState: { currentPlayerIndex: number },
 *   careerDeck: string[],     shuffled remaining career card IDs
 *   careerDiscard: string[],  pile drawn from when the deck empties
 *   salaryDeck: string[],
 *   salaryDiscard: string[],
 *   lifeTileDeck: string[],   (session 2b) shuffled remaining life-tile IDs;
 *                             drawn from at CA retirement.  Late retirees may
 *                             find the deck empty — that's the strategic
 *                             incentive to retire early to CA.
 *   winner: string | string[] | null,   set on game over
 *   log: LogEntry[]
 * }
 *
 * Player {
 *   userId, username, color, colorHex, token, active, connected,
 *   cash:     number     starting per settings.json; may go negative
 *   position: string     board square id
 *   path:     'college' | 'career' | null    set when the start fork is chosen
 *   career:   CareerCard | null
 *   salary:   SalaryCard | null
 *   spouse:   boolean    true after the marry square fires (session 2a)
 *   children: number     count of pegs; +1 on baby, +2 on twins (session 2a)
 *   autoInsurance: boolean   (session 2a) bought via buyAutoInsurance
 *   lifeInsurance: boolean   (session 2a) bought via buyLifeInsurance
 *   stockNumber:   number | null   (session 2a) 1-10 stake; null if no stock owned
 *   midTurn:       boolean         true while a turn is mid-resolution; gates
 *                                  out-of-band purchases (insurance/stock).
 *                                  Set on entry to spin/choose actions and
 *                                  cleared when the turn fully ends.
 *   pending:                   { type, options } | null   discriminated union
 *                                  type ∈ { 'fork', 'career-draw', 'salary-draw' }
 *                                  options carries square IDs for forks, card IDs for draws
 *   spinAgain: boolean   true when a spin-again square just fired; cleared on next spin
 *   retired:   boolean   (session 2b) true after crossing a retirement terminal
 *   retiredTo: 'countryside-acres' | 'millionaire-estates' | null   (session 2b)
 *   lifeTiles: LifeTile[]   (session 2b) populated at CA retirement; values
 *                            masked from opponents until game over.
 * }
 */

const configLoader = require('./config-loader');
const { validateImplementation } = require('../../src/game-logic-interface');

const STATE_VERSION = 4;

// ── helpers ──────────────────────────────────────────────────────────────────

function clone(obj) {
  return structuredClone(obj);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rollSpin(settings) {
  const min = settings.spinMin;
  const max = settings.spinMax;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function log(state, message, type = 'info') {
  state.log.push({ timestamp: Date.now(), message, type });
  if (state.log.length > 200) state.log.shift();
}

function event(type, data = {}) {
  return { type, data, timestamp: Date.now() };
}

function hasPendingChoice(player) {
  return !!(
    player.pending &&
    Array.isArray(player.pending.options) &&
    player.pending.options.length > 0
  );
}

// ── effect handlers ──────────────────────────────────────────────────────────
//
// Each handler receives (state, playerIdx, square) where state has been cloned
// by the caller.  It mutates the player in place, appends log entries, and
// returns an array of events to emit.

function applyCareerFork(state, playerIdx, square) {
  const player = state.players[playerIdx];
  player.pending = { type: 'fork', options: square.next.slice() };
  log(state, `${player.username} is at the start fork — choose Career or College`, 'fork');
  return [
    event('FORK_CHOICE_PENDING', {
      username: player.username,
      squareId: square.id,
      options: square.next.map((nid) => {
        const sq = state.config.boardById[nid];
        return { id: nid, label: sq.label };
      }),
    }),
  ];
}

function applyPayBank(state, playerIdx, square) {
  const player = state.players[playerIdx];
  const amount = square.data.amount;
  player.cash -= amount;
  log(state, `${player.username} paid the bank $${amount} (${square.label})`, 'money');
  return [
    event('MONEY_PAID', {
      username: player.username,
      amount,
      to: 'bank',
      reason: square.label,
    }),
  ];
}

function applyCollectBank(state, playerIdx, square) {
  const player = state.players[playerIdx];
  const amount = square.data.amount;
  player.cash += amount;
  log(state, `${player.username} collected $${amount} from the bank (${square.label})`, 'money');
  return [
    event('MONEY_RECEIVED', {
      username: player.username,
      amount,
      from: 'bank',
      reason: square.label,
    }),
  ];
}

function applyPayLoans(state, playerIdx, square) {
  const player = state.players[playerIdx];
  const amount = state.config.settings.collegeLoanAmount;
  player.cash -= amount;
  log(state, `${player.username} paid $${amount} in college loans`, 'money');
  return [event('LOAN_PAID', { username: player.username, amount, squareId: square.id })];
}

function applyPayTaxBySalary(state, playerIdx, square) {
  // The tax is whatever the player's current salary card carries on its
  // taxDue field.  A player who somehow lands here without a salary (the
  // board layout doesn't allow this from a normal traversal, but be
  // defensive) pays zero.
  const player = state.players[playerIdx];
  const amount = player.salary?.taxDue ?? 0;
  player.cash -= amount;
  log(
    state,
    `${player.username} paid $${amount} in income tax (salary tier ${player.salary?.id ?? 'none'})`,
    'money',
  );
  return [
    event('MONEY_PAID', {
      username: player.username,
      amount,
      to: 'bank',
      reason: square.label,
      taxBySalary: true,
    }),
  ];
}

function applyPayEachPlayer(state, playerIdx, square) {
  const events = [];
  const payer = state.players[playerIdx];
  const amount = square.data.amount;
  for (let i = 0; i < state.players.length; i++) {
    if (i === playerIdx) continue;
    const other = state.players[i];
    if (other.active === false) continue;
    payer.cash -= amount;
    other.cash += amount;
    events.push(
      event('MONEY_TRANSFERRED', {
        from: payer.username,
        to: other.username,
        amount,
        reason: square.label,
      }),
    );
  }
  log(state, `${payer.username} paid $${amount} to each player (${square.label})`, 'money');
  return events;
}

function applyCollectEachPlayer(state, playerIdx, square) {
  const events = [];
  const collector = state.players[playerIdx];
  const amount = square.data.amount;
  for (let i = 0; i < state.players.length; i++) {
    if (i === playerIdx) continue;
    const other = state.players[i];
    if (other.active === false) continue;
    other.cash -= amount;
    collector.cash += amount;
    events.push(
      event('MONEY_TRANSFERRED', {
        from: other.username,
        to: collector.username,
        amount,
        reason: square.label,
      }),
    );
  }
  log(
    state,
    `${collector.username} collected $${amount} from each player (${square.label})`,
    'money',
  );
  return events;
}

function applyPayday(state, playerIdx, _square) {
  const player = state.players[playerIdx];
  const salaryAmount = player.salary ? player.salary.amount : 0;
  const careerBonus = player.career ? player.career.paydayBonus || 0 : 0;
  const total = salaryAmount + careerBonus;
  player.cash += total;
  log(
    state,
    `${player.username} earned $${total} on PAY DAY (salary $${salaryAmount} + career bonus $${careerBonus})`,
    'money',
  );
  return [
    event('PAYDAY', {
      username: player.username,
      total,
      salary: salaryAmount,
      careerBonus,
    }),
  ];
}

function applySpinAgain(state, playerIdx, _square) {
  const player = state.players[playerIdx];
  player.spinAgain = true;
  log(state, `${player.username} gets to spin again!`, 'info');
  return [event('SPIN_AGAIN_GRANTED', { username: player.username })];
}

function applyDrawCareerDegree(state, playerIdx, _square) {
  return drawCareerCards(state, playerIdx, true);
}

function applyDrawCareerNoDegree(state, playerIdx, _square) {
  return drawCareerCards(state, playerIdx, false);
}

function applyDrawSalary(state, playerIdx, _square) {
  return drawSalaryCards(state, playerIdx);
}

// ── session-2b retirement handlers ───────────────────────────────────────────

/**
 * Countryside Acres retirement.  Sets the player to retired/CA, draws up to
 * `caTilesPerRetiree` life tiles from the top of the shuffled deck.  The
 * deck size is intentionally smaller than maxPlayers * tiles-per-retiree —
 * late CA retirees may find the deck empty and walk away with fewer (or
 * zero) tiles.  That's the strategic incentive baked into CA.
 */
function applyCountrysideRetirement(state, playerIdx, square) {
  const events = [];
  const player = state.players[playerIdx];
  const target = state.config.settings.caTilesPerRetiree;
  const drawnIds = [];
  while (drawnIds.length < target && state.lifeTileDeck.length > 0) {
    drawnIds.push(state.lifeTileDeck.shift());
  }
  const tilesById = {};
  for (const t of state.config.lifeTiles) tilesById[t.id] = t;
  const drawnTiles = drawnIds.map((id) => tilesById[id]);
  player.retired = true;
  player.retiredTo = 'countryside-acres';
  player.lifeTiles = drawnTiles;
  log(
    state,
    `${player.username} retired to Countryside Acres with ${drawnTiles.length} life tile(s)`,
    'event',
  );
  // Emit only the count, not the tile values — they're face-down until game
  // over.  Renderer shows "Alice retired with 4 life tiles."
  events.push(
    event('PLAYER_RETIRED_CA', {
      username: player.username,
      squareId: square.id,
      tilesDrawn: drawnTiles.length,
    }),
  );
  return events;
}

/**
 * Millionaire Estates retirement.  Sets the player to retired/ME with no
 * life tiles.  The ME cash gamble doesn't resolve here — it resolves at
 * game over, when highest cash among ME retirees wins outright and the
 * other ME retirees score zero.  Until then ME players just look like
 * "retired with $X cash."
 */
function applyMillionaireRetirement(state, playerIdx, square) {
  const player = state.players[playerIdx];
  player.retired = true;
  player.retiredTo = 'millionaire-estates';
  player.lifeTiles = [];
  log(
    state,
    `${player.username} retired to Millionaire Estates with $${player.cash} (gamble resolves at game over)`,
    'event',
  );
  return [
    event('PLAYER_RETIRED_ME', {
      username: player.username,
      squareId: square.id,
      cashAtRetirement: player.cash,
    }),
  ];
}

// ── session-2a effects (marriage, children, accidents) ──────────────────────
//
// Each of these handlers performs its mutation, then bumps the pawn to
// next[0] for the same reason the session-1 stubs did — to keep the pawn
// visibly moving and avoid "I landed on Get Married, my turn ended on Get
// Married, I'll re-resolve on my next spin" ambiguity.  The destination's
// effect is NOT auto-resolved on the bump; the player resolves it on the
// next spin that lands them there normally.

function bumpToNext(state, playerIdx, square, reason) {
  // Internal helper.  Sets player.position to next[0] (or stays if terminal)
  // and returns a PLAYER_MOVED event when the position actually changed.
  const player = state.players[playerIdx];
  const dest = square.next[0] || square.id;
  if (dest === square.id) return [];
  player.position = dest;
  return [
    event('PLAYER_MOVED', {
      username: player.username,
      from: square.id,
      to: dest,
      reason,
    }),
  ];
}

function applyMarry(state, playerIdx, square) {
  const player = state.players[playerIdx];
  const events = [];

  // Re-landing on the marry square after already being married is a no-op.
  // It can happen if board layout or future spin-again chains route a
  // married player back here.  We emit a distinct event so the renderer
  // can surface a "no effect" toast rather than silently swallowing it.
  if (player.spouse === true) {
    log(state, `${player.username} is already married — no effect`, 'info');
    events.push(event('PLAYER_MARRIED_NO_EFFECT', { username: player.username }));
    events.push(...bumpToNext(state, playerIdx, square, 'post-marriage-no-effect'));
    return events;
  }

  player.spouse = true;
  const giftPer = state.config.settings.weddingGiftPerPlayer;
  const contributors = [];
  let giftsCollected = 0;
  for (let i = 0; i < state.players.length; i++) {
    if (i === playerIdx) continue;
    const other = state.players[i];
    if (other.active === false) continue;
    other.cash -= giftPer;
    player.cash += giftPer;
    giftsCollected += giftPer;
    contributors.push(other.username);
    events.push(
      event('MONEY_TRANSFERRED', {
        from: other.username,
        to: player.username,
        amount: giftPer,
        reason: 'wedding-gift',
      }),
    );
  }
  log(
    state,
    `${player.username} got married and collected $${giftsCollected} in wedding gifts`,
    'event',
  );
  events.push(event('PLAYER_MARRIED', { username: player.username, giftsCollected, contributors }));
  events.push(...bumpToNext(state, playerIdx, square, 'post-marriage'));
  return events;
}

function applyHaveBaby(state, playerIdx, square) {
  return resolveChildren(state, playerIdx, square, /* count */ 1, /* kind */ 'baby');
}

function applyHaveTwins(state, playerIdx, square) {
  return resolveChildren(state, playerIdx, square, /* count */ 2, /* kind */ 'twins');
}

/**
 * Shared resolver for baby and twins squares.  Increments children and
 * collects the baby-shower gift from every other active player.
 *
 * Canonical Life requires marriage before children.  We deliberately do
 * NOT enforce that here: in a digital implementation the rule produces
 * more confusion than fairness (especially around spin-again chains and
 * board layout), so an unmarried player who happens to land on a baby
 * square gets the child and the shower gifts.  Tests pin this behavior
 * so future me can find it.
 */
function resolveChildren(state, playerIdx, square, count, kind) {
  const events = [];
  const player = state.players[playerIdx];
  player.children += count;

  const giftPer =
    kind === 'twins'
      ? state.config.settings.twinsGiftPerPlayer
      : state.config.settings.babyGiftPerPlayer;
  const contributors = [];
  let giftsCollected = 0;
  for (let i = 0; i < state.players.length; i++) {
    if (i === playerIdx) continue;
    const other = state.players[i];
    if (other.active === false) continue;
    other.cash -= giftPer;
    player.cash += giftPer;
    giftsCollected += giftPer;
    contributors.push(other.username);
    events.push(
      event('MONEY_TRANSFERRED', {
        from: other.username,
        to: player.username,
        amount: giftPer,
        reason: `${kind}-gift`,
      }),
    );
  }

  log(
    state,
    `${player.username} had ${kind === 'twins' ? 'twins' : 'a baby'} (children: ${player.children}) and collected $${giftsCollected}`,
    'event',
  );
  events.push(
    event('PLAYER_HAD_BABY', {
      username: player.username,
      childCount: count,
      totalChildren: player.children,
      giftsCollected,
      contributors,
      kind,
    }),
  );
  events.push(...bumpToNext(state, playerIdx, square, `post-${kind}`));
  return events;
}

function applyAutoAccident(state, playerIdx, square) {
  const events = [];
  const player = state.players[playerIdx];
  const cost = state.config.settings.autoAccidentCost;
  if (player.autoInsurance) {
    log(state, `${player.username} had an auto accident — insurance covered it`, 'info');
    events.push(
      event('INSURANCE_COVERED', {
        username: player.username,
        insuranceType: 'auto',
        squareId: square.id,
        avoided: cost,
      }),
    );
  } else {
    player.cash -= cost;
    log(state, `${player.username} paid $${cost} after an auto accident (no insurance)`, 'money');
    events.push(
      event('MONEY_PAID', {
        username: player.username,
        amount: cost,
        to: 'bank',
        reason: 'auto-accident',
      }),
    );
  }
  return events;
}

function applyLifeAccident(state, playerIdx, square) {
  const events = [];
  const player = state.players[playerIdx];
  const cost = state.config.settings.lifeAccidentCost;
  if (player.lifeInsurance) {
    log(state, `${player.username} was hospitalized — life insurance covered it`, 'info');
    events.push(
      event('INSURANCE_COVERED', {
        username: player.username,
        insuranceType: 'life',
        squareId: square.id,
        avoided: cost,
      }),
    );
  } else {
    player.cash -= cost;
    log(state, `${player.username} paid $${cost} in medical bills (no life insurance)`, 'money');
    events.push(
      event('MONEY_PAID', {
        username: player.username,
        amount: cost,
        to: 'bank',
        reason: 'life-accident',
      }),
    );
  }
  return events;
}

// ── session-2b stubs (retirement) ────────────────────────────────────────────

function applyRetirementFork(state, playerIdx, square) {
  // Real session-2b retirement fork: gate the turn on a player choice
  // between Countryside Acres and Millionaire Estates.  Same shape as the
  // start fork — sets player.pending = { type: 'retirement-fork', options }
  // and the chooseBranch action handles validation and advancement.
  const player = state.players[playerIdx];
  player.pending = { type: 'retirement-fork', options: square.next.slice() };
  log(state, `${player.username} reached the retirement fork — choose CA or ME`, 'fork');
  return [
    event('FORK_CHOICE_PENDING', {
      username: player.username,
      squareId: square.id,
      kind: 'retirement-fork',
      options: square.next.map((nid) => {
        const sq = state.config.boardById[nid];
        return { id: nid, label: sq.label };
      }),
    }),
  ];
}

const EFFECTS = {
  'career-fork': applyCareerFork,
  'draw-career-degree': applyDrawCareerDegree,
  'draw-career-no-degree': applyDrawCareerNoDegree,
  'draw-salary': applyDrawSalary,
  'pay-loans': applyPayLoans,
  'pay-bank': applyPayBank,
  'pay-tax-by-salary': applyPayTaxBySalary,
  'collect-bank': applyCollectBank,
  'pay-each-player': applyPayEachPlayer,
  'collect-each-player': applyCollectEachPlayer,
  payday: applyPayday,
  'spin-again': applySpinAgain,
  marry: applyMarry,
  'have-baby': applyHaveBaby,
  'have-twins': applyHaveTwins,
  'auto-accident': applyAutoAccident,
  'life-accident': applyLifeAccident,
  'retirement-fork': applyRetirementFork,
  'countryside-retirement': applyCountrysideRetirement,
  'millionaire-retirement': applyMillionaireRetirement,
};

function resolveEffect(state, playerIdx, square) {
  const handler = EFFECTS[square.type];
  if (!handler) {
    throw new Error(`No effect handler for square type "${square.type}" at ${square.id}`);
  }
  return handler(state, playerIdx, square);
}

// ── card draw helpers ────────────────────────────────────────────────────────

function drawOptionsFromDeck(deck, discard, n, filterFn) {
  // Take up to `n` cards from `deck` that match filterFn, restocking from
  // the discard pile when the deck runs dry.  Mutates both arrays; returns
  // the drawn card IDs in order taken.  If neither deck nor discard contains
  // an eligible card, returns fewer than n (or an empty array).
  const drawn = [];
  while (drawn.length < n) {
    if (deck.length === 0) {
      if (discard.length === 0) break;
      const reshuffled = shuffle(discard.splice(0));
      deck.push(...reshuffled);
    }
    let pickIdx = -1;
    for (let i = 0; i < deck.length; i++) {
      if (filterFn(deck[i])) {
        pickIdx = i;
        break;
      }
    }
    if (pickIdx < 0) {
      // No eligible card in deck.  Pull discard into deck and try once more;
      // if still nothing matches, give up to avoid an infinite loop.
      if (discard.length === 0) break;
      const reshuffled = shuffle(discard.splice(0));
      deck.push(...reshuffled);
      let secondPick = -1;
      for (let i = 0; i < deck.length; i++) {
        if (filterFn(deck[i])) {
          secondPick = i;
          break;
        }
      }
      if (secondPick < 0) break;
      drawn.push(deck.splice(secondPick, 1)[0]);
      continue;
    }
    drawn.push(deck.splice(pickIdx, 1)[0]);
  }
  return drawn;
}

function drawCareerCards(state, playerIdx, requireDegree) {
  const player = state.players[playerIdx];
  const careersById = {};
  for (const c of state.config.careers) careersById[c.id] = c;
  const n = state.config.settings.careerOptionsCount;
  const ids = drawOptionsFromDeck(
    state.careerDeck,
    state.careerDiscard,
    n,
    (id) => careersById[id].degreeRequired === requireDegree,
  );
  player.pending = { type: 'career-draw', options: ids };
  log(state, `${player.username} drew ${ids.length} career option(s)`, 'card');
  return [
    event('CAREER_DRAW_OPTIONS', {
      username: player.username,
      options: ids.map((id) => careersById[id]),
    }),
  ];
}

function drawSalaryCards(state, playerIdx) {
  const player = state.players[playerIdx];
  const salariesById = {};
  for (const c of state.config.salaries) salariesById[c.id] = c;
  const n = state.config.settings.salaryOptionsCount;
  const ids = drawOptionsFromDeck(state.salaryDeck, state.salaryDiscard, n, () => true);
  player.pending = { type: 'salary-draw', options: ids };
  log(state, `${player.username} drew ${ids.length} salary option(s)`, 'card');
  return [
    event('SALARY_DRAW_OPTIONS', {
      username: player.username,
      options: ids.map((id) => salariesById[id]),
    }),
  ];
}

// ── turn advancement ─────────────────────────────────────────────────────────

// ── final scoring (session 2b) ───────────────────────────────────────────────

/**
 * Compute a player's components of the final score.  Pure: depends only on
 * the player's own record + the configured childScoreBonus, no other state.
 *
 *   total = cash + house + sum(lifeTiles[].value) + (children * childScoreBonus)
 *
 * `player.house?.value` is intentionally optional — session 1's sq-m03 was
 * a flat pay-bank, not a tracked house purchase, so the field doesn't
 * exist yet.  When the buy-house mechanic is wired up, scoring picks it
 * up automatically.  Until then, the house component is always 0.
 */
function computeFinalScore(player, settings) {
  const cash = player.cash;
  const house = player.house?.value ?? 0;
  const lifeTilesValue = (player.lifeTiles || []).reduce((s, t) => s + (t.value || 0), 0);
  const childrenBonus = (player.children || 0) * settings.childScoreBonus;
  return {
    cash,
    house,
    lifeTilesValue,
    childrenBonus,
    total: cash + house + lifeTilesValue + childrenBonus,
  };
}

/**
 * Finalize the game when every player has retired (or been deactivated).
 * Sets state.status = 'finished', state.winner, and appends a GAME_OVER
 * event to `events`.  Mutates state.
 *
 * Winner determination (locked at prompt-writing):
 *
 *   • If ANY player retired to Millionaire Estates, the highest-cash ME
 *     retiree(s) win outright.  All other ME retirees score zero — they
 *     lost the gamble.  CA retirees are runners-up regardless of their
 *     own totals.
 *   • If NO player retired to ME, the highest-final-score CA retiree(s)
 *     win.  Standard score formula above.
 *   • Ties → array of winners, mirroring Yahtzee/Battleship convention.
 *
 * The GAME_OVER event includes `finalScores` for EVERY player (including
 * ME losers, whose `total` is forced to zero per the gamble) and reveals
 * every player's `lifeTiles` — hidden until now, surfaced at game over
 * the same way Battleship reveals fleets.
 */
function finalizeGame(state, events) {
  state.status = 'finished';

  const meRetirees = state.players.filter((p) => p.retiredTo === 'millionaire-estates');
  const caRetirees = state.players.filter((p) => p.retiredTo === 'countryside-acres');

  // Compute raw scores for every player.  ME-loser totals will be forced
  // to 0 below.
  const rawScores = {};
  for (const p of state.players) {
    rawScores[p.userId] = computeFinalScore(p, state.config.settings);
  }

  // Determine winners.
  let winners = [];
  if (meRetirees.length > 0) {
    const maxCash = Math.max(...meRetirees.map((p) => p.cash));
    winners = meRetirees.filter((p) => p.cash === maxCash);
  } else if (caRetirees.length > 0) {
    const maxTotal = Math.max(...caRetirees.map((p) => rawScores[p.userId].total));
    winners = caRetirees.filter((p) => rawScores[p.userId].total === maxTotal);
  } else {
    // No retirees at all — shouldn't reach finalizeGame in that case, but
    // be defensive.  No winner.
    winners = [];
  }

  // Build the finalScores payload.  ME losers have their total zeroed
  // per the cash-gamble rule.
  const winnerIdSet = new Set(winners.map((p) => p.userId));
  const finalScores = {};
  for (const p of state.players) {
    const score = rawScores[p.userId];
    const isMeLoser = p.retiredTo === 'millionaire-estates' && !winnerIdSet.has(p.userId);
    finalScores[p.userId] = {
      cash: score.cash,
      house: score.house,
      lifeTilesValue: score.lifeTilesValue,
      childrenBonus: score.childrenBonus,
      total: isMeLoser ? 0 : score.total,
      retiredTo: p.retiredTo,
      lifeTiles: p.lifeTiles || [],
    };
  }

  const winnerIds = winners.map((p) => p.userId);
  const winnerUsernames = winners.map((p) => p.username);
  state.winner = winnerIds.length === 1 ? winnerIds[0] : winnerIds;

  if (winnerUsernames.length === 1) {
    log(state, `${winnerUsernames[0]} wins the game!`, 'game');
  } else if (winnerUsernames.length > 0) {
    log(state, `Tie! ${winnerUsernames.join(' & ')} all win.`, 'game');
  } else {
    log(state, 'Game over — no winner', 'game');
  }
  events.push(
    event('GAME_OVER', {
      winner: state.winner,
      winnerUsername: winnerUsernames.length === 1 ? winnerUsernames[0] : winnerUsernames,
      finalScores,
    }),
  );
}

function advanceTurn(state, fromIdx, events) {
  // Mutates state and the supplied events array.  Picks the next active,
  // non-retired player in cyclic order.  If every player has retired, the
  // game ends and finalizeGame populates state.winner + GAME_OVER.
  const cur = state.players[fromIdx];
  cur.midTurn = false; // the outgoing player's mid-resolution flag is cleared on turn end
  events.push(event('TURN_ENDED', { username: cur.username }));

  // Game-over check: every remaining active player is retired.  This is the
  // session-2b end-game trigger.  finalizeGame mutates state.status,
  // state.winner, and appends GAME_OVER to events.
  const allRetired = state.players.every((p) => p.active === false || p.retired === true);
  if (allRetired) {
    finalizeGame(state, events);
    return;
  }

  let nextIdx = (fromIdx + 1) % state.players.length;
  let hops = 0;
  while (hops < state.players.length) {
    const candidate = state.players[nextIdx];
    if (candidate.active !== false && candidate.retired !== true) break;
    nextIdx = (nextIdx + 1) % state.players.length;
    hops++;
  }
  state.turnState.currentPlayerIndex = nextIdx;
  const next = state.players[nextIdx];
  log(state, `It is now ${next.username}'s turn`, 'turn');
  events.push(event('TURN_STARTED', { username: next.username, playerIndex: nextIdx }));
}

function maybeAdvanceTurn(state, playerIdx, events) {
  const cur = state.players[playerIdx];
  if (!hasPendingChoice(cur) && !cur.spinAgain) {
    advanceTurn(state, playerIdx, events);
  }
}

// ── actions ──────────────────────────────────────────────────────────────────

function spinAction(state, userId) {
  const events = [];
  const playerIdx = state.turnState.currentPlayerIndex;
  const player = state.players[playerIdx];
  if (player.userId !== userId) return { state, events, error: 'Not your turn' };
  if (state.status !== 'playing') {
    return { state, events, error: 'Game is not in playing state' };
  }
  if (hasPendingChoice(player)) {
    return { state, events, error: 'You have a pending choice to make first' };
  }

  state = clone(state);
  const cur = state.players[playerIdx];
  cur.spinAgain = false; // consume the bonus if any
  cur.midTurn = true; // entering resolution chain — cleared in advanceTurn

  const value = rollSpin(state.config.settings);
  log(state, `${cur.username} spun ${value}`, 'spin');
  events.push(event('SPINNER_RESULT', { username: cur.username, value }));

  // Stock payouts — fire BEFORE movement so the payout amount is in player
  // cash by the time the landing-square effect resolves.  The payout
  // applies to every player whose stockNumber matches the spin value,
  // including the spinner.  This is the cross-turn mutation the session
  // 2a spec calls out as the unusual case.
  payoutStocks(state, value, events);

  // Walk `value` steps along the board, always taking next[0] at every
  // square.  This includes passthrough forks — per the session-1 spec they
  // are NOT player choices during traversal; only land-on forks gate.
  const from = cur.position;
  let pos = from;
  for (let step = 0; step < value; step++) {
    const sq = state.config.boardById[pos];
    if (!sq.next || sq.next.length === 0) break; // stop at terminal
    pos = sq.next[0];
  }
  cur.position = pos;
  log(state, `${cur.username} moved to ${pos}`, 'move');
  events.push(event('PLAYER_MOVED', { username: cur.username, from, to: pos }));

  // Resolve the landing square's effect.
  const landedSq = state.config.boardById[pos];
  events.push(...resolveEffect(state, playerIdx, landedSq));

  maybeAdvanceTurn(state, playerIdx, events);
  return { state, events };
}

/**
 * For each player whose stockNumber matches `value`, credit the configured
 * stock payout from the bank and emit a STOCK_PAYOUT event.  Mutates
 * state.players and the supplied events array.
 *
 * Runs on EVERY spin regardless of whose turn it is — that's the canonical
 * Life stock rule.  Note this is a multi-player mutation triggered by one
 * player's action, which the framework's broadcast layer handles fine: the
 * full state is re-emitted after any applyAction.
 */
function payoutStocks(state, value, events) {
  const amount = state.config.settings.stockPayoutAmount;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p.stockNumber !== value) continue;
    if (p.active === false) continue;
    p.cash += amount;
    log(state, `${p.username} earned $${amount} from stock #${value}`, 'money');
    events.push(event('STOCK_PAYOUT', { username: p.username, number: value, amount }));
  }
}

function chooseBranch(state, userId, nextSquareId) {
  const events = [];
  const playerIdx = state.turnState.currentPlayerIndex;
  const player = state.players[playerIdx];
  if (player.userId !== userId) return { state, events, error: 'Not your turn' };
  if (
    !player.pending ||
    (player.pending.type !== 'fork' && player.pending.type !== 'retirement-fork')
  ) {
    return { state, events, error: 'No pending fork choice' };
  }
  if (!player.pending.options.includes(nextSquareId)) {
    return { state, events, error: `Invalid branch choice "${nextSquareId}"` };
  }

  state = clone(state);
  const cur = state.players[playerIdx];
  cur.midTurn = true;
  const from = cur.position;
  cur.pending = null;
  cur.position = nextSquareId;

  // Record path on the start-fork choice so career-card filtering knows
  // which pool a player belongs to (useful for session-2 features that
  // gate on path).
  if (from === state.config.settings.startSquareId) {
    const startSq = state.config.boardById[from];
    const branch = startSq.data?.branches?.find((b) => b.id === nextSquareId);
    if (branch?.path) cur.path = branch.path;
  }

  log(state, `${cur.username} chose branch ${nextSquareId}`, 'fork');
  events.push(event('BRANCH_CHOSEN', { username: cur.username, from, to: nextSquareId }));
  events.push(
    event('PLAYER_MOVED', { username: cur.username, from, to: nextSquareId, reason: 'branch' }),
  );

  const sq = state.config.boardById[nextSquareId];
  events.push(...resolveEffect(state, playerIdx, sq));

  maybeAdvanceTurn(state, playerIdx, events);
  return { state, events };
}

function chooseCareer(state, userId, cardId) {
  const events = [];
  const playerIdx = state.turnState.currentPlayerIndex;
  const player = state.players[playerIdx];
  if (player.userId !== userId) return { state, events, error: 'Not your turn' };
  if (!player.pending || player.pending.type !== 'career-draw') {
    return { state, events, error: 'No pending career choice' };
  }
  if (!player.pending.options.includes(cardId)) {
    return { state, events, error: `Invalid career choice "${cardId}"` };
  }

  state = clone(state);
  const cur = state.players[playerIdx];
  cur.midTurn = true;
  const careersById = {};
  for (const c of state.config.careers) careersById[c.id] = c;
  const chosen = careersById[cardId];
  cur.career = chosen;

  // Return unchosen options to the bottom of the deck — same as Monopoly's
  // card handling.  When the deck eventually empties, the discard pile is
  // reshuffled back in.
  for (const otherId of cur.pending.options) {
    if (otherId !== cardId) state.careerDeck.push(otherId);
  }
  cur.pending = null;

  log(state, `${cur.username} chose career: ${chosen.name}`, 'card');
  events.push(event('CAREER_CHOSEN', { username: cur.username, card: chosen }));

  // Chain straight into the salary draw — in canonical Life the two cards are
  // handed to the player at the same moment of "starting your career."
  events.push(...drawSalaryCards(state, playerIdx));

  // Salary draw is now pending — do not advance the turn.
  return { state, events };
}

function chooseSalary(state, userId, cardId) {
  const events = [];
  const playerIdx = state.turnState.currentPlayerIndex;
  const player = state.players[playerIdx];
  if (player.userId !== userId) return { state, events, error: 'Not your turn' };
  if (!player.pending || player.pending.type !== 'salary-draw') {
    return { state, events, error: 'No pending salary choice' };
  }
  if (!player.pending.options.includes(cardId)) {
    return { state, events, error: `Invalid salary choice "${cardId}"` };
  }

  state = clone(state);
  const cur = state.players[playerIdx];
  cur.midTurn = true;
  const salariesById = {};
  for (const c of state.config.salaries) salariesById[c.id] = c;
  const chosen = salariesById[cardId];
  cur.salary = chosen;

  for (const otherId of cur.pending.options) {
    if (otherId !== cardId) state.salaryDeck.push(otherId);
  }
  cur.pending = null;

  log(state, `${cur.username} chose salary: $${chosen.amount}`, 'card');
  events.push(event('SALARY_CHOSEN', { username: cur.username, card: chosen }));

  maybeAdvanceTurn(state, playerIdx, events);
  return { state, events };
}

function endTurnAction(state, userId) {
  const events = [];
  const playerIdx = state.turnState.currentPlayerIndex;
  const player = state.players[playerIdx];
  if (player.userId !== userId) return { state, events, error: 'Not your turn' };
  if (hasPendingChoice(player)) {
    return { state, events, error: 'Resolve pending choices before ending your turn' };
  }
  state = clone(state);
  state.players[playerIdx].spinAgain = false;
  advanceTurn(state, playerIdx, events);
  return { state, events };
}

// ── out-of-band purchases (insurance and stocks) ─────────────────────────────
//
// These actions are available throughout a player's turn EXCEPT when a
// pending choice or mid-turn resolution is in flight.  See
// `assertCanPurchase` for the unified guard.  None of these change the
// turn order; they only mutate the active player's record.

function assertCanPurchase(state, userId, action) {
  if (state.status !== 'playing') return { error: 'Game is not in playing state' };
  const playerIdx = state.turnState.currentPlayerIndex;
  const player = state.players[playerIdx];
  if (!player || player.userId !== userId) return { error: 'Not your turn' };
  if (hasPendingChoice(player)) {
    return { error: `Cannot ${action} while a pending choice is open` };
  }
  if (player.midTurn) {
    return { error: `Cannot ${action} mid-turn — finish your current action first` };
  }
  return { playerIdx, player };
}

function buyAutoInsurance(state, userId) {
  const events = [];
  const check = assertCanPurchase(state, userId, 'buy auto insurance');
  if (check.error) return { state, events, error: check.error };
  const player = check.player;
  if (player.autoInsurance) return { state, events, error: 'You already own auto insurance' };
  const cost = state.config.settings.autoInsuranceCost;
  if (player.cash < cost) {
    return { state, events, error: `Cannot afford auto insurance ($${cost})` };
  }

  state = clone(state);
  const cur = state.players[check.playerIdx];
  cur.cash -= cost;
  cur.autoInsurance = true;
  log(state, `${cur.username} bought auto insurance for $${cost}`, 'info');
  events.push(
    event('INSURANCE_PURCHASED', { username: cur.username, insuranceType: 'auto', cost }),
  );
  return { state, events };
}

function buyLifeInsurance(state, userId) {
  const events = [];
  const check = assertCanPurchase(state, userId, 'buy life insurance');
  if (check.error) return { state, events, error: check.error };
  const player = check.player;
  if (player.lifeInsurance) return { state, events, error: 'You already own life insurance' };
  const cost = state.config.settings.lifeInsuranceCost;
  if (player.cash < cost) {
    return { state, events, error: `Cannot afford life insurance ($${cost})` };
  }

  state = clone(state);
  const cur = state.players[check.playerIdx];
  cur.cash -= cost;
  cur.lifeInsurance = true;
  log(state, `${cur.username} bought life insurance for $${cost}`, 'info');
  events.push(
    event('INSURANCE_PURCHASED', { username: cur.username, insuranceType: 'life', cost }),
  );
  return { state, events };
}

function buyStock(state, userId, number) {
  const events = [];
  const check = assertCanPurchase(state, userId, 'buy a stock');
  if (check.error) return { state, events, error: check.error };
  const player = check.player;
  if (player.stockNumber !== null && player.stockNumber !== undefined) {
    return { state, events, error: 'You already own a stock' };
  }
  const { spinMin, spinMax, stockCost } = state.config.settings;
  if (!Number.isInteger(number) || number < spinMin || number > spinMax) {
    return {
      state,
      events,
      error: `Stock number must be an integer in [${spinMin}, ${spinMax}]`,
    };
  }
  for (const other of state.players) {
    if (other.userId === userId) continue;
    if (other.stockNumber === number) {
      return {
        state,
        events,
        error: `Stock number ${number} is already owned by ${other.username}`,
      };
    }
  }
  if (player.cash < stockCost) {
    return { state, events, error: `Cannot afford stock ($${stockCost})` };
  }

  state = clone(state);
  const cur = state.players[check.playerIdx];
  cur.cash -= stockCost;
  cur.stockNumber = number;
  log(state, `${cur.username} bought stock #${number} for $${stockCost}`, 'info');
  events.push(event('STOCK_PURCHASED', { username: cur.username, number, cost: stockCost }));
  return { state, events };
}

function skipTurn(state, userId) {
  const events = [];
  const playerIdx = state.turnState.currentPlayerIndex;
  if (playerIdx < 0 || !state.players[playerIdx] || state.players[playerIdx].userId !== userId) {
    return { state, events, error: "Not this player's turn" };
  }
  state = clone(state);
  const cur = state.players[playerIdx];
  // Defensively clear any pending state so the next player can act cleanly.
  cur.pending = null;
  cur.spinAgain = false;
  log(state, `${cur.username}'s turn was skipped`, 'info');
  events.push(event('TURN_SKIPPED', { username: cur.username }));
  advanceTurn(state, playerIdx, events);
  return { state, events };
}

// ── interface implementation ─────────────────────────────────────────────────

function createInitialPlayer(user, existingPlayers = [], config = null) {
  if (!config?.settings?.playerColors || !config?.settings?.playerTokens) {
    throw new Error(
      'createInitialPlayer requires a config with settings.playerColors and settings.playerTokens',
    );
  }
  const idx = existingPlayers.length;
  const colorObj = config.settings.playerColors[idx] || config.settings.playerColors[0];
  const token = config.settings.playerTokens[idx] || config.settings.playerTokens[0];
  return {
    userId: user.id,
    username: user.username,
    color: colorObj.id,
    colorHex: colorObj.hex,
    token,
    active: true,
    connected: true,
    cash: 0,
    position: '',
    path: null,
    career: null,
    salary: null,
    spouse: false,
    children: 0,
    autoInsurance: false,
    lifeInsurance: false,
    stockNumber: null,
    midTurn: false,
    retired: false,
    retiredTo: null,
    lifeTiles: [],
    pending: null,
    spinAgain: false,
  };
}

function initGame(gameId, name, playerList, config) {
  const cfg = config || configLoader.getConfigCopy();
  const startId = cfg.settings.startSquareId;
  const startSq = cfg.boardById[startId];
  const initialFork = startSq.next.slice();

  const players = playerList.map((p) => ({
    ...p,
    cash: cfg.settings.startingCash,
    position: startId,
    path: null,
    career: null,
    salary: null,
    spouse: false,
    children: 0,
    autoInsurance: false,
    lifeInsurance: false,
    stockNumber: null,
    midTurn: false,
    retired: false,
    retiredTo: null,
    lifeTiles: [],
    // Each player owes the server a Career-vs-College decision before
    // their first spin.  Setting it on all players up front means the
    // gating logic doesn't need a special "first turn" case.
    pending: { type: 'fork', options: initialFork.slice() },
    spinAgain: false,
  }));

  return {
    id: gameId,
    name,
    gameType: 'life',
    stateVersion: STATE_VERSION,
    status: 'playing',
    config: cfg,
    players,
    turnState: { currentPlayerIndex: 0 },
    careerDeck: shuffle(cfg.careers.map((c) => c.id)),
    careerDiscard: [],
    salaryDeck: shuffle(cfg.salaries.map((c) => c.id)),
    salaryDiscard: [],
    lifeTileDeck: shuffle(cfg.lifeTiles.map((t) => t.id)),
    winner: null,
    log: [{ timestamp: Date.now(), message: 'Game started!', type: 'info' }],
  };
}

function applyAction(state, userId, action, payload = {}) {
  // A retired player has reached the end of their road — no more actions.
  // The framework's turn rotation skips them, but a misdirected client
  // action lands here and we reject it cleanly.
  const acting = state.players.find((p) => p.userId === userId);
  if (acting?.retired === true) {
    return { state, events: [], error: 'You are retired — no further actions' };
  }
  switch (action) {
    case 'spin':
      return spinAction(state, userId);
    case 'chooseBranch':
      return chooseBranch(state, userId, payload.nextSquareId);
    case 'chooseCareer':
      return chooseCareer(state, userId, payload.cardId);
    case 'chooseSalary':
      return chooseSalary(state, userId, payload.cardId);
    case 'buyAutoInsurance':
      return buyAutoInsurance(state, userId);
    case 'buyLifeInsurance':
      return buyLifeInsurance(state, userId);
    case 'buyStock':
      return buyStock(state, userId, payload.number);
    case 'endTurn':
      return endTurnAction(state, userId);
    case 'skipTurn':
      return skipTurn(state, userId);
    default:
      return { state, events: [], error: `Unknown action: ${action}` };
  }
}

function getCurrentPlayer(state) {
  if (!state || state.status !== 'playing') return null;
  const cur = state.players?.[state.turnState?.currentPlayerIndex];
  // A retired player is "in the game" but not "the current player" — the
  // framework uses null to mean "no one is acting right now," which is the
  // right signal while the rotation skips past retired players.
  if (!cur || cur.active === false || cur.retired === true) return null;
  return { userId: cur.userId, username: cur.username };
}

function isTurnTimerBlocked(state) {
  // Block the turn timer whenever the current player has a pending choice;
  // the framework should not auto-skip a player mid-decision.
  const cur = state?.players?.[state?.turnState?.currentPlayerIndex];
  if (!cur) return false;
  return hasPendingChoice(cur);
}

function getValidActions(state, userId) {
  if (!state || state.status !== 'playing') return [];
  const cur = state.players?.[state.turnState?.currentPlayerIndex];
  if (!cur || cur.userId !== userId) return [];
  if (cur.pending?.type === 'fork' || cur.pending?.type === 'retirement-fork') {
    return ['chooseBranch'];
  }
  if (cur.pending?.type === 'career-draw') return ['chooseCareer'];
  if (cur.pending?.type === 'salary-draw') return ['chooseSalary'];
  const actions = ['spin'];
  // Out-of-band purchases are only valid at the start of a clean turn —
  // not during a spin-again chain (midTurn=true) and not during any
  // pending choice (handled above).  We rely on midTurn to be cleared
  // by advanceTurn before the next player's turn begins.
  if (!cur.midTurn) {
    if (!cur.autoInsurance) actions.push('buyAutoInsurance');
    if (!cur.lifeInsurance) actions.push('buyLifeInsurance');
    if (cur.stockNumber === null || cur.stockNumber === undefined) actions.push('buyStock');
  }
  return actions;
}

function getGameMetadata() {
  return {
    name: 'The Game of Life',
    description: 'Career, family, fortune — spin the wheel and travel the road of Life.',
    icon: '🚗',
    minPlayers: 2,
    maxPlayers: 6,
    estimatedDurationMinutes: 45,
    complexity: 'medium',
    tags: ['family', 'classic', 'spinner', 'branching-board', 'economic'],
  };
}

function loadConfig() {
  return configLoader.loadConfig();
}

function getConfigCopy() {
  return configLoader.getConfigCopy();
}

function migrate(state) {
  let s = state;
  if (s.stateVersion < 2) {
    // v1 → v2 (session 2a): added session-2a fields to the player record.
    // `spouse` flipped from a `null | something` placeholder to a strict
    // boolean.  `children` already existed but is reaffirmed as a number.
    s = {
      ...s,
      players: s.players.map((p) => ({
        ...p,
        spouse: p.spouse === true,
        children: typeof p.children === 'number' ? p.children : 0,
        autoInsurance: p.autoInsurance === true,
        lifeInsurance: p.lifeInsurance === true,
        stockNumber: typeof p.stockNumber === 'number' ? p.stockNumber : null,
        midTurn: p.midTurn === true,
      })),
      stateVersion: 2,
    };
  }
  if (s.stateVersion < 3) {
    // v2 → v3 (session 2b prelude): collapse the three pending-state fields
    // (pendingForkChoice / pendingCareerDrawOptions / pendingSalaryDrawOptions)
    // into a single discriminated union `pending = { type, options } | null`.
    s = {
      ...s,
      players: s.players.map((p) => {
        const { pendingForkChoice, pendingCareerDrawOptions, pendingSalaryDrawOptions, ...rest } =
          p;
        let pending = null;
        if (Array.isArray(pendingForkChoice) && pendingForkChoice.length > 0) {
          pending = { type: 'fork', options: pendingForkChoice };
        } else if (Array.isArray(pendingCareerDrawOptions) && pendingCareerDrawOptions.length > 0) {
          pending = { type: 'career-draw', options: pendingCareerDrawOptions };
        } else if (Array.isArray(pendingSalaryDrawOptions) && pendingSalaryDrawOptions.length > 0) {
          pending = { type: 'salary-draw', options: pendingSalaryDrawOptions };
        }
        return { ...rest, pending };
      }),
      stateVersion: 3,
    };
  }
  if (s.stateVersion < 4) {
    // v3 → v4 (session 2b): add retiredTo + lifeTileDeck.  `retired` and
    // `lifeTiles` already existed as session-2b placeholders since session
    // 1, so we only need to add the new fields with safe defaults.
    s = {
      ...s,
      players: s.players.map((p) => ({
        ...p,
        retiredTo: typeof p.retiredTo === 'string' ? p.retiredTo : null,
        lifeTiles: Array.isArray(p.lifeTiles) ? p.lifeTiles : [],
      })),
      lifeTileDeck: Array.isArray(s.lifeTileDeck) ? s.lifeTileDeck : [],
      stateVersion: 4,
    };
  }
  if (s.stateVersion !== STATE_VERSION) {
    throw new Error(
      `[life] No migration path from stateVersion ${state.stateVersion} to ${STATE_VERSION}`,
    );
  }
  return s;
}

/**
 * Filter game state for a specific player.  Life is mostly perfect-information,
 * but life tiles (drawn at CA retirement) are hidden information until game
 * over — the same way Battleship hides fleet placement until the game ends.
 *
 * For each player that isn't `userId`, replace their `lifeTiles` array with
 * a `lifeTilesCount: number` and drop the values.  Once `state.status` is
 * `'finished'`, every tile is revealed — game-over erases the hidden-info
 * convention by design.
 *
 * Waiting-room safety: optional chaining throughout; safe to call on
 * pre-initGame states where `players` or per-player fields may be missing.
 */
function getStateForPlayer(state, userId) {
  // Pre-initGame waiting-room safety: if the state isn't well-formed yet,
  // hand it back unchanged.  The framework calls this with placeholder
  // states before initGame has populated player records.
  if (!state || !Array.isArray(state.players)) {
    return state;
  }
  // Game over reveals all tiles — same convention as Battleship's fleet
  // reveal.  The hidden-info filter is only meaningful during play.
  if (state.status === 'finished') return state;
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.userId === userId) return p;
      const { lifeTiles, ...rest } = p;
      return { ...rest, lifeTilesCount: Array.isArray(lifeTiles) ? lifeTiles.length : 0 };
    }),
  };
}

module.exports = {
  // ── GameLogic interface ──────────────────────────────────────────────────
  STATE_VERSION,
  initGame,
  createInitialPlayer,
  applyAction,
  skipTurn,
  getCurrentPlayer,
  isTurnTimerBlocked,
  getValidActions,
  getGameMetadata,
  loadConfig,
  getConfigCopy,
  // Custom filter — life tiles are hidden until game over.  See above.
  getStateForPlayer,
  migrate,

  // ── Internal helpers (exported for tests) ────────────────────────────────
  EFFECTS,
  resolveEffect,
  drawOptionsFromDeck,
  hasPendingChoice,
  computeFinalScore,
};

validateImplementation(module.exports, {
  internalExports: [
    'EFFECTS',
    'resolveEffect',
    'drawOptionsFromDeck',
    'hasPendingChoice',
    'computeFinalScore',
  ],
});
