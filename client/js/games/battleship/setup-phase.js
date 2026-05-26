/**
 * Battleship — setup phase.
 *
 * Mounts a single .bs-setup section containing:
 *   • Player's own 10×10 grid (left) — drop target, drag-pickup source
 *   • Unplaced ships panel (right) — list of ship previews; drag-source
 *   • Status line + Ready/Unready button (below the grid)
 *   • Opponent placeholder — dimmed grid + "N of 5" overlay (below unplaced)
 *
 * ─── Drag-and-drop implementation ──────────────────────────────────────────
 * Mouse-event-based (mousedown/mousemove/mouseup + keydown for R-rotate),
 * not HTML5 DnD. Reasons: HTML5 DnD's drag image is hard to style
 * consistently across browsers; we want the "ghost" to render directly on
 * the grid as cell highlights, not as a floating element, so the snap-to-
 * cell feel is built-in. Implementation is a small state machine:
 *   idle  → dragging       (mousedown on a ship preview or placed ship)
 *   dragging → dragging    (mousemove → repaint ghost / hover cell)
 *   dragging → dragging    (R key → toggle orientation)
 *   dragging → committed   (mouseup on valid cell → emit placeShip)
 *   dragging → cancelled   (mouseup off-grid or invalid → no-op; ship
 *                           returns to unplaced panel because server says
 *                           it's not placed)
 *
 * No floating ghost element. Off-grid the cursor moves freely with no
 * visual; over-grid the would-be cells highlight green (valid) or red
 * (invalid). The "← placing" indicator in the unplaced panel tells the
 * user which ship is currently in-flight if they need a reminder.
 *
 * ─── Drag-pickup of a placed ship ──────────────────────────────────────────
 * Mousedown on a placed ship cell emits removeShip immediately, then
 * enters the drag state for that ship. If the user cancels the drag
 * (releases off-grid or on an invalid cell), the server has already
 * removed the ship and it appears in the unplaced panel until they place
 * it again. This is intentional: it matches the "you can shuffle freely"
 * intent.
 */

