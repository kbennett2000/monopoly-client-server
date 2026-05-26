/**
 * Battleship — firing phase.
 *
 * Two-grid layout:
 *   • Left  — your fleet (your ships visible; opponent shots overlaid)
 *   • Right — opponent's waters (your shots overlaid; sunk opp ships
 *             revealed when they're sunk)
 *
 * Grids stay in fixed positions across turns; the interactive treatment
 * (dim / crosshair cursor / etc.) flips per turn. Per the design sketch,
 * "moving the active grid to center" or swapping per turn reads wrong.
 *
 * ─── Sunk-ship cell cache ──────────────────────────────────────────────────
 * Opponent ship positions are hidden by the server's getStateForPlayer.
 * The only positional reveal is the SHIP_SUNK event, which carries the
 * full cell footprint of the just-sunk ship. We cache those cells locally
 * in _sunkOppCells so the "SUNK" overlay persists across subsequent
 * update() calls.
 *
 * Known limitation: if a player rejoins mid-game after one or more
 * opponent ships have already been sunk, those cells are not in the
 * cache (events don't replay on rejoin) and the renderer paints them
 * as plain hit cells rather than as a sunk-ship overlay. The game
 * remains functionally playable; the cosmetic loss is documented and
 * accepted for v1. Closing the gap requires the server to expose sunk
 * opponent ships' cells, which is out of session-2 scope.
 *
 * Game-over reveal of the loser's full fleet is the same cache: when
 * the winner sinks the 5th opponent ship they've necessarily received 5
 * SHIP_SUNK events during play, so the cache is complete for the winner
 * at game-over. (Traditional Battleship doesn't reveal the winner's
 * fleet to the loser, which matches what the server does — the loser
 * just sees their own grid as-is.)
 */

