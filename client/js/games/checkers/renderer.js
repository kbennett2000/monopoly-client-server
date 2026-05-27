/**
 * Checkers renderer — GameRenderer interface implementation.
 *
 * Self-registers with GameRendererRegistry at module load time.
 * Implements: init / update / onEvent / destroy
 */

const CheckersRenderer = (() => {

  let _myUserId    = null;
  let _emit        = null;
  let _isSpectator = false;

  // Selection state
  let _selectedPiece = null;  // { row, col } or null
  let _myColor       = null;

  // Animation queue — events are enqueued here and drained sequentially.
  let _animQueue   = [];
  let _animRunning = false;

  // ── init ──────────────────────────────────────────────────────────────────

  function init(container, state, myUserId, emitAction, options = {}) {
    _myUserId    = myUserId;
    _emit        = emitAction;
    _isSpectator = !!options.isSpectator;
    _selectedPiece = null;
    _animQueue   = [];
    _animRunning = false;

    const me = state.players.find(p => p.userId === myUserId);
    _myColor = me ? me.color : null;

    const size = state.config.settings.boardSize;

    const wrapper = document.createElement('div');
    wrapper.id        = 'checkers-wrapper';
    wrapper.className = 'checkers-wrapper';

    // Capture-required banner
    const banner = document.createElement('div');
    banner.id        = 'ck-capture-banner';
    banner.className = 'ck-capture-banner';
    banner.textContent = '⚔️ Captures available — you must capture this turn.';
    wrapper.appendChild(banner);

    // Board grid
    const grid = document.createElement('div');
    grid.id        = 'ck-grid';
    grid.className = 'ck-grid';
    grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    grid.style.gridTemplateRows    = `repeat(${size}, 1fr)`;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.createElement('div');
        const isDark = (r + c) % 2 === 1;
        cell.className = `ck-cell ${isDark ? 'ck-dark' : 'ck-light'}`;
        cell.id        = `ck-cell-${r}-${c}`;
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);

        cell.addEventListener('click', () => onCellClick(r, c));
        grid.appendChild(cell);
      }
    }

    wrapper.appendChild(grid);
    container.appendChild(wrapper);
  }

  // ── cell click handler ────────────────────────────────────────────────────

  function onCellClick(row, col) {
    if (_isSpectator) return;
    if (!_lastState || _lastState.status !== 'playing') return;

    const cur = _lastState.players[_lastState.turnState?.currentPlayerIndex];
    if (!cur || cur.userId !== _myUserId) return;

    // During chain: only allow clicking valid chain destinations
    if (_lastState.pendingChainPiece) {
      const dest = _lastDestinations.find(d => d.row === row && d.col === col);
      if (dest) {
        _emit('move', {
          from: _lastState.pendingChainPiece,
          to: { row, col },
        });
      }
      return;
    }

    // If a piece is selected...
    if (_selectedPiece) {
      // Clicking the same piece → deselect
      if (_selectedPiece.row === row && _selectedPiece.col === col) {
        _selectedPiece = null;
        renderSelectionState();
        return;
      }

      // Clicking a valid destination → make move
      const dest = _lastDestinations.find(d => d.row === row && d.col === col);
      if (dest) {
        _emit('move', { from: _selectedPiece, to: { row, col } });
        _selectedPiece = null;
        return;
      }

      // Clicking a different eligible piece → select it instead
      const key = `${row},${col}`;
      if (_lastEligible.has(key)) {
        _selectedPiece = { row, col };
        renderSelectionState();
        return;
      }

      // Clicking anywhere else → ignore
      return;
    }

    // No piece selected: click an eligible piece to select
    const key = `${row},${col}`;
    if (_lastEligible.has(key)) {
      _selectedPiece = { row, col };
      renderSelectionState();
    }
  }

  // ── update ────────────────────────────────────────────────────────────────

  let _lastState        = null;
  let _lastEligible     = new Set();
  let _lastDestinations = [];

  function update(state) {
    if (!state?.board) return;
    _lastState = state;

    const size = state.config.settings.boardSize;

    // Paint pieces
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.getElementById(`ck-cell-${r}-${c}`);
        if (!cell) continue;

        // Remove old piece
        const oldPiece = cell.querySelector('.ck-piece');
        if (oldPiece && !oldPiece.classList.contains('ck-anim-fading')) {
          oldPiece.remove();
        }

        const boardCell = state.board[r][c];
        if (boardCell) {
          // Don't re-add if already present (animation in progress)
          if (!cell.querySelector('.ck-piece:not(.ck-anim-fading)')) {
            const piece = createPieceEl(boardCell);
            cell.appendChild(piece);
          }
        }
      }
    }

    // Compute eligible pieces from action descriptors
    _lastEligible = new Set();
    const descriptors = state.actionDescriptors || [];
    descriptors.forEach(d => {
      if (d.action === 'move') {
        _lastEligible.add(`${d.data.from.row},${d.data.from.col}`);
      }
    });

    // During chain, force-select the chain piece
    if (state.pendingChainPiece) {
      _selectedPiece = { ...state.pendingChainPiece };
    }

    // If selected piece is no longer eligible, deselect
    if (_selectedPiece) {
      const selKey = `${_selectedPiece.row},${_selectedPiece.col}`;
      if (!_lastEligible.has(selKey) && !state.pendingChainPiece) {
        _selectedPiece = null;
      }
    }

    renderSelectionState();

    // Sync action panel
    const cur      = state.players[state.turnState?.currentPlayerIndex];
    const isMyTurn = cur?.userId === _myUserId;
    const playing  = state.status === 'playing';

    const titleEl = document.getElementById('action-title');
    if (titleEl) {
      if (!playing) {
        titleEl.textContent = 'Game over';
      } else if (isMyTurn) {
        if (state.pendingChainPiece) {
          titleEl.textContent = 'Continue your capture chain';
        } else if (state.captureRequired) {
          titleEl.textContent = 'You must capture — select a piece';
        } else {
          titleEl.textContent = 'Your turn — select a piece to move';
        }
      } else {
        titleEl.textContent = `Waiting for ${cur?.username || ''}…`;
      }
    }

    // Clear Monopoly action buttons and auction panel
    const buttonsEl = document.getElementById('action-buttons');
    if (buttonsEl) buttonsEl.innerHTML = '';
    const auctionEl = document.getElementById('auction-panel');
    if (auctionEl) auctionEl.style.display = 'none';

    // Capture banner visibility
    const banner = document.getElementById('ck-capture-banner');
    if (banner) {
      const showBanner = playing && isMyTurn && !_isSpectator && state.captureRequired;
      banner.style.display = showBanner ? '' : 'none';
    }
  }

  // ── selection / highlighting ──────────────────────────────────────────────

  function renderSelectionState() {
    const state = _lastState;
    if (!state) return;
    const size = state.config.settings.boardSize;
    const cur = state.players[state.turnState?.currentPlayerIndex];
    const isMyTurn = cur?.userId === _myUserId;
    const playing = state.status === 'playing';
    const isChain = !!state.pendingChainPiece;

    // Compute destinations for selected piece
    _lastDestinations = [];
    if (_selectedPiece) {
      const descriptors = state.actionDescriptors || [];
      _lastDestinations = descriptors
        .filter(d =>
          d.action === 'move' &&
          d.data.from.row === _selectedPiece.row &&
          d.data.from.col === _selectedPiece.col
        )
        .map(d => d.data.to);
    }

    const destSet = new Set(_lastDestinations.map(d => `${d.row},${d.col}`));

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.getElementById(`ck-cell-${r}-${c}`);
        if (!cell) continue;
        const key = `${r},${c}`;
        const piece = cell.querySelector('.ck-piece');

        // Clear all state classes
        cell.classList.remove('ck-dest', 'ck-dest-capture');
        if (piece) {
          piece.classList.remove('ck-eligible', 'ck-capture-eligible', 'ck-selected');
        }

        if (!playing) continue;

        // Destination highlighting
        if (destSet.has(key)) {
          const isCaptureDest = _lastDestinations.some(d =>
            d.row === r && d.col === c
          ) && state.captureRequired;
          cell.classList.add(isCaptureDest ? 'ck-dest-capture' : 'ck-dest');
        }

        if (!piece) continue;

        // Selected piece
        if (_selectedPiece && _selectedPiece.row === r && _selectedPiece.col === c) {
          piece.classList.add('ck-selected');
          continue;
        }

        // Eligible piece highlighting (only for current player, not spectators during chain)
        if ((isMyTurn || _isSpectator) && _lastEligible.has(key) && !isChain) {
          if (state.captureRequired) {
            piece.classList.add('ck-capture-eligible');
          } else {
            piece.classList.add('ck-eligible');
          }
        }
      }
    }

    // Update cursor styles on dark cells
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.getElementById(`ck-cell-${r}-${c}`);
        if (!cell || !cell.classList.contains('ck-dark')) continue;
        const key = `${r},${c}`;

        if (_isSpectator || !playing) {
          cell.style.cursor = 'default';
        } else if (destSet.has(key)) {
          cell.style.cursor = 'pointer';
        } else if (_lastEligible.has(key) && !isChain) {
          cell.style.cursor = 'pointer';
        } else if (_selectedPiece && _selectedPiece.row === r && _selectedPiece.col === c) {
          cell.style.cursor = 'pointer';
        } else {
          cell.style.cursor = 'default';
        }
      }
    }
  }

  // ── piece element creation ────────────────────────────────────────────────

  function createPieceEl(boardCell) {
    const el = document.createElement('div');
    el.className = `ck-piece ck-piece-${boardCell.color}`;
    if (boardCell.king) {
      const crown = document.createElement('span');
      crown.className = 'ck-crown';
      crown.textContent = '👑';
      el.appendChild(crown);
    }
    return el;
  }

  // ── onEvent (animations) ──────────────────────────────────────────────────

  function onEvent(event, state) {
    switch (event.type) {
      case 'PIECE_MOVED':
      case 'PIECE_CAPTURED':
      case 'PIECE_CROWNED':
      case 'CHAIN_CONTINUE':
        _animQueue.push({ event, state });
        drainAnimQueue();
        break;

      case 'ACTION_REJECTED':
        UIManager.appendLog(`⚠ ${event.data.message}`, 'info');
        break;

      case 'GAME_OVER':
        UIManager.appendLog(
          event.data.winner ? `🏆 ${event.data.winner} wins!` : '🤝 Draw!',
          'game'
        );
        SoundManager.playGameOver();
        break;
    }
  }

  // ── animation queue ───────────────────────────────────────────────────────

  function drainAnimQueue() {
    if (_animRunning) return;
    if (_animQueue.length === 0) return;

    _animRunning = true;
    const { event } = _animQueue.shift();

    switch (event.type) {
      case 'PIECE_MOVED':
        animateMove(event.data, () => { _animRunning = false; drainAnimQueue(); });
        break;
      case 'PIECE_CAPTURED':
        animateCapture(event.data, () => { _animRunning = false; drainAnimQueue(); });
        break;
      case 'PIECE_CROWNED':
        animateCrown(event.data, () => { _animRunning = false; drainAnimQueue(); });
        break;
      case 'CHAIN_CONTINUE':
        // Brief pause between chain jumps
        setTimeout(() => { _animRunning = false; drainAnimQueue(); }, 150);
        break;
      default:
        _animRunning = false;
        drainAnimQueue();
    }
  }

  function animateMove(data, done) {
    const { from, to } = data;
    const fromCell = document.getElementById(`ck-cell-${from.row}-${from.col}`);
    const toCell   = document.getElementById(`ck-cell-${to.row}-${to.col}`);
    if (!fromCell || !toCell) { done(); return; }

    const piece = fromCell.querySelector('.ck-piece');
    if (!piece) { done(); return; }

    const fromRect = fromCell.getBoundingClientRect();
    const toRect   = toCell.getBoundingClientRect();
    const dx = toRect.left - fromRect.left;
    const dy = toRect.top  - fromRect.top;

    piece.classList.add('ck-anim-moving');
    piece.style.transform = `translate(${dx}px, ${dy}px)`;
    piece.style.zIndex = '10';

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      piece.removeEventListener('transitionend', settle);
      piece.classList.remove('ck-anim-moving');
      piece.style.transform = '';
      piece.style.zIndex = '';
      piece.remove();
      const oldDest = toCell.querySelector('.ck-piece');
      if (oldDest) oldDest.remove();
      toCell.appendChild(piece);
      done();
    };

    piece.addEventListener('transitionend', settle);
    setTimeout(settle, 500);
  }

  function animateCapture(data, done) {
    const { capturedAt } = data;
    const cell = document.getElementById(`ck-cell-${capturedAt.row}-${capturedAt.col}`);
    if (!cell) { done(); return; }

    const piece = cell.querySelector('.ck-piece');
    if (!piece) { done(); return; }

    piece.classList.add('ck-anim-fading');
    setTimeout(() => {
      piece.remove();
      done();
    }, 400);
  }

  function animateCrown(data, done) {
    const { position } = data;
    const cell = document.getElementById(`ck-cell-${position.row}-${position.col}`);
    if (!cell) { done(); return; }

    const piece = cell.querySelector('.ck-piece');
    if (!piece) { done(); return; }

    // Add crown if not already present
    if (!piece.querySelector('.ck-crown')) {
      const crown = document.createElement('span');
      crown.className = 'ck-crown ck-crown-anim';
      crown.textContent = '👑';
      piece.appendChild(crown);
    }

    piece.classList.add('ck-anim-crowning');
    setTimeout(() => {
      piece.classList.remove('ck-anim-crowning');
      const crown = piece.querySelector('.ck-crown');
      if (crown) crown.classList.remove('ck-crown-anim');
      done();
    }, 600);
  }

  // ── destroy ───────────────────────────────────────────────────────────────

  function destroy() {
    document.getElementById('checkers-wrapper')?.remove();
    _myUserId      = null;
    _emit          = null;
    _isSpectator   = false;
    _selectedPiece = null;
    _myColor       = null;
    _lastState     = null;
    _lastEligible  = new Set();
    _lastDestinations = [];
    _animQueue     = [];
    _animRunning   = false;
  }

  // ── public API ────────────────────────────────────────────────────────────

  return { init, update, onEvent, destroy };

})();

GameRendererRegistry.register('checkers', CheckersRenderer);