const BattleshipSetup = (() => {
  // ── module-scoped state (re-initialised by mount()) ─────────────────────
  let _wrapper = null; // the <div class="bs-setup"> we own
  let _myUserId = null;
  let _emit = null;
  let _state = null;
  let _grid = null; // the player's grid DOM
  let _drag = null; // { shipId, length, orientation, sourceWasGrid }
  let _hoveredCell = null; // { x, y } | null — cursor's last grid cell

  // ── lifecycle ───────────────────────────────────────────────────────────

  function mount(container, state, myUserId, emit) {
    _myUserId = myUserId;
    _emit = emit;
    _state = state;

    _wrapper = document.createElement('div');
    _wrapper.className = 'bs-setup';

    // Left column: your fleet + status + ready button
    const leftCol = document.createElement('div');
    leftCol.className = 'bs-setup-col bs-setup-fleet-col';
    const fleetLabel = document.createElement('h3');
    fleetLabel.className = 'bs-section-label';
    fleetLabel.textContent = 'Your fleet';
    leftCol.appendChild(fleetLabel);

    _grid = BattleshipGrid.build(
      state.config.settings.gridWidth,
      state.config.settings.gridHeight,
      { id: 'bs-setup-grid', className: 'bs-grid-own', onCellMousedown: onGridMousedown },
    );
    leftCol.appendChild(_grid);

    const status = document.createElement('div');
    status.id = 'bs-setup-status';
    status.className = 'bs-setup-status';
    leftCol.appendChild(status);

    const readyBtn = document.createElement('button');
    readyBtn.type = 'button';
    readyBtn.id = 'bs-ready-btn';
    readyBtn.className = 'btn btn-primary bs-ready-btn';
    readyBtn.addEventListener('click', onReadyClick);
    leftCol.appendChild(readyBtn);

    _wrapper.appendChild(leftCol);

    // Right column: unplaced ships + opponent placeholder
    const rightCol = document.createElement('div');
    rightCol.className = 'bs-setup-col bs-setup-right-col';

    const unplacedLabel = document.createElement('h3');
    unplacedLabel.className = 'bs-section-label';
    unplacedLabel.textContent = 'Unplaced ships';
    rightCol.appendChild(unplacedLabel);

    const hint = document.createElement('p');
    hint.className = 'bs-hint';
    hint.textContent = '💡 Press R while dragging to rotate.';
    rightCol.appendChild(hint);

    const unplacedPanel = document.createElement('div');
    unplacedPanel.id = 'bs-unplaced-panel';
    unplacedPanel.className = 'bs-unplaced-panel';
    rightCol.appendChild(unplacedPanel);

    const opponentLabel = document.createElement('h3');
    opponentLabel.className = 'bs-section-label bs-opp-label';
    rightCol.appendChild(opponentLabel);

    const opponentPlaceholder = document.createElement('div');
    opponentPlaceholder.id = 'bs-opp-placeholder';
    opponentPlaceholder.className = 'bs-opp-placeholder';
    rightCol.appendChild(opponentPlaceholder);

    _wrapper.appendChild(rightCol);
    container.appendChild(_wrapper);

    // Mouse-up listener lives on document for the whole mount, so a drag
    // that ends outside the grid still resolves.
    document.addEventListener('mouseup', onDocMouseup);
    document.addEventListener('mousemove', onDocMousemove);
    document.addEventListener('keydown', onDocKeydown);

    paintAll();
  }

  function unmount() {
    document.removeEventListener('mouseup', onDocMouseup);
    document.removeEventListener('mousemove', onDocMousemove);
    document.removeEventListener('keydown', onDocKeydown);
    _wrapper?.remove();
    _wrapper = null;
    _grid = null;
    _state = null;
    _drag = null;
    _hoveredCell = null;
    _myUserId = null;
    _emit = null;
  }

  function update(state) {
    _state = state;
    paintAll();
  }

  function onEvent(_event, _state) {
    // All visuals come from update(); no event-only effects in setup phase.
    // (SHIP_PLACED / SHIP_REMOVED / PLAYER_READY all flow through state.)
  }

  // ── painting ────────────────────────────────────────────────────────────

  function paintAll() {
    if (!_state || !_grid) return;
    paintGridShips();
    paintDragGhost();
    paintUnplacedPanel();
    paintStatusAndButton();
    paintOpponentPlaceholder();
  }

  function paintGridShips() {
    const me = state_meAndOpp().me;
    // Clear classes AND the dataset attribute on every cell — otherwise a
    // moved ship leaves its old cells with a stale shipId, and mousedown on
    // one of those cells would start a drag for a ship not actually there.
    _grid.querySelectorAll('.bs-cell').forEach((cell) => {
      cell.classList.remove('bs-cell-ship', 'bs-cell-ship-pickup');
      delete cell.dataset.shipId;
    });
    for (const ship of me.ships) {
      // While a placed ship is being dragged, the server may not yet have
      // confirmed the removeShip — hide it locally so it doesn't render at
      // its old position with the drag ghost simultaneously visible.
      if (_drag?.shipId === ship.id && _drag.sourceWasGrid) continue;
      for (const c of ship.cells) {
        const cell = BattleshipGrid.getCell(_grid, c.x, c.y);
        if (!cell) continue;
        cell.classList.add('bs-cell-ship');
        cell.dataset.shipId = ship.id;
        if (!me.ready) cell.classList.add('bs-cell-ship-pickup');
      }
    }
  }

  function paintDragGhost() {
    BattleshipGrid.clearClass(_grid, 'bs-cell-ghost-valid');
    BattleshipGrid.clearClass(_grid, 'bs-cell-ghost-invalid');
    if (!_drag || !_hoveredCell) return;
    const cells = computeGhostCells(_hoveredCell, _drag.length, _drag.orientation);
    const valid = isPlacementValid(cells);
    const cls = valid ? 'bs-cell-ghost-valid' : 'bs-cell-ghost-invalid';
    for (const c of cells) {
      const cell = BattleshipGrid.getCell(_grid, c.x, c.y);
      if (cell) cell.classList.add(cls);
    }
  }

  function paintUnplacedPanel() {
    const panel = document.getElementById('bs-unplaced-panel');
    if (!panel) return;
    panel.innerHTML = '';

    const me = state_meAndOpp().me;
    const placedIds = new Set(me.ships.map((s) => s.id));
    const draggedId = _drag?.shipId;

    for (const def of _state.config.settings.ships) {
      if (placedIds.has(def.id) && draggedId !== def.id) continue;
      const row = document.createElement('div');
      row.className = 'bs-unplaced-row';
      row.dataset.shipId = def.id;
      if (draggedId === def.id) row.classList.add('bs-unplaced-placing');

      const preview = document.createElement('div');
      preview.className = 'bs-ship-preview';
      preview.style.setProperty('--ship-color', me.colorHex || 'var(--accent)');
      for (let i = 0; i < def.length; i++) {
        const seg = document.createElement('span');
        seg.className = 'bs-ship-seg';
        preview.appendChild(seg);
      }
      row.appendChild(preview);

      const label = document.createElement('span');
      label.className = 'bs-ship-label';
      label.textContent = `${def.name} (${def.length})`;
      row.appendChild(label);

      if (draggedId === def.id) {
        const ind = document.createElement('span');
        ind.className = 'bs-ship-placing';
        ind.textContent = '← placing';
        row.appendChild(ind);
      } else if (!me.ready) {
        row.addEventListener('mousedown', (e) => startDrag(def.id, false, e));
      }
      panel.appendChild(row);
    }
  }

  function paintStatusAndButton() {
    const me = state_meAndOpp().me;
    const totalShips = _state.config.settings.ships.length;
    const placed = me.ships.length;

    const status = document.getElementById('bs-setup-status');
    const btn = document.getElementById('bs-ready-btn');
    if (!status || !btn) return;

    if (me.ready) {
      status.textContent = 'Waiting for opponent…';
      btn.textContent = 'Unready';
      btn.classList.add('btn-outline');
      btn.classList.remove('btn-primary');
      btn.disabled = false;
      btn.dataset.action = 'uncommit';
    } else {
      status.textContent =
        placed === totalShips
          ? `All ${totalShips} ships placed — click Ready when you're set.`
          : `Place your ships — ${placed} of ${totalShips} placed.`;
      btn.textContent = 'Ready';
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-outline');
      btn.disabled = placed !== totalShips;
      btn.dataset.action = 'commit';
    }
  }

  function paintOpponentPlaceholder() {
    const { opp } = state_meAndOpp();
    const label = _wrapper?.querySelector('.bs-opp-label');
    if (label) label.textContent = opp ? opp.username : 'Opponent';

    const placeholder = document.getElementById('bs-opp-placeholder');
    if (!placeholder) return;
    placeholder.innerHTML = '';
    const oppGrid = document.createElement('div');
    oppGrid.className = 'bs-grid bs-grid-dimmed';
    const w = _state.config.settings.gridWidth;
    const h = _state.config.settings.gridHeight;
    oppGrid.style.gridTemplateColumns = `repeat(${w}, 1fr)`;
    oppGrid.style.gridTemplateRows = `repeat(${h}, 1fr)`;
    for (let i = 0; i < w * h; i++) {
      const c = document.createElement('div');
      c.className = 'bs-cell';
      oppGrid.appendChild(c);
    }
    placeholder.appendChild(oppGrid);

    const overlay = document.createElement('div');
    overlay.className = 'bs-opp-overlay';
    const username = opp?.username || 'Opponent';
    const total = _state.config.settings.ships.length;
    const placed = opp?.placementCount ?? 0;
    let text;
    if (opp?.ready) text = `${username} is ready ✓`;
    else if (placed === 0) text = `${username} is placing their ships…`;
    else if (placed < total) text = `${username} is placing their ships… (${placed} of ${total})`;
    else text = `${username} is reviewing their placement…`;
    overlay.textContent = text;
    placeholder.appendChild(overlay);
  }

  // ── drag state machine ──────────────────────────────────────────────────

  function startDrag(shipId, sourceWasGrid, event) {
    const me = state_meAndOpp().me;
    if (me.ready) return;
    const def = _state.config.settings.ships.find((s) => s.id === shipId);
    if (!def) return;
    // Default orientation: horizontal. If picking up a placed ship, keep
    // the ship's current orientation so a small move doesn't reorient it.
    let orientation = 'horizontal';
    if (sourceWasGrid) {
      const existing = me.ships.find((s) => s.id === shipId);
      if (existing) orientation = existing.orientation;
    }
    _drag = { shipId, length: def.length, orientation, sourceWasGrid };
    if (sourceWasGrid) {
      _emit('removeShip', { shipId });
      // Don't wait for the server — paint as if removed locally; the
      // next update() will reconcile.
    }
    if (event) event.preventDefault();
    paintAll();
  }

  function endDrag(commit) {
    if (!_drag) return;
    let committed = false;
    if (commit && _hoveredCell) {
      const cells = computeGhostCells(_hoveredCell, _drag.length, _drag.orientation);
      if (isPlacementValid(cells)) {
        _emit('placeShip', {
          shipId: _drag.shipId,
          origin: { x: _hoveredCell.x, y: _hoveredCell.y },
          orientation: _drag.orientation,
        });
        committed = true;
      }
    }
    _drag = null;
    _hoveredCell = null;
    paintAll();
    return committed;
  }

  function onGridMousedown(event, x, y) {
    if (_drag) return; // already mid-drag
    const cell = BattleshipGrid.getCell(_grid, x, y);
    // Require the pickup class — guards against picking up "phantom" cells
    // when the player is ready (no pickup allowed) or when stale state
    // briefly references a removed ship.
    if (!cell?.classList.contains('bs-cell-ship-pickup')) return;
    const shipId = cell.dataset?.shipId;
    if (!shipId) return;
    startDrag(shipId, true, event);
  }

  function onDocMousemove(e) {
    if (!_drag || !_grid) return;
    _hoveredCell = BattleshipGrid.cellFromPoint(_grid, e.clientX, e.clientY);
    paintDragGhost();
  }

  function onDocMouseup() {
    if (!_drag) return;
    endDrag(true);
  }

  function onDocKeydown(e) {
    if (!_drag) return;
    if (e.key === 'r' || e.key === 'R') {
      _drag.orientation = _drag.orientation === 'horizontal' ? 'vertical' : 'horizontal';
      paintDragGhost();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      endDrag(false);
      e.preventDefault();
    }
  }

  function onReadyClick() {
    const btn = document.getElementById('bs-ready-btn');
    if (!btn || btn.disabled) return;
    if (btn.dataset.action === 'commit') _emit('commitPlacement');
    else if (btn.dataset.action === 'uncommit') _emit('uncommitPlacement');
  }

  // ── geometry helpers ────────────────────────────────────────────────────

  function computeGhostCells(origin, length, orientation) {
    const cells = [];
    for (let i = 0; i < length; i++) {
      if (orientation === 'horizontal') cells.push({ x: origin.x + i, y: origin.y });
      else cells.push({ x: origin.x, y: origin.y + i });
    }
    return cells;
  }

  function isPlacementValid(cells) {
    const w = _state.config.settings.gridWidth;
    const h = _state.config.settings.gridHeight;
    for (const c of cells) {
      if (c.x < 0 || c.x >= w || c.y < 0 || c.y >= h) return false;
    }
    const me = state_meAndOpp().me;
    const occupied = new Set();
    for (const ship of me.ships) {
      if (ship.id === _drag.shipId) continue; // self-overlap allowed (move)
      for (const c of ship.cells) occupied.add(`${c.x},${c.y}`);
    }
    for (const c of cells) {
      if (occupied.has(`${c.x},${c.y}`)) return false;
    }
    return true;
  }

  function state_meAndOpp() {
    const me = _state.players.find((p) => p.userId === _myUserId) || { ships: [], ready: false };
    const opp = _state.players.find((p) => p.userId !== _myUserId);
    return { me, opp };
  }

  return { mount, unmount, update, onEvent };
})();
