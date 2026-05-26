/**
 * board-view.js
 *
 * The Life board itself: 64 squares laid out as a hybrid stylized canonical
 * board (layout (iii) from the spec).  Owns the board DOM, player cars,
 * and the step-by-step movement animation.
 *
 * ─── Layout strategy ────────────────────────────────────────────────────────
 *
 * Squares are positioned on a CSS grid with hand-tuned column/row coords
 * (see LIFE_BOARD_LAYOUT).  Each path is a horizontal "lane":
 *
 *   row 0:  College path — 12 squares left-to-right
 *   row 2:  Start square (col 0); main track first leg (cols 1-10)
 *   row 4:  Career path — 10 squares left-to-right
 *   row 6:  Main track second leg (snakes right-to-left)
 *   row 8:  Main track third leg (snakes left-to-right)
 *   row 10: Main track fourth leg + retirement fork + terminal paths
 *
 * Adjacency between rows is shown with explicit arrows so a player can
 * trace their path visually.  The layout doesn't perfectly mirror the
 * canonical Life board — that would require pixel-perfect path-tracing
 * for 64 squares — but the structural features (college branch top,
 * career branch middle, retirement at the end) are preserved.
 *
 * ─── Movement animation ────────────────────────────────────────────────────
 *
 * On PLAYER_MOVED, we walk the path from `from` to `to` by repeatedly
 * taking next[0] (matches the server's traversal rule).  Each step moves
 * the car ~150ms via a CSS transform transition.  A spin of 1 → 150ms;
 * a spin of 10 → 1.5s.
 *
 * For chooseBranch events (movement to a chosen fork target), the
 * destination is one square away so the animation is a single step.
 *
 * Stub-bump events (marry/baby/twins move the player to the next square
 * after the effect resolves) also produce single-step animations.
 *
 * ─── Multi-player stacking ─────────────────────────────────────────────────
 *
 * Multiple players on one square render as stacked cars: each subsequent
 * car offsets by (4px right, 4px down) and bumps z-index.  At the start
 * of the game when all 6 players are on sq-000-start, this stacks 6 cars
 * with a slight cascade.
 *
 * ─── Retired-player display ────────────────────────────────────────────────
 *
 * Retired players' cars stay on the retirement terminal square they
 * reached, with reduced opacity (.4) and a small ✓ badge.  No separate
 * "retired" panel — the spec asked for the in-board approach.
 */

