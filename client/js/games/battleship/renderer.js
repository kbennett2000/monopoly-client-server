/**
 * Battleship renderer — GameRenderer interface implementation.
 *
 * Self-registers with GameRendererRegistry at module load time.
 * Delegates phase-specific rendering to BattleshipSetup / BattleshipFiring;
 * this module owns the lifecycle and phase routing.
 *
 * ─── Layout responsibility split ───────────────────────────────────────────
 *   renderer.js (this file)
 *     • init / update / onEvent / destroy lifecycle
 *     • Creates the wrapper element (#battleship-wrapper)
 *     • Detects state.turnState.phase changes and remounts the active
 *       phase module
 *     • Clears framework chrome (action-buttons, auction-panel) every
 *       update — Battleship doesn't use them
 *     • Drives the sidebar #action-title with whose-turn / phase text
 *
 *   setup-phase.js     — drag-and-drop ship placement
 *   firing-phase.js    — two-grid shooting, sunk-ship tracking, game over
 *   grid.js            — shared 10×10 grid DOM primitive
 *
 * ─── Phase transition ──────────────────────────────────────────────────────
 * On every update() we compare state.turnState.phase to _lastPhase. If it
 * changed, we unmount the active phase module and mount the new one.
 * No slide animation — the spec listed it as a polish item to skip if it
 * becomes a tar pit; the cross-module DOM swap is the functional change
 * and clean enough on its own.
 *
 * ─── Pre-game ──────────────────────────────────────────────────────────────
 * Like Yahtzee, this renderer is only init'd when state.status === 'playing'
 * (or 'paused' on rejoin) — see client/js/app.js enterGameScreen. The
 * waiting-room view lives in the framework's #waiting-screen.
 */

const BattleshipRenderer = (() => {
  let _myUserId = null;
  let _emit = null;
  let _wrapper = null;
  let _activeModule = null; // BattleshipSetup or BattleshipFiring
  let _lastPhase = null;

  function init(container, state, myUserId, emitAction) {
    _myUserId = myUserId;
    _emit = emitAction;

    _wrapper = document.createElement('div');
    _wrapper.id = 'battleship-wrapper';
    _wrapper.className = 'battleship-wrapper';
    container.appendChild(_wrapper);

    mountPhase(state);
  }

  function update(state) {
    if (!state?.turnState) return;
    const phase = state.turnState.phase;
    if (phase !== _lastPhase) {
      teardownActiveModule();
      mountPhase(state);
    } else {
      _activeModule?.update?.(state);
    }
    paintSidebarTitle(state);
    clearMonopolyChrome();
  }

  function onEvent(event, state) {
    _activeModule?.onEvent?.(event, state);
    if (event.type === 'ACTION_REJECTED') {
      UIManager.appendLog(`⚠ ${event.data.message}`, 'info');
      if (_wrapper) {
        _wrapper.style.outline = '2px solid #e53935';
        setTimeout(() => {
          if (_wrapper) _wrapper.style.outline = '';
        }, 800);
      }
    }
  }

  function destroy() {
    teardownActiveModule();
    document.getElementById('battleship-wrapper')?.remove();
    _wrapper = null;
    _myUserId = null;
    _emit = null;
    _lastPhase = null;
  }

  // ── phase routing ───────────────────────────────────────────────────────

  function mountPhase(state) {
    if (!_wrapper) return;
    _wrapper.innerHTML = '';
    const phase = state.turnState.phase;
    // 'finished' status arrives with phase still === 'firing' (the server
    // doesn't transition phase on game over). Route by phase.
    if (phase === 'setup') {
      _activeModule = BattleshipSetup;
    } else {
      _activeModule = BattleshipFiring;
    }
    _activeModule.mount(_wrapper, state, _myUserId, _emit);
    _lastPhase = phase;
  }

  function teardownActiveModule() {
    _activeModule?.unmount?.();
    _activeModule = null;
  }

  // ── sidebar / framework-chrome glue ─────────────────────────────────────

  function paintSidebarTitle(state) {
    const titleEl = document.getElementById('action-title');
    if (!titleEl) return;
    if (state.status === 'finished') {
      titleEl.textContent = 'Game over';
      return;
    }
    const phase = state.turnState.phase;
    if (phase === 'setup') {
      const me = state.players.find((p) => p.userId === _myUserId);
      const opp = state.players.find((p) => p.userId !== _myUserId);
      if (me?.ready && !opp?.ready) titleEl.textContent = 'Waiting for opponent…';
      else if (me?.ready && opp?.ready) titleEl.textContent = 'Both ready — game starting';
      else titleEl.textContent = 'Place your ships';
      return;
    }
    if (phase === 'firing') {
      const idx = state.turnState.currentPlayerIndex;
      const cur = state.players[idx];
      const isMyTurn = cur?.userId === _myUserId;
      titleEl.textContent = isMyTurn ? 'Your turn — fire!' : `Waiting for ${cur?.username || ''}…`;
      return;
    }
  }

  function clearMonopolyChrome() {
    const buttonsEl = document.getElementById('action-buttons');
    if (buttonsEl) buttonsEl.innerHTML = '';
    const auctionEl = document.getElementById('auction-panel');
    if (auctionEl) auctionEl.style.display = 'none';
  }

  return { init, update, onEvent, destroy };
})();

GameRendererRegistry.register('battleship', BattleshipRenderer);
