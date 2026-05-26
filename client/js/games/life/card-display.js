/**
 * card-display.js
 *
 * Right-hand panel inside the board wrapper.  Shows the local player's
 * inventory (career, salary, house, insurance, stock, life tiles) and a
 * compact summary of every other player.  At game over, life tiles
 * flip face-up with a per-tile staggered animation and the final
 * scoring breakdown appears.
 *
 * ─── Display split ──────────────────────────────────────────────────────────
 *
 *   ┌─ #life-inventory-container ────────────────────────────────────────┐
 *   │  ┌─ MY card (full) ─────────────────────────────────────────────┐  │
 *   │  │  Cash · Career · Salary · House                              │  │
 *   │  │  Spouse · Children · Insurance · Stock                       │  │
 *   │  │  Life tiles (face-down "?" stack; flipped on game over)      │  │
 *   │  └──────────────────────────────────────────────────────────────┘  │
 *   │  ┌─ OPPONENT cards (compact) ───────────────────────────────────┐  │
 *   │  │  one row per other player                                     │  │
 *   │  │  career name · cash · pegs · insurance · stock · tile count  │  │
 *   │  └──────────────────────────────────────────────────────────────┘  │
 *   │  ┌─ Game-over panel (hidden until status=finished) ─────────────┐  │
 *   │  │  Per-player score breakdown + life-tile reveal animation     │  │
 *   │  └──────────────────────────────────────────────────────────────┘  │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * ─── Hidden information ────────────────────────────────────────────────────
 *
 * Per the session-2b spec, opponents' life tile VALUES are not visible
 * during the game.  The server filter (getStateForPlayer) replaces an
 * opponent's lifeTiles array with lifeTilesCount.  The renderer respects
 * that — opponent rows show "N tiles" without values, even though the
 * server might leak full values in a fluke (we still treat lifeTilesCount
 * as authoritative for opponents).
 *
 * The local player's own state always carries full tile values, so the
 * private card shows them as "?" face-down placeholders (the player
 * theoretically knows their tiles, but the suspense of the reveal is the
 * whole point — we keep them hidden until game over for that player too).
 *
 * ─── Game-over reveal ──────────────────────────────────────────────────────
 *
 * Triggered by the GAME_OVER event (not by status='finished' alone — the
 * reveal is a one-shot animation that must not replay on rejoin).  For
 * each player, in turn order:
 *   • Show their score components: cash, house, children bonus
 *   • Flip life tiles face-up one at a time (~300ms each)
 *   • Show running total as each tile is revealed
 * Then highlight the winner(s).
 *
 * If the player rejoins after game over (state.status='finished'), the
 * tiles are already revealed in state thanks to the server's reveal-at-
 * finished filter.  We then render the final scoreboard statically with
 * tiles already visible — no animation.
 */

