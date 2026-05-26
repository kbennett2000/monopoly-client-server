/**
 * Tic-Tac-Toe renderer — GameRenderer interface implementation.
 *
 * Self-registers with GameRendererRegistry at module load time.
 * The framework (app.js, socket-client.js) interacts with this module
 * exclusively through the registry.
 *
 * Implements: init / update / onEvent / destroy
 */

const TicTacToeRenderer = (() => {
  let _myUserId = null;
  let _emit = null;
  let _isSpectator = false;

  // ── init ────────────────────────────────────────────────────────────────────

  function init(container, state, myUserId, emitAction, options = {}) {
    _myUserId = myUserId;
    _emit = emitAction;
    _isSpectator = !!options.isSpectator;

    const size = state.config.settings.boardSize;

    const wrapper = document.createElement('div');
    wrapper.id = 'tic-tac-toe-wrapper';
    wrapper.className = 'tic-tac-toe-wrapper';

    const grid = document.createElement('div');
    grid.id = 'ttt-grid';
    grid.className = 'ttt-grid';
    grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${size}, 1fr)`;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.createElement('button');
        cell.className = 'ttt-cell';
        cell.id = `ttt-cell-${r}-${c}`;
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.disabled = true; // update() enables on my turn
        cell.addEventListener('click', () => {
          if (_isSpectator) return;
          if (_emit) _emit('markCell', { row: r, col: c });
        });
        grid.appendChild(cell);
      }
    }
    wrapper.appendChild(grid);
    container.appendChild(wrapper);
  }

  // ── update ──────────────────────────────────────────────────────────────────

  function update(state) {
    if (!state?.board) return;
    const size = state.config.settings.boardSize;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.getElementById(`ttt-cell-${r}-${c}`);
        if (!cell) continue;
        const userId = state.board[r][c];
        if (userId) {
          const player = state.players.find((p) => p.userId === userId);
          cell.textContent = player?.token || '?';
          cell.style.color = player?.colorHex || '#888';
          cell.classList.add('filled');
        } else {
          cell.textContent = '';
          cell.style.color = '';
          cell.classList.remove('filled');
        }
      }
    }

    const cur = state.players[state.turnState?.currentPlayerIndex];
    const isMyTurn = cur?.userId === _myUserId;
    const playing = state.status === 'playing';

    const titleEl = document.getElementById('action-title');
    if (titleEl) {
      titleEl.textContent = !playing
        ? 'Game over'
        : isMyTurn
          ? 'Your turn — click an empty cell'
          : `Waiting for ${cur?.username || ''}…`;
    }

    // Clear any leftover Monopoly chrome
    const buttonsEl = document.getElementById('action-buttons');
    if (buttonsEl) buttonsEl.innerHTML = '';
    const auctionEl = document.getElementById('auction-panel');
    if (auctionEl) auctionEl.style.display = 'none';

    // Enable/disable cells: only empty cells, only on my turn, only while
    // playing.  Spectators always see fully-disabled cells (the early-return
    // in the click handler is the security gate; this is the UX gate).
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.getElementById(`ttt-cell-${r}-${c}`);
        if (!cell) continue;
        cell.disabled = _isSpectator || !isMyTurn || !playing || state.board[r][c] !== null;
      }
    }
  }

  // ── onEvent ─────────────────────────────────────────────────────────────────

  function onEvent(event, _state) {
    switch (event.type) {
      case 'ACTION_REJECTED': {
        UIManager.appendLog(`⚠ ${event.data.message}`, 'info');
        const grid = document.getElementById('ttt-grid');
        if (grid) {
          grid.style.outline = '2px solid #e53935';
          setTimeout(() => {
            grid.style.outline = '';
          }, 800);
        }
        break;
      }
      case 'GAME_OVER':
        UIManager.appendLog(
          event.data.winner ? `🏆 ${event.data.winner} wins!` : "🤝 It's a draw!",
          'game',
        );
        SoundManager.playGameOver();
        break;
      // CELL_MARKED, TURN_SKIPPED — silently accepted; update() covers visuals.
    }
  }

  // ── destroy ─────────────────────────────────────────────────────────────────

  function destroy() {
    document.getElementById('tic-tac-toe-wrapper')?.remove();
    _myUserId = null;
    _emit = null;
    _isSpectator = false;
  }

  return { init, update, onEvent, destroy };
})();

GameRendererRegistry.register('tic-tac-toe', TicTacToeRenderer);
