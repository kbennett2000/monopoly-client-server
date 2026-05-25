/**
 * Risk renderer — GameRenderer interface implementation.
 *
 * Self-registers with GameRendererRegistry at module load time.
 *
 * Loads the world-map SVG once, injects it inline so each territory path is
 * addressable, then overlays army-count markers and wires per-territory click
 * handlers.  All interaction happens through phase-aware state managed locally
 * in this module (`_selectedFrom`, `_selectedTo`).
 *
 * Implements: init / update / onEvent / destroy
 */

const RiskRenderer = (() => {

  // ── module-private state ───────────────────────────────────────────────────

  let _myUserId      = null;
  let _emit          = null;
  let _svgLoaded     = false;
  let _selectedFrom  = null;   // territory id chosen as source (attack/fortify)
  let _wrapper       = null;
  let _onTerritoryClick = null; // bound handler kept for teardown
  let _latestState   = null;   // most recent state passed to update()

  const SVG_URL = '/img/risk/risk-board-reference.svg';

  // ── init ────────────────────────────────────────────────────────────────────

  function init(container, state, myUserId, emitAction) {
    _myUserId     = myUserId;
    _emit         = emitAction;
    _selectedFrom = null;

    // Hide the Monopoly and Connect Four board areas
    const monoBoard = document.getElementById('board');
    if (monoBoard) monoBoard.style.display = 'none';
    const cfWrap = document.getElementById('connect-four-wrapper');
    if (cfWrap)   cfWrap.style.display = 'none';

    // Ensure the Risk wrapper exists
    _wrapper = document.getElementById('risk-wrapper');
    if (!_wrapper) {
      _wrapper = document.createElement('div');
      _wrapper.id        = 'risk-wrapper';
      _wrapper.className = 'risk-wrapper';
      container.appendChild(_wrapper);
    }
    _wrapper.style.display = 'flex';
    _wrapper.innerHTML = '';

    // Inject loading message until SVG arrives
    const loading = document.createElement('div');
    loading.className = 'risk-loading';
    loading.textContent = 'Loading map…';
    _wrapper.appendChild(loading);

    // Fetch and inject the SVG inline (so per-path click handlers work)
    fetch(SVG_URL)
      .then(r => r.text())
      .then(svgText => {
        if (_wrapper === null) return; // destroy() ran while loading
        _wrapper.innerHTML = '';
        const mapHost = document.createElement('div');
        mapHost.className = 'risk-map-host';
        mapHost.innerHTML = svgText;
        const svgEl = mapHost.querySelector('svg');
        if (svgEl) {
          svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          svgEl.style.width  = '100%';
          svgEl.style.height = '100%';

          // Wikimedia SVG hides #map inside <defs>; re-parent so the paths
          // render directly and click handlers can reach them.  Then strip
          // the source's <use> overlays (duplicate render) and <text> labels
          // (hardcoded example army counts unrelated to our game state).
          const mapGroup = svgEl.querySelector('defs > g#map');
          if (mapGroup) svgEl.appendChild(mapGroup);
          svgEl.querySelectorAll('use').forEach(u => u.remove());
          svgEl.querySelectorAll('text').forEach(t => t.remove());
        }
        _wrapper.appendChild(mapHost);
        wireTerritoryHandlers();
        _svgLoaded = true;
        // Repaint with the freshest state we've received (which may be newer
        // than the one captured by this closure if game:updates arrived during
        // the fetch).
        update(_latestState || state);
      })
      .catch(err => {
        console.error('[risk-renderer] failed to load SVG:', err);
        loading.textContent = 'Failed to load map. Refresh and try again.';
      });

    // Render the action panel immediately with the state we already have, so
    // the user sees their phase / buttons without waiting for the SVG fetch.
    _latestState = state;
    renderActionPanel(state, isMyTurn(state), state.turnState?.phase || 'reinforce');
  }

  /** Tiny helper: am I the current player? */
  function isMyTurn(state) {
    const cur = state?.players?.[state?.turnState?.currentPlayerIndex];
    return cur?.userId === _myUserId;
  }

  function wireTerritoryHandlers() {
    _onTerritoryClick = (ev) => {
      const path = ev.target.closest('path[id]');
      if (!path) return;
      const territoryId = path.id;
      const s = _latestState;
      if (!s) return;
      // Ignore non-territory paths (e.g. filter elements)
      if (!s.territories?.[territoryId]) return;
      handleTerritoryClick(territoryId);
    };
    _wrapper.addEventListener('click', _onTerritoryClick);
  }

  // ── click handling (phase-aware) ────────────────────────────────────────────

  function handleTerritoryClick(territoryId) {
    if (!_emit) return; // destroy() ran between click delivery and dispatch
    const s = _latestState;
    if (!s || !isMyTurn(s)) return;

    const phase     = s.turnState?.phase;
    const territory = s.territories[territoryId];
    if (!phase || !territory) return;

    if (phase === 'reinforce') {
      // Click your own territory → place 1 army.
      if (territory.ownerId !== _myUserId) return;
      _emit('placeReinforcement', { territoryId, count: 1 });
      return;
    }

    if (phase === 'attack') {
      if (_selectedFrom === null) {
        // Pick attacker territory
        if (territory.ownerId !== _myUserId) return;
        if (territory.armies < 2) return;
        _selectedFrom = territoryId;
        paintSelection();
        return;
      }
      if (territoryId === _selectedFrom) {
        // Tap again to deselect
        _selectedFrom = null;
        paintSelection();
        return;
      }
      // Click target → attack with max dice.  update()'s auto-clear of
      // _selectedFrom on ownership change guarantees the territory still
      // exists and is still ours.
      const fromArmies = s.territories[_selectedFrom].armies;
      const dice = Math.min(3, fromArmies - 1);
      if (dice < 1) { _selectedFrom = null; paintSelection(); return; }
      _emit('attackTerritory', { from: _selectedFrom, to: territoryId, attackerDice: dice });
      // Keep _selectedFrom so the user can chain attacks
      return;
    }

    if (phase === 'fortify') {
      if (s.turnState?.fortifyUsed) return;
      if (territory.ownerId !== _myUserId) return;
      if (_selectedFrom === null) {
        if (territory.armies < 2) return;
        _selectedFrom = territoryId;
        paintSelection();
        return;
      }
      if (territoryId === _selectedFrom) {
        _selectedFrom = null;
        paintSelection();
        return;
      }
      const fromArmies = s.territories[_selectedFrom].armies;
      const max    = fromArmies - 1;
      const raw    = prompt(`Move how many armies (1–${max})?`, String(max));
      const count  = parseInt(raw, 10);
      if (!Number.isFinite(count) || count < 1 || count > max) {
        _selectedFrom = null;
        paintSelection();
        return;
      }
      _emit('fortify', { from: _selectedFrom, to: territoryId, count });
      _selectedFrom = null;
    }
  }

  function paintSelection() {
    const host = _wrapper?.querySelector('svg');
    if (!host) return;
    host.querySelectorAll('path[id]').forEach(p => p.classList.remove('risk-selected'));
    if (_selectedFrom) {
      const el = host.querySelector(`#${cssEscape(_selectedFrom)}`);
      if (el) el.classList.add('risk-selected');
    }
  }

  function cssEscape(id) {
    return CSS.escape(id);
  }

  // ── update ──────────────────────────────────────────────────────────────────

  function update(state) {
    if (!_wrapper || !state) return;

    _latestState = state;
    const myTurn  = isMyTurn(state);
    const phase   = state.turnState?.phase || 'reinforce';

    // Always-runs: render action panel.  Doesn't depend on the SVG being
    // loaded, so the user sees their controls immediately.
    renderActionPanel(state, myTurn, phase);

    // SVG-dependent: paint territory ownership colours + army markers.
    if (_svgLoaded) {
      const svg = _wrapper.querySelector('svg');
      if (svg) {
        for (const t of state.config.board.territories) {
          const ts    = state.territories[t.id];
          const el    = svg.querySelector(`#${cssEscape(t.id)}`);
          if (!el) continue;
          const owner = state.players.find(p => p.userId === ts?.ownerId);
          el.style.fill       = owner?.colorHex || '#777';
          el.style.cursor     = 'pointer';
          el.style.transition = 'fill 0.2s, stroke 0.15s, stroke-width 0.15s';
          // Highlight your own territories with a bold stroke so you can
          // identify them at a glance during the reinforce/attack phases.
          el.classList.toggle('risk-mine', owner?.userId === _myUserId);
        }
        paintArmyMarkers(svg, state);
      }
    }

    // Maintain selection highlight
    if (_selectedFrom && state.territories[_selectedFrom]?.ownerId !== _myUserId) {
      _selectedFrom = null;
    }
    paintSelection();
  }

  /**
   * Paint army-count badges directly inside the SVG using native <circle> +
   * <text> elements.  Coordinates use the SVG's own user-space, so the badges
   * stay correctly aligned no matter how the SVG is scaled by CSS — no
   * getBoundingClientRect / matrixTransform math needed.
   */
  function paintArmyMarkers(svg, state) {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Find or create the labels group (sibling of the map paths).
    let labels = svg.querySelector('#risk-army-labels');
    if (!labels) {
      labels = document.createElementNS(SVG_NS, 'g');
      labels.setAttribute('id', 'risk-army-labels');
      labels.setAttribute('pointer-events', 'none');
      svg.appendChild(labels); // append last so it renders on top
    }
    while (labels.firstChild) labels.removeChild(labels.firstChild);

    for (const t of state.config.board.territories) {
      const ts = state.territories[t.id];
      if (!ts || ts.armies === 0) continue;
      const path = svg.querySelector(`#${cssEscape(t.id)}`);
      if (!path) continue;
      const bbox = path.getBBox();
      const cx = bbox.x + bbox.width  / 2;
      const cy = bbox.y + bbox.height / 2;
      const owner = state.players.find(p => p.userId === ts.ownerId);
      const fill  = owner?.colorHex || '#333';

      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('transform', `translate(${cx},${cy})`);

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r',            '11');
      circle.setAttribute('fill',         fill);
      circle.setAttribute('stroke',       '#ffffff');
      circle.setAttribute('stroke-width', '1.6');
      g.appendChild(circle);

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('text-anchor',  'middle');
      text.setAttribute('dy',           '0.35em');
      text.setAttribute('fill',         '#ffffff');
      text.setAttribute('font-size',    '14');
      text.setAttribute('font-weight',  '700');
      text.setAttribute('font-family',  'system-ui, sans-serif');
      text.style.paintOrder            = 'stroke';
      text.setAttribute('stroke',       'rgba(0,0,0,0.5)');
      text.setAttribute('stroke-width', '2');
      text.textContent = String(ts.armies);
      g.appendChild(text);

      // Native SVG tooltip
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${t.name}: ${owner?.username || 'unowned'} (${ts.armies} armies)`;
      g.appendChild(title);

      labels.appendChild(g);
    }
  }

  function renderActionPanel(state, isMyTurn, phase) {
    const titleEl   = document.getElementById('action-title');
    const buttonsEl = document.getElementById('action-buttons');
    const auctionEl = document.getElementById('auction-panel');
    if (auctionEl) auctionEl.style.display = 'none';

    if (!buttonsEl) return;
    buttonsEl.innerHTML = '';

    if (state.status !== 'playing') {
      if (titleEl) titleEl.textContent = 'Game over';
      return;
    }

    const cur = state.players[state.turnState?.currentPlayerIndex];
    if (!isMyTurn) {
      if (titleEl) titleEl.textContent = `${cur?.username || ''}'s ${phase} phase`;
      return;
    }

    // It IS my turn
    const me = state.players.find(p => p.userId === _myUserId);
    if (phase === 'reinforce') {
      const remaining = state.turnState.armiesToPlace;
      if (titleEl) {
        titleEl.textContent = `Reinforce — ${remaining} armies to place`;
      }

      // Trade-cards button (only if hand has a valid set)
      if (me && hasAnyValidCardSet(me.hand || [])) {
        const tradeBtn = button('Trade cards', () => openTradeDialog(me.hand || []));
        buttonsEl.appendChild(tradeBtn);
      }

      const endBtn = button('End reinforce phase', () => _emit('endReinforcePhase', {}));
      endBtn.disabled = remaining > 0;
      buttonsEl.appendChild(endBtn);

      const help = document.createElement('p');
      help.className   = 'risk-help';
      help.textContent = 'Click one of your territories to place an army.';
      buttonsEl.appendChild(help);
    }
    else if (phase === 'attack') {
      if (titleEl) {
        titleEl.textContent = _selectedFrom
          ? `Attack from ${territoryName(state, _selectedFrom)} — click an enemy territory`
          : 'Attack — click one of your territories to attack from';
      }
      buttonsEl.appendChild(button('End attack phase', () => {
        _selectedFrom = null;
        _emit('endAttackPhase', {});
      }));
    }
    else if (phase === 'fortify') {
      const usedFortify = state.turnState.fortifyUsed;
      if (titleEl) {
        titleEl.textContent = usedFortify
          ? 'Fortify used — end your turn'
          : (_selectedFrom
              ? `Fortify from ${territoryName(state, _selectedFrom)} — click a connected territory`
              : 'Fortify — click one of your territories to move armies from');
      }
      buttonsEl.appendChild(button('End turn', () => {
        _selectedFrom = null;
        _emit('endTurn', {});
      }));
    }
  }

  function button(label, onClick) {
    const b = document.createElement('button');
    b.className   = 'action-btn risk-btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // ── card trading dialog ────────────────────────────────────────────────────

  function openTradeDialog(hand) {
    // Simple text-based trade picker — UX placeholder for v1.
    const list = hand.map((c, i) =>
      `${i + 1}. ${c.troopType.toUpperCase()}${c.territoryId ? ` (${c.territoryId})` : ''}`
    ).join('\n');
    const raw = prompt(
      'Pick 3 cards by index (comma-separated, e.g. 1,3,4):\n\n' + list,
      ''
    );
    if (!raw) return;
    const idx = raw.split(',').map(s => parseInt(s.trim(), 10) - 1);
    if (idx.length !== 3 || idx.some(i => !Number.isFinite(i) || i < 0 || i >= hand.length)) {
      alert('You must pick exactly 3 valid card numbers.');
      return;
    }
    const cardIds = idx.map(i => hand[i].id);
    _emit('tradeCards', { cardIds });
  }

  function hasAnyValidCardSet(hand) {
    if (!hand || hand.length < 3) return false;
    for (let i = 0; i < hand.length - 2; i++) {
      for (let j = i + 1; j < hand.length - 1; j++) {
        for (let k = j + 1; k < hand.length; k++) {
          if (isValidCardSet([hand[i], hand[j], hand[k]])) return true;
        }
      }
    }
    return false;
  }

  function isValidCardSet(cards) {
    if (cards.length !== 3) return false;
    const wilds = cards.filter(c => c.troopType === 'wild').length;
    const types = new Set(cards.filter(c => c.troopType !== 'wild').map(c => c.troopType));
    if (wilds >= 1) return true;
    if (types.size === 1) return true;
    if (types.size === 3) return true;
    return false;
  }

  function territoryName(state, id) {
    return state.config?.territoryById?.[id]?.name ||
           state.config?.board?.territories?.find(t => t.id === id)?.name ||
           id;
  }

  // ── onEvent ─────────────────────────────────────────────────────────────────

  function onEvent(event, _state) {
    switch (event.type) {
      case 'ACTION_REJECTED': {
        UIManager.appendLog(`⚠ ${event.data.message}`, 'info');
        const panel = document.getElementById('action-buttons');
        if (panel) {
          panel.style.outline = '2px solid #e53935';
          setTimeout(() => { panel.style.outline = ''; }, 800);
        }
        break;
      }
      case 'DICE_ROLLED':
        SoundManager.playDice();
        SoundManager.playBattle();
        break;
      case 'TERRITORY_CONQUERED':
        SoundManager.playConquest();
        UIManager.appendLog(
          `🏴 ${event.data.username} conquered ${territoryName(_latestState, event.data.to)}`,
          'game',
        );
        break;
      case 'ARMIES_FORTIFIED':
        SoundManager.playFortify();
        break;
      case 'CARDS_TRADED':
        SoundManager.playCardTrade();
        UIManager.appendLog(
          `🃏 ${event.data.username} traded cards for ${event.data.bonusArmies} armies`,
          'game',
        );
        break;
      case 'CARD_DRAWN':
        SoundManager.playCard();
        break;
      case 'PLAYER_ELIMINATED':
        SoundManager.playEliminate();
        UIManager.appendLog(
          event.data.eliminatedBy
            ? `💀 ${event.data.username} eliminated by ${event.data.eliminatedBy}`
            : `💀 ${event.data.username} declared bankruptcy`,
          'game',
        );
        break;
      case 'GAME_OVER':
        SoundManager.playGameOver();
        UIManager.appendLog(`🏆 ${event.data.winner} achieved world domination!`, 'game');
        break;
      // PHASE_CHANGED, REINFORCEMENT_PLACED, ATTACK_DECLARED, CONTINENT_HELD,
      // TURN_SKIPPED — silently accepted (UI updates via update()).
    }
  }

  // ── destroy ─────────────────────────────────────────────────────────────────

  function destroy() {
    if (_wrapper && _onTerritoryClick) {
      _wrapper.removeEventListener('click', _onTerritoryClick);
    }
    if (_wrapper) {
      _wrapper.style.display = 'none';
      _wrapper.innerHTML = '';
    }
    // Restore the other boards' visibility (init() hid both of them).
    const monoBoard = document.getElementById('board');
    if (monoBoard) monoBoard.style.display = '';
    const cfWrap = document.getElementById('connect-four-wrapper');
    if (cfWrap) cfWrap.style.display = '';

    _wrapper          = null;
    _myUserId         = null;
    _emit             = null;
    _selectedFrom     = null;
    _svgLoaded        = false;
    _onTerritoryClick = null;
    _latestState      = null;
  }

  // ── public API ──────────────────────────────────────────────────────────────

  return { init, update, onEvent, destroy };

})();

// Self-register with the framework registry.
GameRendererRegistry.register('risk', RiskRenderer);