const LifeCardDisplay = (() => {
  let _container = null;
  let _myUserId = null;
  // Track whether we've already played the GAME_OVER reveal animation so a
  // late state push (or a multi-event batch) can't replay it.
  let _gameOverRevealed = false;

  // ── mount/update/unmount ────────────────────────────────────────────────

  function mount(container, state, myUserId) {
    _container = container;
    _myUserId = myUserId;
    _gameOverRevealed = false;

    container.innerHTML = '';
    container.appendChild(buildSkeleton());

    update(state);
  }

  function update(state) {
    if (!_container) return;
    renderMyInventory(state);
    renderOpponents(state);
    // Static final scoreboard for rejoin-after-game-over.  Suppress once
    // the GAME_OVER animation has played for this session — otherwise a
    // subsequent state push (chat, idle ping) would clobber the running
    // tile-flip animation by re-rendering the static panel.
    if (state.status === 'finished' && !_gameOverRevealed) {
      renderGameOverStatic(state);
    }
  }

  function onEvent(event, state) {
    if (event.type === 'GAME_OVER') {
      if (_gameOverRevealed) return;
      _gameOverRevealed = true;
      runGameOverReveal(event.data, state);
    }
  }

  function unmount() {
    if (_container) _container.innerHTML = '';
    _container = null;
    _myUserId = null;
    _gameOverRevealed = false;
  }

  // ── skeleton ───────────────────────────────────────────────────────────

  function buildSkeleton() {
    const root = document.createElement('div');
    root.className = 'life-inventory';

    const my = document.createElement('section');
    my.id = 'life-my-card';
    my.className = 'life-my-card';
    root.appendChild(my);

    const opp = document.createElement('section');
    opp.id = 'life-opponents';
    opp.className = 'life-opponents';
    root.appendChild(opp);

    const finale = document.createElement('section');
    finale.id = 'life-game-over';
    finale.className = 'life-game-over';
    finale.style.display = 'none';
    root.appendChild(finale);

    return root;
  }

  // ── current-player inventory ───────────────────────────────────────────

  function renderMyInventory(state) {
    const el = document.getElementById('life-my-card');
    if (!el) return;
    const me = state.players.find((p) => p.userId === _myUserId);
    if (!me) {
      el.innerHTML = '<p class="life-card-empty">Spectating</p>';
      return;
    }

    const career = me.career
      ? `${escapeHtml(me.career.name)} <small>(+$${(me.career.paydayBonus || 0).toLocaleString()}/payday)</small>`
      : '<em>none</em>';
    const salary = me.salary
      ? `$${me.salary.amount.toLocaleString()}`
      : '<em>none</em>';
    const house = me.house
      ? `${escapeHtml(me.house.name)} <small>(value $${me.house.value.toLocaleString()})</small>`
      : '<em>none</em>';
    const pegs = pegsSummary(me);
    const insurance = insuranceSummary(me);
    const stock = me.stockNumber != null ? `#${me.stockNumber}` : '<em>none</em>';

    // Life tiles: face-down placeholders until game over.
    const tileCount = (me.lifeTiles || []).length;
    const tilesHtml = tileCount > 0
      ? Array(tileCount).fill('<span class="life-tile-face-down">?</span>').join('')
      : '<em>none yet</em>';

    el.innerHTML = `
      <h4 class="life-card-name">${escapeHtml(me.username)} ${me.token || ''}</h4>
      <div class="life-card-row"><label>Cash</label> <strong>$${me.cash.toLocaleString()}</strong></div>
      <div class="life-card-row"><label>Career</label> <span>${career}</span></div>
      <div class="life-card-row"><label>Salary</label> <span>${salary}</span></div>
      <div class="life-card-row"><label>House</label> <span>${house}</span></div>
      <div class="life-card-row"><label>Family</label> <span>${pegs}</span></div>
      <div class="life-card-row"><label>Insurance</label> <span>${insurance}</span></div>
      <div class="life-card-row"><label>Stock</label> <span>${stock}</span></div>
      <div class="life-card-row life-card-tiles"><label>Life tiles</label> <span class="life-tiles-stack">${tilesHtml}</span></div>
      ${me.retired ? '<div class="life-retired-tag">Retired</div>' : ''}
    `;
  }

  // ── opponent summaries ─────────────────────────────────────────────────

  function renderOpponents(state) {
    const el = document.getElementById('life-opponents');
    if (!el) return;
    const opponents = state.players.filter((p) => p.userId !== _myUserId);
    if (opponents.length === 0) {
      el.innerHTML = '';
      return;
    }

    const rows = opponents.map((p) => {
      const colorHex = p.colorHex || '#888';
      const career = p.career ? escapeHtml(p.career.name) : '—';
      const tileCount = typeof p.lifeTilesCount === 'number'
        ? p.lifeTilesCount
        : (p.lifeTiles || []).length;
      const insurance = insuranceSummary(p);
      const stock = p.stockNumber != null ? `#${p.stockNumber}` : '—';
      const pegs = pegsSummary(p);
      const retiredBadge = p.retired ? '<span class="life-opp-retired">✓ retired</span>' : '';
      return `
        <div class="life-opp-row">
          <span class="life-opp-dot" style="background:${escapeHtml(colorHex)}"></span>
          <span class="life-opp-name">${escapeHtml(p.username)}${retiredBadge}</span>
          <span class="life-opp-cash">$${p.cash.toLocaleString()}</span>
          <span class="life-opp-meta">${career} · ${pegs} · ${insurance} · stock ${stock} · ${tileCount} tile${tileCount === 1 ? '' : 's'}</span>
        </div>
      `;
    }).join('');

    el.innerHTML = `<h4>Other players</h4>${rows}`;
  }

  function pegsSummary(p) {
    const parts = [];
    if (p.spouse) parts.push('💍');
    if (p.children) parts.push(`👶×${p.children}`);
    return parts.length === 0 ? '<em>solo</em>' : parts.join(' ');
  }

  function insuranceSummary(p) {
    const a = p.autoInsurance ? '🚗' : '';
    const l = p.lifeInsurance ? '🏥' : '';
    if (!a && !l) return '—';
    return [a, l].filter(Boolean).join(' ');
  }

  // ── game over: static rendering (rejoin path) ──────────────────────────

  function renderGameOverStatic(state) {
    const el = document.getElementById('life-game-over');
    if (!el) return;
    el.style.display = 'block';
    // No event data on rejoin — fall back to recomputing from state.
    // Find the GAME_OVER event payload would have all the info; we
    // reconstruct what we need from state directly.
    const { childScoreBonus } = state.config.settings;
    const winnerIds = Array.isArray(state.winner) ? state.winner : (state.winner ? [state.winner] : []);
    const rows = state.players.map((p) => buildFinalScoreRow(p, childScoreBonus, winnerIds)).join('');
    el.innerHTML = `<h3>Final scores</h3>${rows}`;
  }

  function buildFinalScoreRow(player, childScoreBonus, winnerIds) {
    const cash = player.cash;
    const house = player.house?.value || 0;
    const tiles = (player.lifeTiles || []).reduce((s, t) => s + (t.value || 0), 0);
    const children = (player.children || 0) * childScoreBonus;
    const meIsLoser =
      player.retiredTo === 'millionaire-estates' && !winnerIds.includes(player.userId);
    const total = meIsLoser ? 0 : cash + house + tiles + children;
    const winnerBadge = winnerIds.includes(player.userId)
      ? '<span class="life-winner-badge">🏆</span>'
      : '';
    const tileList = (player.lifeTiles || [])
      .map((t) => `<span class="life-tile-revealed">${escapeHtml(t.name)} · $${t.value.toLocaleString()}</span>`)
      .join('');

    return `
      <div class="life-score-row ${meIsLoser ? 'life-score-melost' : ''}">
        <h4>${winnerBadge}${escapeHtml(player.username)} ${player.retiredTo === 'millionaire-estates' ? '· ME' : '· CA'}</h4>
        <div class="life-score-line">Cash: $${cash.toLocaleString()}</div>
        <div class="life-score-line">House: $${house.toLocaleString()}</div>
        <div class="life-score-line">Life tiles: $${tiles.toLocaleString()}</div>
        <div class="life-score-line">Children bonus: $${children.toLocaleString()}</div>
        <div class="life-score-total">Total: <strong>$${total.toLocaleString()}</strong>${meIsLoser ? ' <em>(ME gamble lost)</em>' : ''}</div>
        ${tileList ? `<div class="life-tile-list">${tileList}</div>` : ''}
      </div>
    `;
  }

  // ── game over: animated reveal ─────────────────────────────────────────

  function runGameOverReveal(payload, state) {
    const el = document.getElementById('life-game-over');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = '<h3>Final scores</h3>';

    const winnerIds = Array.isArray(payload.winner)
      ? payload.winner
      : (payload.winner ? [payload.winner] : []);

    // Build a "scaffold" for each player — score lines visible up front,
    // tile slots empty so the animation can fill them in.
    const playerOrder = state.players.slice(); // copy
    const rows = playerOrder.map((p) => {
      const score = payload.finalScores?.[p.userId];
      const row = document.createElement('div');
      row.className = 'life-score-row';
      if (score && p.retiredTo === 'millionaire-estates' && !winnerIds.includes(p.userId)) {
        row.classList.add('life-score-melost');
      }
      const winnerBadge = winnerIds.includes(p.userId)
        ? '<span class="life-winner-badge">🏆</span>'
        : '';
      row.innerHTML = `
        <h4>${winnerBadge}${escapeHtml(p.username)} ${p.retiredTo === 'millionaire-estates' ? '· ME' : '· CA'}</h4>
        <div class="life-score-line">Cash: $${(score?.cash || 0).toLocaleString()}</div>
        <div class="life-score-line">House: $${(score?.house || 0).toLocaleString()}</div>
        <div class="life-score-line">Children bonus: $${(score?.childrenBonus || 0).toLocaleString()}</div>
        <div class="life-score-line life-tile-line">Life tiles: <span class="life-tile-running">$0</span></div>
        <div class="life-tile-reveal-row"></div>
        <div class="life-score-total">Total: <strong class="life-total-running">$${((score?.cash || 0) + (score?.house || 0) + (score?.childrenBonus || 0)).toLocaleString()}</strong></div>
      `;
      el.appendChild(row);
      return { row, player: p, score };
    });

    // Reveal tiles per player, staggered.
    let delayMs = 400;
    for (const { row, player, score } of rows) {
      const tiles = score?.lifeTiles || player.lifeTiles || [];
      const revealRow = row.querySelector('.life-tile-reveal-row');
      const runningEl = row.querySelector('.life-tile-running');
      const totalEl = row.querySelector('.life-total-running');
      let running = 0;
      const baseTotal = (score?.cash || 0) + (score?.house || 0) + (score?.childrenBonus || 0);
      tiles.forEach((tile, i) => {
        setTimeout(() => {
          const card = document.createElement('span');
          card.className = 'life-tile-revealed life-tile-flip-in';
          card.innerHTML = `<strong>${escapeHtml(tile.name)}</strong><br>$${tile.value.toLocaleString()}`;
          revealRow.appendChild(card);
          running += tile.value || 0;
          if (runningEl) runningEl.textContent = `$${running.toLocaleString()}`;
          if (totalEl) totalEl.textContent = `$${(baseTotal + running).toLocaleString()}`;
        }, delayMs + i * 300);
      });
      // Final ME-lost adjustment: if the player lost the ME gamble, after
      // all tiles flip, replace the total with $0 and an explanation.
      if (
        player.retiredTo === 'millionaire-estates' &&
        !winnerIds.includes(player.userId)
      ) {
        setTimeout(() => {
          if (totalEl) totalEl.textContent = '$0';
          const note = document.createElement('em');
          note.className = 'life-melost-note';
          note.textContent = ' (ME gamble lost)';
          totalEl?.parentElement?.appendChild(note);
        }, delayMs + tiles.length * 300 + 200);
      }
      delayMs += tiles.length * 300 + 500;
    }
  }

  // ── utility ────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { mount, update, onEvent, unmount };
})();
