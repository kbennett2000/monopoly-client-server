/**
 * Life renderer — GameRenderer interface implementation.
 *
 * Self-registers with GameRendererRegistry at module load time.
 * The framework (app.js, socket-client.js) interacts with this module
 * exclusively through the registry; no direct references to this global.
 *
 * Implements: init / update / onEvent / destroy
 *
 * ─── Sub-view split ─────────────────────────────────────────────────────────
 *
 *   renderer.js (this file)
 *     • Lifecycle (init / update / onEvent / destroy)
 *     • Mounts the three sub-views into .board-wrapper
 *     • Routes events to the right sub-view
 *     • Drives the sidebar #action-title text
 *     • Clears Monopoly-only chrome that the framework would otherwise leave
 *
 *   board-view.js  (in container)   — the board itself + player cars
 *   card-display.js (in container)  — my inventory + opponents
 *   action-panel.js (in #action-buttons) — phase-dependent buttons + spinner
 *
 * ─── Layout decision (board-view) ───────────────────────────────────────────
 *
 * Picked layout (iii) from the spec — a hybrid stylized canonical layout.
 * College above the main track, career below, retirement at the right end.
 * Squares are positioned on a CSS grid with hand-tuned coordinates per
 * square ID so the visual stays recognizable as "the Life board" without
 * pixel-perfect path-tracing.  See LIFE_BOARD_LAYOUT in board-view.js for
 * the per-square coordinates.
 *
 * ─── Movement animation ─────────────────────────────────────────────────────
 *
 * Step-by-step.  When a PLAYER_MOVED event arrives, the board view walks
 * the path from `from` to `to` (always taking next[0], matching the
 * server's traversal rule) and animates the car one square at a time at
 * ~150ms per step.  Total animation: 150ms-1.5s depending on spin value.
 *
 * ─── Pre-game ───────────────────────────────────────────────────────────────
 *
 * Like Battleship/Yahtzee, this renderer is only init'd when state.status
 * is 'playing' (or 'paused' on rejoin).  The waiting-room view lives in
 * the framework's #waiting-screen.
 */

const LifeRenderer = (() => {
  let _myUserId = null;
  let _emit = null;
  let _isSpectator = false;
  let _wrapper = null;

  // ── lifecycle ───────────────────────────────────────────────────────────

  function init(container, state, myUserId, emitAction, options = {}) {
    _myUserId = myUserId;
    _isSpectator = !!options.isSpectator;
    // Spectator-safe emit: LifeActionPanel's spin / chooseBranch /
    // chooseCareer / chooseSalary / chooseHouse / buy* clicks all flow
    // through `emit`.  Wrapping it makes spectator clicks no-ops; the
    // pointer-events guard on the wrapper prevents the visual UI from
    // appearing interactive.  The action panel itself is hidden by
    // UIManager.applySpectatorChrome (it lives in #action-section),
    // but defense-in-depth on the board/inventory side too.
    _emit = _isSpectator ? () => {} : emitAction;

    _wrapper = document.createElement('div');
    _wrapper.id = 'life-wrapper';
    _wrapper.className = 'life-wrapper';
    if (_isSpectator) _wrapper.style.pointerEvents = 'none';
    container.appendChild(_wrapper);

    // Two side-by-side regions inside the board wrapper: the board on the
    // left (where the action visually plays out) and the inventory panel
    // on the right (where each player sees their own state).
    const boardContainer = document.createElement('div');
    boardContainer.id = 'life-board-container';
    boardContainer.className = 'life-board-container';
    _wrapper.appendChild(boardContainer);

    const inventoryContainer = document.createElement('div');
    inventoryContainer.id = 'life-inventory-container';
    inventoryContainer.className = 'life-inventory-container';
    _wrapper.appendChild(inventoryContainer);

    LifeBoardView.mount(boardContainer, state, _myUserId);
    LifeCardDisplay.mount(inventoryContainer, state, _myUserId);
    LifeActionPanel.mount(state, _myUserId, _emit);
  }

  function update(state) {
    if (!state) return;
    LifeBoardView.update(state);
    LifeCardDisplay.update(state);
    LifeActionPanel.update(state);
    paintSidebarTitle(state);
    clearMonopolyChrome();
  }

  function onEvent(event, state) {
    // Each sub-view inspects the event and reacts if it cares.  Multiple
    // sub-views may care about the same event (e.g. SPINNER_RESULT triggers
    // the spinner animation in action-panel AND the movement preparation
    // in board-view).
    LifeBoardView.onEvent?.(event, state);
    LifeCardDisplay.onEvent?.(event, state);
    LifeActionPanel.onEvent?.(event, state);

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
    LifeBoardView.unmount?.();
    LifeCardDisplay.unmount?.();
    LifeActionPanel.unmount?.();
    document.getElementById('life-wrapper')?.remove();
    _wrapper = null;
    _myUserId = null;
    _emit = null;
    _isSpectator = false;
  }

  // ── sidebar title ──────────────────────────────────────────────────────

  function paintSidebarTitle(state) {
    const titleEl = document.getElementById('action-title');
    if (!titleEl) return;
    if (state.status === 'finished') {
      titleEl.textContent = 'Game over';
      return;
    }
    const cur = state.players[state.turnState?.currentPlayerIndex];
    if (!cur) {
      // Every player is retired but status hasn't flipped yet, or some
      // transient state; degrade gracefully.
      titleEl.textContent = 'Waiting…';
      return;
    }
    const isMyTurn = cur.userId === _myUserId;
    const me = state.players.find((p) => p.userId === _myUserId);
    if (me?.retired) {
      titleEl.textContent = "You've retired";
      return;
    }
    if (!isMyTurn) {
      titleEl.textContent = `${cur.username}'s turn…`;
      return;
    }
    // It is my turn — surface the active phase.
    if (me?.pending?.type === 'fork') {
      titleEl.textContent = 'Career or College?';
    } else if (me?.pending?.type === 'retirement-fork') {
      titleEl.textContent = 'Where will you retire?';
    } else if (me?.pending?.type === 'career-draw') {
      titleEl.textContent = 'Pick a career';
    } else if (me?.pending?.type === 'salary-draw') {
      titleEl.textContent = 'Pick a salary';
    } else if (me?.pending?.type === 'house-draw') {
      titleEl.textContent = 'Pick a home';
    } else {
      titleEl.textContent = 'Your turn — Spin!';
    }
  }

  function clearMonopolyChrome() {
    // The dice-display, auction-panel, and property modals are Monopoly's;
    // Life has no use for them and ui-manager's gateways keep them hidden
    // when state.gameType !== 'monopoly'.  Belt-and-suspenders here in case
    // a stale Monopoly state ever leaks through during a screen transition.
    const auctionEl = document.getElementById('auction-panel');
    if (auctionEl) auctionEl.style.display = 'none';
  }

  // Player-card data hook.  Replaces ui-manager's hand-rolled `player.cash`
  // fallback and `player.retired` badge with a Life-owned implementation.
  // See docs/renderer-contract.md.
  function getPlayerCardData(player, _state) {
    const badges = [];
    if (player.retired) badges.push({ label: 'RETIRED', color: '#48bb78' });
    return {
      primaryValue: typeof player.cash === 'number' ? `$${player.cash.toLocaleString()}` : '',
      badges,
      subtext: '',
      dimmed: false,
    };
  }

  return { init, update, onEvent, destroy, getPlayerCardData };
})();

GameRendererRegistry.register('life', LifeRenderer);