const BattleshipFiring = (() => {
  let _wrapper = null;
  let _myUserId = null;
  let _emit = null;
  let _state = null;
  let _myGrid = null;
  let _oppGrid = null;
  let _sunkOppCells = new Map(); // shipId → cells[]

  function mount(container, state, myUserId, emit) {
    _myUserId = myUserId;
    _emit = emit;
    _state = state;
    _sunkOppCells = new Map();

    _wrapper = document.createElement('div');
    _wrapper.className = 'bs-firing';

    // Left column — your fleet
    const leftCol = document.createElement('div');
    leftCol.className = 'bs-firing-col';
    const leftStatus = document.createElement('div');
    leftStatus.id = 'bs-left-status';
    leftStatus.className = 'bs-firing-status';
    leftCol.appendChild(leftStatus);
    const leftLabel = document.createElement('h3');
    leftLabel.className = 'bs-section-label';
    leftLabel.textContent = 'Your fleet';
    leftCol.appendChild(leftLabel);
    _myGrid = BattleshipGrid.build(
      state.config.settings.gridWidth,
      state.config.settings.gridHeight,
      { id: 'bs-my-grid', className: 'bs-grid-own' },
    );
    leftCol.appendChild(_myGrid);
    _wrapper.appendChild(leftCol);

    // Right column — opponent waters
    const rightCol = document.createElement('div');
    rightCol.className = 'bs-firing-col';
    const rightStatus = document.createElement('div');
    rightStatus.id = 'bs-right-status';
    rightStatus.className = 'bs-firing-status';
    rightCol.appendChild(rightStatus);
    const rightLabel = document.createElement('h3');
    rightLabel.id = 'bs-opp-label';
    rightLabel.className = 'bs-section-label';
    rightCol.appendChild(rightLabel);
    _oppGrid = BattleshipGrid.build(
      state.config.settings.gridWidth,
      state.config.settings.gridHeight,
      { id: 'bs-opp-grid', className: 'bs-grid-opp', onCellMousedown: onOppGridMousedown },
    );
    rightCol.appendChild(_oppGrid);
    _wrapper.appendChild(rightCol);

    // Game-over banner placeholder
    const banner = document.createElement('div');
    banner.id = 'bs-game-over';
    banner.className = 'bs-game-over';
    banner.style.display = 'none';
    _wrapper.appendChild(banner);

    container.appendChild(_wrapper);
    paintAll();
  }

  function unmount() {
    _wrapper?.remove();
    _wrapper = null;
    _myGrid = null;
    _oppGrid = null;
    _state = null;
    _myUserId = null;
    _emit = null;
    _sunkOppCells = new Map();
  }

  function update(state) {
    _state = state;
    paintAll();
  }

  function onEvent(event, state) {
    _state = state;
    switch (event.type) {
      case 'SHOT_FIRED': {
        // Brief impact flash on the just-hit cell. The PERSISTENT hit
        // marker is painted by paintMyGrid/paintOppGrid from state; this
        // adds a one-time animation class that survives ~250ms. The split
        // is required by the renderer-interface contract: animations
        // belong in onEvent (so they don't replay every update tick).
        if (event.data.result === 'miss') break;
        const onOpp = event.data.shooter !== oppPlayer()?.username;
        const grid = onOpp ? _oppGrid : _myGrid;
        flashCell(grid, event.data.cell, 'bs-cell-hit-flash', 250);
        break;
      }
      case 'SHIP_SUNK': {
        const owner = event.data.owner;
        const shipId = event.data.shipId;
        const cells = event.data.cells;
        const opp = oppPlayer();
        const onOpp = opp && owner === opp.username;
        if (onOpp) {
          // Cells are revealed on sink. Cache so the persistent SUNK
          // overlay survives subsequent state updates (the server hides
          // opp.ships, so this cache is the only place that knows).
          _sunkOppCells.set(shipId, cells);
          UIManager.appendLog(`💥 You sank ${owner}'s ${event.data.shipName}!`, 'game');
        } else {
          UIManager.appendLog(`💥 Your ${event.data.shipName} was sunk!`, 'game');
        }
        paintAll();
        flashCells(onOpp ? _oppGrid : _myGrid, cells, 'bs-cell-sunk-flash', 1000);
        SoundManager.playEliminate();
        break;
      }
      case 'GAME_OVER': {
        SoundManager.playGameOver();
        // Reveal the opponent's full fleet from the GAME_OVER payload.
        // For the winner this is mostly redundant with cells already in
        // _sunkOppCells (they sank all 5), but it fills any gaps caused
        // by mid-game rejoin (SHIP_SUNK events don't replay). For the
        // loser this is the only source — they never received SHIP_SUNK
        // events for the winner's still-floating ships. Static reveal,
        // no flash class — the game's over.
        const opp = oppPlayer();
        const finalFleets = event.data.finalFleets;
        if (opp && finalFleets && Array.isArray(finalFleets[opp.userId])) {
          for (const ship of finalFleets[opp.userId]) {
            _sunkOppCells.set(ship.id, ship.cells);
          }
        }
        const winnerUsername = event.data.winnerUsername;
        const iWon = event.data.winner === _myUserId;
        UIManager.appendLog(
          iWon
            ? `🏆 You win! All of ${opp?.username}'s ships are sunk.`
            : `🏳 ${winnerUsername} wins.`,
          'game',
        );
        paintAll();
        break;
      }
      // TURN_STARTED visuals handled by update().
    }
  }

  /** Add a class to one cell, then remove it after `durationMs`. */
  function flashCell(grid, cell, className, durationMs) {
    if (!grid) return;
    const el = BattleshipGrid.getCell(grid, cell.x, cell.y);
    if (!el) return;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), durationMs);
  }

  /** Add a class to a list of cells, then remove it after `durationMs`. */
  function flashCells(grid, cells, className, durationMs) {
    if (!grid) return;
    for (const c of cells) {
      const el = BattleshipGrid.getCell(grid, c.x, c.y);
      if (el) el.classList.add(className);
    }
    setTimeout(() => {
      for (const c of cells) {
        const el = BattleshipGrid.getCell(grid, c.x, c.y);
        if (el) el.classList.remove(className);
      }
    }, durationMs);
  }

  // ── painting ────────────────────────────────────────────────────────────

  function paintAll() {
    if (!_state || !_myGrid || !_oppGrid) return;
    paintMyGrid();
    paintOppGrid();
    paintStatuses();
    paintGameOver();
  }

  function paintMyGrid() {
    BattleshipGrid.clearClass(_myGrid, 'bs-cell-ship');
    BattleshipGrid.clearClass(_myGrid, 'bs-cell-hit');
    BattleshipGrid.clearClass(_myGrid, 'bs-cell-miss');
    BattleshipGrid.clearClass(_myGrid, 'bs-cell-sunk');
    BattleshipGrid.clearClass(_myGrid, 'bs-cell-sunk-flash');
    const me = mePlayer();
    if (!me) return;

    // Own ships visible
    const sunkShipIds = new Set(me.shipsSunk || []);
    for (const ship of me.ships || []) {
      const isSunk = sunkShipIds.has(ship.id);
      for (const c of ship.cells) {
        const cell = BattleshipGrid.getCell(_myGrid, c.x, c.y);
        if (!cell) continue;
        cell.classList.add('bs-cell-ship');
        if (isSunk) cell.classList.add('bs-cell-sunk');
      }
    }

    // Opponent's shots against me overlay (hit / miss)
    for (const shot of me.shotsReceived || []) {
      const cell = BattleshipGrid.getCell(_myGrid, shot.cell.x, shot.cell.y);
      if (!cell) continue;
      if (shot.result === 'miss') cell.classList.add('bs-cell-miss');
      else cell.classList.add('bs-cell-hit');
    }
  }

  function paintOppGrid() {
    BattleshipGrid.clearClass(_oppGrid, 'bs-cell-hit');
    BattleshipGrid.clearClass(_oppGrid, 'bs-cell-miss');
    BattleshipGrid.clearClass(_oppGrid, 'bs-cell-sunk');
    BattleshipGrid.clearClass(_oppGrid, 'bs-cell-sunk-flash');
    BattleshipGrid.clearClass(_oppGrid, 'bs-cell-shot-disabled');

    const me = mePlayer();
    if (!me) return;

    // Paint sunk-ship cell footprints first so individual shot markers
    // still draw on top of them. The one-time flash class is added by
    // onEvent('SHIP_SUNK') only — not here — so it doesn't restart on
    // every paintAll tick.
    for (const cells of _sunkOppCells.values()) {
      for (const c of cells) {
        const cell = BattleshipGrid.getCell(_oppGrid, c.x, c.y);
        if (!cell) continue;
        cell.classList.add('bs-cell-sunk');
      }
    }

    // Your shots — already-shot cells must be visually distinct and
    // non-clickable.
    for (const shot of me.shotsFired || []) {
      const cell = BattleshipGrid.getCell(_oppGrid, shot.cell.x, shot.cell.y);
      if (!cell) continue;
      cell.classList.add('bs-cell-shot-disabled');
      if (shot.result === 'miss') cell.classList.add('bs-cell-miss');
      else cell.classList.add('bs-cell-hit');
    }

    // Interactive treatment: enable hover crosshair only on my turn,
    // playing status, and only for cells I haven't already shot at.
    const isMyTurn = currentIsMe();
    const playing = _state.status === 'playing';
    _oppGrid.classList.toggle('bs-grid-active', isMyTurn && playing);
    _oppGrid.classList.toggle('bs-grid-inactive', !(isMyTurn && playing));
    _myGrid.classList.toggle('bs-grid-active', !isMyTurn && playing);
    _myGrid.classList.toggle('bs-grid-inactive', isMyTurn || !playing);
  }

  function paintStatuses() {
    const left = document.getElementById('bs-left-status');
    const right = document.getElementById('bs-right-status');
    const oppLabel = document.getElementById('bs-opp-label');
    if (oppLabel) oppLabel.textContent = `${oppPlayer()?.username || 'Opponent'}'s waters`;
    if (!left || !right) return;
    const playing = _state.status === 'playing';
    const finished = _state.status === 'finished';
    if (finished) {
      left.textContent = 'Game over';
      right.textContent = 'Game over';
      return;
    }
    if (!playing) {
      left.textContent = '';
      right.textContent = '';
      return;
    }
    const isMyTurn = currentIsMe();
    const oppName = oppPlayer()?.username || 'Opponent';
    if (isMyTurn) {
      left.textContent = `${oppName}'s fleet is waiting.`;
      right.textContent = `Your shot — click anywhere on ${oppName}'s waters.`;
    } else {
      left.textContent = `${oppName} is firing at you…`;
      right.textContent = `${oppName} is aiming…`;
    }
  }

  function paintGameOver() {
    const banner = document.getElementById('bs-game-over');
    if (!banner) return;
    if (_state.status !== 'finished') {
      banner.style.display = 'none';
      return;
    }
    const iWon = _state.winner === _myUserId;
    const oppName = oppPlayer()?.username || 'Opponent';
    banner.style.display = '';
    banner.innerHTML = '';
    const headline = document.createElement('div');
    headline.className = 'bs-game-over-headline';
    headline.textContent = iWon ? '🏆 You win!' : `🏳 ${oppName} wins`;
    banner.appendChild(headline);
    const sub = document.createElement('div');
    sub.className = 'bs-game-over-sub';
    sub.textContent = iWon
      ? `All of ${oppName}'s ships sunk.`
      : 'Your fleet is gone.';
    banner.appendChild(sub);
  }

  // ── input handlers ──────────────────────────────────────────────────────

  function onOppGridMousedown(_event, x, y) {
    if (_state.status !== 'playing') return;
    if (!currentIsMe()) return;
    const me = mePlayer();
    if (!me) return;
    // Renderer-side visual gate; server is the authority. Pre-empt the
    // server round-trip for cells that have already been targeted.
    if (me.shotsFired.some((s) => s.cell.x === x && s.cell.y === y)) return;
    _emit('fireShot', { cell: { x, y } });
  }

  // ── lookups ─────────────────────────────────────────────────────────────

  function mePlayer() {
    return _state.players.find((p) => p.userId === _myUserId);
  }
  function oppPlayer() {
    return _state.players.find((p) => p.userId !== _myUserId);
  }
  function currentIsMe() {
    const idx = _state.turnState?.currentPlayerIndex;
    if (idx === null || idx === undefined) return false;
    return _state.players[idx]?.userId === _myUserId;
  }

  return { mount, unmount, update, onEvent };
})();
