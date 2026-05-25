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

// Diagnostic: log on file load so we can confirm the LATEST renderer is running
// rather than a stale browser-cached version.  Look for "[risk-renderer] v3"
// in the browser console.
console.log('[risk-renderer] v3 loaded at', new Date().toISOString());

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

    console.log('[risk-renderer] init() called, status=', state?.status, 'myUserId=', myUserId, 'gameType=', state?.gameType);

    // Fetch and inject the SVG inline (so per-path click handlers work)
    fetch(SVG_URL)
      .then(r => { console.log('[risk-renderer] SVG fetch status:', r.status); return r.text(); })
      .then(svgText => {
        if (_wrapper === null) { console.warn('[risk-renderer] wrapper gone, aborting'); return; }
        console.log('[risk-renderer] SVG bytes:', svgText.length);
        _wrapper.innerHTML = '';
        const mapHost = document.createElement('div');
        mapHost.className = 'risk-map-host';
        mapHost.innerHTML = svgText;
        const svgEl = mapHost.querySelector('svg');
        if (svgEl) {
          svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          svgEl.style.width  = '100%';
          svgEl.style.height = '100%';

          // Structural rewrite of the Wikimedia SVG:
          //
          // 1. <g id="map"> (which contains the 42 territory <path>s) lives
          //    inside <defs>.  Elements in <defs> are NOT directly rendered
          //    and are NOT clickable — they only appear via <use> references.
          //    Move the group out of <defs> and into the SVG body so the
          //    paths render directly and our click handlers can reach them.
          //
          // 2. The source SVG then renders the map THREE times via <use>
          //    overlays (blue rim, white inner stroke, textured pass).  Now
          //    that the map is already in the main tree we remove the <use>
          //    duplicates — otherwise the map would render twice.
          //
          // 3. The source hardcodes 42 territory labels with example army
          //    counts ("1 Alaska", "6 Northwest Territory", …) that have
          //    nothing to do with our game state.  Strip every <text> so
          //    only our overlay markers (real army counts) appear.
          const mapGroup = svgEl.querySelector('defs > g#map');
          if (mapGroup) {
            svgEl.appendChild(mapGroup); // re-parent to SVG root
          }
          svgEl.querySelectorAll('use').forEach(u => u.remove());
          svgEl.querySelectorAll('text').forEach(t => t.remove());
          console.log('[risk-renderer] after cleanup — paths:', svgEl.querySelectorAll('path[id]').length,
                      'g#map in defs:', !!svgEl.querySelector('defs > g#map'));
        }
        _wrapper.appendChild(mapHost);
        wireTerritoryHandlers(state);
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
    stashTurnMeta(state);
  }

  /** Tiny helper: am I the current player? */
  function isMyTurn(state) {
    const cur = state?.players?.[state?.turnState?.currentPlayerIndex];
    return cur?.userId === _myUserId;
  }

  /** Cache decision-affecting data on the wrapper so the click handler can read it. */
  function stashTurnMeta(state) {
    if (!_wrapper) return;
    _wrapper.dataset.phase       = state.turnState?.phase || '';
    _wrapper.dataset.isMyTurn    = String(isMyTurn(state));
    _wrapper.dataset.fortifyUsed = String(!!state.turnState?.fortifyUsed);
    for (const t of state.config.board.territories) {
      const ts = state.territories[t.id];
      _wrapper.dataset[`owner_${t.id}`]  = ts?.ownerId || '';
      _wrapper.dataset[`armies_${t.id}`] = String(ts?.armies || 0);
    }
  }

  function wireTerritoryHandlers(state) {
    _onTerritoryClick = (ev) => {
      const path = ev.target.closest('path[id]');
      if (!path) return;
      const territoryId = path.id;
      // Ignore non-territory paths (e.g. filter elements)
      if (!state.territories[territoryId] &&
          !(state.config?.board?.territories || []).some(t => t.id === territoryId)) {
        return;
      }
      handleTerritoryClick(territoryId);
    };
    _wrapper.addEventListener('click', _onTerritoryClick);
  }

  // ── click handling (phase-aware) ────────────────────────────────────────────

  function handleTerritoryClick(territoryId) {
    // Read the most recent state from the renderer's last-known cache via a
    // synthetic re-read of the DOM-attached app state would be ideal; for v1
    // we re-read the current selection logic from data attributes painted by
    // update().  For simplicity, dispatch by reading current phase off the DOM.
    const phase = _wrapper?.dataset?.phase;
    if (!phase) return;

    if (phase === 'reinforce') {
      // Click your own territory → place 1 army.  Shift-click for +5.
      if (_wrapper.dataset.isMyTurn !== 'true') return;
      if (_wrapper.dataset[`owner_${territoryId}`] !== _myUserId) return;
      _emit('placeReinforcement', { territoryId, count: 1 });
      return;
    }

    if (phase === 'attack') {
      if (_wrapper.dataset.isMyTurn !== 'true') return;
      if (_selectedFrom === null) {
        // Pick attacker territory
        if (_wrapper.dataset[`owner_${territoryId}`] !== _myUserId) return;
        if (parseInt(_wrapper.dataset[`armies_${territoryId}`] || '0', 10) < 2) return;
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
      // Click target → attack with max dice
      const armies = parseInt(_wrapper.dataset[`armies_${_selectedFrom}`] || '0', 10);
      const dice   = Math.min(3, armies - 1);
      _emit('attackTerritory', { from: _selectedFrom, to: territoryId, attackerDice: dice });
      // Keep _selectedFrom so the user can chain attacks
      return;
    }

    if (phase === 'fortify') {
      if (_wrapper.dataset.isMyTurn !== 'true') return;
      if (_wrapper.dataset.fortifyUsed === 'true') return;
      if (_wrapper.dataset[`owner_${territoryId}`] !== _myUserId) return;
      if (_selectedFrom === null) {
        if (parseInt(_wrapper.dataset[`armies_${territoryId}`] || '0', 10) < 2) return;
        _selectedFrom = territoryId;
        paintSelection();
        return;
      }
      if (territoryId === _selectedFrom) {
        _selectedFrom = null;
        paintSelection();
        return;
      }
      const armies = parseInt(_wrapper.dataset[`armies_${_selectedFrom}`] || '0', 10);
      const max    = armies - 1;
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
    // CSS.escape may not be available in some environments; fall back manually.
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
    return id.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  }

  // ── update ──────────────────────────────────────────────────────────────────

  function update(state) {
    if (!_wrapper || !state) return;

    _latestState = state;
    const myTurn  = isMyTurn(state);
    const phase   = state.turnState?.phase || 'reinforce';

    // Always-runs: stash turn meta + render action panel.  These don't depend
    // on the SVG being loaded, so the user sees their controls immediately.
    stashTurnMeta(state);
    renderActionPanel(state, myTurn, phase);

    // SVG-dependent: paint territory ownership colours + army markers.
    if (_svgLoaded) {
      const svg = _wrapper.querySelector('svg');
      if (svg) {
        let painted = 0;
        let foundPaths = 0;
        for (const t of state.config.board.territories) {
          const ts    = state.territories[t.id];
          const el    = svg.querySelector(`#${cssEscape(t.id)}`);
          if (el) foundPaths++;
          const owner = state.players.find(p => p.userId === ts?.ownerId);
          if (el) {
            const fill = owner?.colorHex || '#777';
            // Belt-and-suspenders: setAttribute overrides the SVG's original
            // fill="..." presentation attribute; style.fill wins over any CSS.
            el.setAttribute('fill', fill);
            el.style.fill       = fill;
            el.style.cursor     = 'pointer';
            el.style.transition = 'fill 0.2s, stroke 0.15s, stroke-width 0.15s';
            // Highlight your own territories with a bold stroke so you can
            // identify them at a glance during the reinforce/attack phases.
            el.classList.toggle('risk-mine', owner?.userId === _myUserId);
            painted++;
          }
        }
        console.log('[risk-renderer] update() painted',  painted, '/', foundPaths, 'paths found out of',
                    state.config.board.territories.length, 'territories in state');
        paintArmyMarkers(svg, state);
      } else {
        console.warn('[risk-renderer] update() — _svgLoaded true but no <svg> in wrapper');
      }
    } else {
      console.log('[risk-renderer] update() — SVG not loaded yet, skipping map paint');
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
      let bbox;
      try { bbox = path.getBBox(); } catch (_) { continue; }
      if (!bbox || (bbox.width === 0 && bbox.height === 0)) continue;

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
    if (!hand.length) return;
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
          `🏴 ${event.data.username} conquered ${event.data.to}`,
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
      // Clear all painted data attributes
      Object.keys(_wrapper.dataset).forEach(k => { delete _wrapper.dataset[k]; });
    }
    // Restore other boards' visibility so the next renderer can take over
    const monoBoard = document.getElementById('board');
    if (monoBoard) monoBoard.style.display = '';

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