const LifeBoardView = (() => {
  // Per-square grid coordinates.  col/row indices are 1-based for CSS grid.
  // The retirement fork (sq-m35) lives next to its CA/ME branches at the
  // right end of the board.
  //
  // To keep this readable: each line is one square's coordinates.  The
  // pattern is laid out so visually-adjacent squares on the board are
  // also adjacent in this map.
  const LIFE_BOARD_LAYOUT = {
    'sq-000-start': { col: 1, row: 3 },

    // ── college path (top lane) — row 1 ─────────────────────────────────
    'sq-u01-college-loan': { col: 2, row: 1 },
    'sq-u02-study-hard': { col: 3, row: 1 },
    'sq-u03-spring-break': { col: 4, row: 1 },
    'sq-u04-cram': { col: 5, row: 1 },
    'sq-u05-tutor-job': { col: 6, row: 1 },
    'sq-u06-grad-school': { col: 7, row: 1 },
    'sq-u07-internship': { col: 8, row: 1 },
    'sq-u08-graduate': { col: 9, row: 1 },
    'sq-u09-career-pick': { col: 10, row: 1 },
    'sq-u10-payday': { col: 11, row: 1 },
    'sq-u11-honeymoon-fund': { col: 12, row: 1 },
    'sq-u12-junction': { col: 13, row: 1 },

    // ── career path (middle-lower lane) — row 5 ─────────────────────────
    'sq-c01-career-pick': { col: 2, row: 5 },
    'sq-c02-pay-furniture': { col: 3, row: 5 },
    'sq-c03-first-paycheck': { col: 4, row: 5 },
    'sq-c04-buy-car': { col: 5, row: 5 },
    'sq-c05-payday': { col: 6, row: 5 },
    'sq-c06-win-contest': { col: 7, row: 5 },
    'sq-c07-traffic-ticket': { col: 8, row: 5 },
    'sq-c08-spin-again': { col: 9, row: 5 },
    'sq-c09-payday': { col: 10, row: 5 },
    'sq-c10-junction': { col: 11, row: 5 },

    // ── main track leg 1 (after both paths merge, going right) — row 3 ──
    'sq-m01-marry': { col: 14, row: 3 },
    'sq-m02-wedding-gifts': { col: 15, row: 3 },
    'sq-m03-buy-home': { col: 16, row: 3 },
    'sq-m04-payday': { col: 17, row: 3 },
    'sq-m05-vacation': { col: 18, row: 3 },
    'sq-m06-night-class': { col: 19, row: 3 },
    'sq-m07-promotion': { col: 20, row: 3 },
    'sq-m08-have-baby': { col: 21, row: 3 },
    'sq-m09-baby-gifts': { col: 22, row: 3 },

    // ── main track leg 2 (going right, row 7) ──
    'sq-m10-pay-tax': { col: 22, row: 7 },
    'sq-m11-payday': { col: 21, row: 7 },
    'sq-m12-spin-again': { col: 20, row: 7 },
    'sq-m13-have-twins': { col: 19, row: 7 },
    'sq-m14-twin-daycare': { col: 18, row: 7 },
    'sq-m15-stock-bonus': { col: 17, row: 7 },
    'sq-m16-payday': { col: 16, row: 7 },
    'sq-m17-auto-accident': { col: 15, row: 7 },
    'sq-m18-collect-each': { col: 14, row: 7 },
    'sq-m19-payday': { col: 13, row: 7 },
    'sq-m20-pay-each': { col: 12, row: 7 },
    'sq-m21-illness': { col: 11, row: 7 },
    'sq-m22-home-improvement': { col: 10, row: 7 },
    'sq-m23-payday': { col: 9, row: 7 },
    'sq-m24-have-baby': { col: 8, row: 7 },
    'sq-m25-baby-gifts': { col: 7, row: 7 },

    // ── main track leg 3 (going right, row 9) ──
    'sq-m26-win-lottery': { col: 7, row: 9 },
    'sq-m27-payday': { col: 8, row: 9 },
    'sq-m28-car-trouble': { col: 9, row: 9 },
    'sq-m29-spin-again': { col: 10, row: 9 },
    'sq-m30-business-trip': { col: 11, row: 9 },
    'sq-m31-payday': { col: 12, row: 9 },
    'sq-m32-jury-duty': { col: 13, row: 9 },
    'sq-m33-vacation': { col: 14, row: 9 },
    'sq-m34-payday': { col: 15, row: 9 },
    'sq-m35-retirement-fork': { col: 16, row: 9, kind: 'retirement-fork' },

    // ── retirement: countryside (above) and millionaire (below) ──
    'sq-r-countryside-01': { col: 17, row: 8 },
    'sq-r-countryside-02': { col: 18, row: 8 },
    'sq-r-countryside-end': { col: 19, row: 8, kind: 'terminal-ca' },
    'sq-r-millionaire-01': { col: 17, row: 10 },
    'sq-r-millionaire-02': { col: 18, row: 10 },
    'sq-r-millionaire-end': { col: 19, row: 10, kind: 'terminal-me' },
  };

  // Effect-type → short visual hint (emoji or letter) shown in the corner of
  // each square so a player can scan the board at a glance.  Not a full
  // legend — the square label is the authoritative text.
  const EFFECT_ICONS = {
    'career-fork': '🔀',
    'draw-career-no-degree': '💼',
    'draw-career-degree': '🎓',
    'draw-salary': '💵',
    'pay-loans': '🏦',
    'pay-bank': '💸',
    'pay-tax-by-salary': '🧾',
    'collect-bank': '💰',
    'pay-each-player': '👥💸',
    'collect-each-player': '👥💰',
    payday: '🤑',
    'spin-again': '🔄',
    marry: '💍',
    'have-baby': '👶',
    'have-twins': '👶👶',
    'buy-house': '🏠',
    'auto-accident': '🚗💥',
    'life-accident': '🏥',
    'retirement-fork': '🌅',
    'countryside-retirement': '🌳',
    'millionaire-retirement': '💎',
  };

  const STEP_DURATION_MS = 150;

  // ── module state ────────────────────────────────────────────────────────

  let _container = null;
  let _boardEl = null;
  let _myUserId = null;
  // Map square ID → cell DOM element.
  let _squareEls = new Map();
  // Map user ID → car DOM element.
  let _carEls = new Map();
  // Last known positions, for animation diffing.  Map user ID → square ID.
  let _lastPositions = new Map();
  // The "highlighted" square (current player's active pending decision).
  let _highlightedSquareId = null;
  // Per-player animation queues.  Each entry is a { from, to } pair.
  // Queueing is needed because a single turn can emit multiple PLAYER_MOVED
  // events (the spin movement plus a stub-bump for marry/baby/twins/
  // retirement-fork) and we want each one to animate visibly rather than
  // collapsing into a single CSS transition.
  let _animQueue = new Map();
  let _animRunning = new Map();
  // Cached config.boardById so animation paths can be computed from
  // server state (which carries the full config).
  let _boardById = null;

  // ── public mount/update/unmount ─────────────────────────────────────────

  function mount(container, state, myUserId) {
    _container = container;
    _myUserId = myUserId;
    _boardById = state.config.boardById;
    _squareEls = new Map();
    _carEls = new Map();
    _lastPositions = new Map();
    _animQueue = new Map();
    _animRunning = new Map();
    _highlightedSquareId = null;

    container.innerHTML = '';

    _boardEl = document.createElement('div');
    _boardEl.className = 'life-board';
    container.appendChild(_boardEl);

    // Render all squares once.  Squares don't change shape across the game
    // — only the cars on top of them move — so a one-time render keeps
    // update() cheap.
    for (const sq of state.config.board) {
      const cell = buildSquareCell(sq);
      _boardEl.appendChild(cell);
      _squareEls.set(sq.id, cell);
    }

    // Render player cars at their initial positions.  All players start at
    // sq-000-start, so this places 2-6 cars on the same square.  Stacking
    // logic in placeCarOnSquare handles the visual offset.
    for (const player of state.players) {
      const car = buildPlayerCar(player);
      _boardEl.appendChild(car);
      _carEls.set(player.userId, car);
      placeCarOnSquare(car, player.position, indexInStack(state, player));
      _lastPositions.set(player.userId, player.position);
    }
  }

  function update(state) {
    if (!_boardEl) return;
    // Update player car visuals (color, peg count, retired styling) and
    // resolve any positions that drifted from animation state — when the
    // animation completes the car is on `to`; if a state arrives where
    // the player is on a different square (e.g. branch choice), snap them
    // there.
    for (const player of state.players) {
      let car = _carEls.get(player.userId);
      if (!car) {
        car = buildPlayerCar(player);
        _boardEl.appendChild(car);
        _carEls.set(player.userId, car);
      }
      updateCarAppearance(car, player);
      // If our last-known position diverges from server-truth AND there's
      // no animation in progress for this player, snap to truth.  This
      // handles full-state syncs on rejoin.
      const lastPos = _lastPositions.get(player.userId);
      if (lastPos !== player.position && !isAnimating(player.userId)) {
        placeCarOnSquare(car, player.position, indexInStack(state, player));
        _lastPositions.set(player.userId, player.position);
      }
    }

    // Restack all cars — when one player moves, the stack on the source
    // and destination squares can change for everyone.
    restackAll(state);

    // Highlight: surface the current player's pending-decision square.
    const cur = state.players[state.turnState?.currentPlayerIndex];
    let highlight = null;
    if (cur && !cur.retired && cur.pending) {
      highlight = cur.position;
    }
    setHighlight(highlight);
  }

  function onEvent(event, state) {
    if (event.type === 'PLAYER_MOVED') {
      handleMoveEvent(event, state);
    } else if (event.type === 'BRANCH_CHOSEN') {
      // BRANCH_CHOSEN is immediately followed by PLAYER_MOVED for the same
      // player; the move handler will animate.  Nothing extra to do.
    }
  }

  function unmount() {
    if (_container) _container.innerHTML = '';
    _container = null;
    _boardEl = null;
    _myUserId = null;
    _squareEls = new Map();
    _carEls = new Map();
    _lastPositions = new Map();
    _animQueue = new Map();
    _animRunning = new Map();
    _highlightedSquareId = null;
    _boardById = null;
  }

  // ── square cell construction ────────────────────────────────────────────

  function buildSquareCell(sq) {
    const cell = document.createElement('div');
    const layout = LIFE_BOARD_LAYOUT[sq.id];
    cell.className = `life-square life-square-${sq.type}`;
    if (layout?.kind) cell.classList.add(`life-square-${layout.kind}`);
    cell.dataset.squareId = sq.id;
    if (layout) {
      cell.style.gridColumn = String(layout.col);
      cell.style.gridRow = String(layout.row);
    } else {
      // Off-board square (shouldn't happen — every square ID is in
      // LIFE_BOARD_LAYOUT).  Park it in the corner so it doesn't break
      // the grid silently.
      cell.style.gridColumn = '1';
      cell.style.gridRow = '11';
      console.warn(`[life-board-view] no layout coords for "${sq.id}"`);
    }

    const icon = document.createElement('span');
    icon.className = 'life-square-icon';
    icon.textContent = EFFECT_ICONS[sq.type] || '·';
    cell.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'life-square-label';
    label.textContent = sq.label;
    label.title = sq.label;
    cell.appendChild(label);

    return cell;
  }

  // ── player car construction ─────────────────────────────────────────────

  function buildPlayerCar(player) {
    const car = document.createElement('div');
    car.className = 'life-car';
    car.dataset.userId = player.userId;
    const colorHex = player.colorHex || '#888';
    car.style.background = colorHex;
    car.style.borderColor = darken(colorHex, 0.25);

    const token = document.createElement('span');
    token.className = 'life-car-token';
    token.textContent = player.token || '🚗';
    car.appendChild(token);

    const pegs = document.createElement('span');
    pegs.className = 'life-car-pegs';
    car.appendChild(pegs);

    return car;
  }

  function updateCarAppearance(car, player) {
    // Pegs: 1 for spouse, 1 per child.  Cap visual count at 5 for layout
    // sanity (a player with 5+ pegs is uncommon and the UI compromise is
    // showing "+N" rather than overflowing the car).
    const pegs = car.querySelector('.life-car-pegs');
    if (pegs) {
      const dots = [];
      if (player.spouse) dots.push('●');
      const children = Math.max(0, player.children || 0);
      for (let i = 0; i < Math.min(children, 4); i++) dots.push('●');
      let label = dots.join('');
      if (player.spouse && children > 4) label += `+${children - 4}`;
      else if (!player.spouse && children > 5) label += `+${children - 5}`;
      pegs.textContent = label;
    }

    // Retired styling.
    if (player.retired) {
      car.classList.add('life-car-retired');
      if (!car.querySelector('.life-car-retired-badge')) {
        const badge = document.createElement('span');
        badge.className = 'life-car-retired-badge';
        badge.textContent = '✓';
        badge.title = 'Retired';
        car.appendChild(badge);
      }
    } else {
      car.classList.remove('life-car-retired');
      car.querySelector('.life-car-retired-badge')?.remove();
    }

    // Mark the local player's own car for any "this is you" visual.
    if (player.userId === _myUserId) car.classList.add('life-car-me');
    else car.classList.remove('life-car-me');
  }

  // ── stacking + positioning ──────────────────────────────────────────────

  function indexInStack(state, player) {
    // Stable per-state stack ordering: index in state.players gives a
    // deterministic stack offset regardless of which client is rendering.
    return state.players.findIndex((p) => p.userId === player.userId);
  }

  function placeCarOnSquare(car, squareId, stackIdx) {
    const cell = _squareEls.get(squareId);
    if (!cell) return;
    const layout = LIFE_BOARD_LAYOUT[squareId];
    if (!layout) return;
    car.style.gridColumn = String(layout.col);
    car.style.gridRow = String(layout.row);
    // Each subsequent car in the stack offsets by (4px, 4px) so they're
    // visible at the same square.  Z-index ascends so later cars appear
    // on top (purely visual — order in state.players is canonical).
    const offset = (stackIdx || 0) * 4;
    car.style.transform = `translate(${offset}px, ${offset}px)`;
    car.style.zIndex = String(10 + (stackIdx || 0));
  }

  function restackAll(state) {
    // After a state update, every car may need to re-stack — if two players
    // are on the same square, both must be visible.  We re-position every
    // car based on its current position field and its index in
    // state.players (stable ordering).
    for (const player of state.players) {
      const car = _carEls.get(player.userId);
      if (!car) continue;
      // Don't yank a car that's currently in an animation transition — the
      // animation handles its own positioning.
      if (isAnimating(player.userId)) continue;
      const stackIdx = stackPositionOnSquare(state, player.userId, player.position);
      placeCarOnSquare(car, player.position, stackIdx);
    }
  }

  function stackPositionOnSquare(state, userId, squareId) {
    // Returns 0-based stack index for userId among all players currently on
    // squareId, in state.players order.
    let idx = 0;
    for (const p of state.players) {
      if (p.position !== squareId) continue;
      if (p.userId === userId) return idx;
      idx++;
    }
    return 0;
  }

  // ── movement animation ─────────────────────────────────────────────────

  function handleMoveEvent(event, state) {
    const username = event.data.username;
    const from = event.data.from;
    const to = event.data.to;
    if (!from || !to || from === to) return;

    const player = state.players.find((p) => p.username === username);
    if (!player) return;
    const car = _carEls.get(player.userId);
    if (!car) return;

    // Enqueue this move so back-to-back PLAYER_MOVED events for the same
    // player (e.g. spin movement + stub-bump) animate sequentially rather
    // than collapsing into a single CSS transition.  startNextMove only
    // begins animating if the queue isn't already in flight.
    if (!_animQueue.has(player.userId)) _animQueue.set(player.userId, []);
    _animQueue.get(player.userId).push({ from, to });
    if (!_animRunning.get(player.userId)) {
      startNextMove(player.userId, state);
    }
  }

  function walkPath(fromId, toId) {
    const steps = [];
    let cur = fromId;
    let guard = 0;
    while (cur !== toId && guard++ < 100) {
      const sq = _boardById?.[cur];
      if (!sq || !sq.next || sq.next.length === 0) return [];
      cur = sq.next[0];
      steps.push(cur);
    }
    return cur === toId ? steps : [];
  }

  function startNextMove(userId, state) {
    const queue = _animQueue.get(userId);
    if (!queue || queue.length === 0) {
      _animRunning.set(userId, false);
      return;
    }
    const car = _carEls.get(userId);
    if (!car) {
      _animRunning.set(userId, false);
      return;
    }
    _animRunning.set(userId, true);
    const { from, to } = queue.shift();

    // Rewind to `from` with NO transition: drop the stepping class first,
    // set the grid position, force a reflow so the browser commits the
    // new position before re-enabling transitions.  Without the reflow,
    // the browser may coalesce the rewind + first step into one
    // transition starting from the previous painted state.
    car.classList.remove('life-car-stepping');
    placeCarOnSquare(car, from, /* stackIdx */ 0);
    void car.offsetWidth; // force reflow
    car.classList.add('life-car-stepping');

    // Compute the step path by walking next[0].  If the path can't be
    // reconstructed (chooseBranch move, stub-bump move where `from`
    // doesn't sit on the main path), fall back to a single hop.
    let path = walkPath(from, to);
    if (path.length === 0) path = [to];

    let stepIdx = 0;
    const step = () => {
      if (stepIdx >= path.length) {
        car.classList.remove('life-car-stepping');
        _lastPositions.set(userId, to);
        restackAll(state);
        startNextMove(userId, state); // drain the queue
        return;
      }
      // During step animation we use stackIdx 0 so the car visually
      // "owns" the intermediate square.  Final restackAll re-positions
      // every car correctly once the move completes.
      placeCarOnSquare(car, path[stepIdx++], 0);
      setTimeout(step, STEP_DURATION_MS);
    };
    step();
  }

  function isAnimating(userId) {
    // True while the per-player queue is actively draining — set by
    // startNextMove, cleared when the queue empties.  Update() uses this
    // to skip snap-positioning mid-flight cars.
    return _animRunning.get(userId) === true;
  }

  // ── highlight (active-square emphasis) ─────────────────────────────────

  function setHighlight(squareId) {
    if (_highlightedSquareId === squareId) return;
    if (_highlightedSquareId) {
      const prev = _squareEls.get(_highlightedSquareId);
      prev?.classList.remove('life-square-highlight');
    }
    if (squareId) {
      const next = _squareEls.get(squareId);
      next?.classList.add('life-square-highlight');
    }
    _highlightedSquareId = squareId;
  }

  // ── color helper ───────────────────────────────────────────────────────

  function darken(hex, amount) {
    // Very simple darken: scale RGB toward black by `amount` (0..1).  Used
    // for car borders so each player's car has a colored outline that's
    // distinct from the fill.
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
    if (!m) return '#444';
    const n = parseInt(m[1], 16);
    let r = (n >> 16) & 0xff;
    let g = (n >> 8) & 0xff;
    let b = n & 0xff;
    r = Math.max(0, Math.floor(r * (1 - amount)));
    g = Math.max(0, Math.floor(g * (1 - amount)));
    b = Math.max(0, Math.floor(b * (1 - amount)));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  return { mount, update, onEvent, unmount };
})();
