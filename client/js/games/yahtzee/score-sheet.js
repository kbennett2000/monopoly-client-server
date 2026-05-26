/**
 * Yahtzee score sheet — DOM table builder + painter.
 *
 * Owned by the Yahtzee renderer. Split out from renderer.js because the
 * combined file exceeded the ~500 line guideline in the session-2 spec.
 *
 * Responsibilities
 * ────────────────
 *   • Build the score-sheet <table> structure (rebuild on player roster change).
 *   • Paint per-cell values, previews, selection highlights, summary rows.
 *   • Flash a cell when CATEGORY_SCORED fires.
 *
 * NOT responsibilities (renderer.js owns these)
 * ─────────────────────────────────────────────
 *   • Selection state (_selectedCategory) — renderer holds it and passes
 *     it into paint() each call.
 *   • Click handlers — renderer wires onCellClick in rebuild()'s options.
 *   • Dice and roll button — separate concerns.
 *
 * Preview values for unscored categories come from the server-side
 * getActionDescriptors output (state.actionDescriptors) — one
 * scoreCategory descriptor per unscored category, carrying
 * data.previewScore. The renderer's old scoreFor mirror was deleted
 * when this contract landed; see docs/action-descriptors.md.
 *
 * computeTotals stays renderer-side: upper subtotal, lower total, and
 * grand total are display arithmetic over already-visible scoreSheet
 * values, not rule logic. See the resolved decision in
 * docs/renderer-contract.md ("derived view fields stay client-side").
 */

const YahtzeeScoreSheet = (() => {
  // ─── shape constants ─────────────────────────────────────────────────────

  const CATEGORIES = [
    'ones',
    'twos',
    'threes',
    'fours',
    'fives',
    'sixes',
    'threeOfAKind',
    'fourOfAKind',
    'fullHouse',
    'smallStraight',
    'largeStraight',
    'yahtzee',
    'chance',
  ];
  const UPPER = new Set(['ones', 'twos', 'threes', 'fours', 'fives', 'sixes']);

  const CATEGORY_META = {
    ones: { label: 'Ones', hint: 'Sum of 1s' },
    twos: { label: 'Twos', hint: 'Sum of 2s' },
    threes: { label: 'Threes', hint: 'Sum of 3s' },
    fours: { label: 'Fours', hint: 'Sum of 4s' },
    fives: { label: 'Fives', hint: 'Sum of 5s' },
    sixes: { label: 'Sixes', hint: 'Sum of 6s' },
    threeOfAKind: { label: '3 of a Kind', hint: 'Sum of all dice (need ≥3 same)' },
    fourOfAKind: { label: '4 of a Kind', hint: 'Sum of all dice (need ≥4 same)' },
    fullHouse: { label: 'Full House', hint: '3 + 2 of two values' },
    smallStraight: { label: 'Small Straight', hint: '4 consecutive faces' },
    largeStraight: { label: 'Large Straight', hint: '5 consecutive faces' },
    yahtzee: { label: 'Yahtzee', hint: '5 of a kind' },
    chance: { label: 'Chance', hint: 'Sum of all dice' },
  };

  // ─── rebuild ─────────────────────────────────────────────────────────────

  /**
   * Build (or rebuild) the table structure. Cheap to call; the renderer only
   * invokes it on first paint and on roster-shape change.
   *
   * @param {HTMLTableElement} table
   * @param {Object[]} players       state.players
   * @param {Object}   options
   * @param {Function} options.onCellClick(category, userId)
   */
  function rebuild(table, players, options) {
    table.innerHTML = '';
    const onCellClick = options?.onCellClick || (() => {});

    const thead = document.createElement('thead');
    const headTr = document.createElement('tr');
    headTr.appendChild(thEl('Category', 'yz-cat-col'));
    players.forEach((p) => {
      const th = thEl(`${p.token || ''} ${p.username}`.trim(), 'yz-player-col');
      th.dataset.userId = p.userId;
      th.style.color = p.colorHex || '';
      headTr.appendChild(th);
    });
    headTr.appendChild(thEl('Hint', 'yz-hint-col'));
    thead.appendChild(headTr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const cat of CATEGORIES.filter((c) => UPPER.has(c))) {
      tbody.appendChild(buildCategoryRow(cat, players, onCellClick));
    }
    tbody.appendChild(buildSummaryRow('upperSubtotal', 'Upper Subtotal', players));
    tbody.appendChild(buildSummaryRow('upperBonus', 'Upper Bonus (+35 if ≥63)', players));

    // Visual separator between upper and lower sections.
    const sep = document.createElement('tr');
    sep.className = 'yz-row-sep';
    const sepTd = document.createElement('td');
    sepTd.colSpan = players.length + 2;
    sep.appendChild(sepTd);
    tbody.appendChild(sep);

    for (const cat of CATEGORIES.filter((c) => !UPPER.has(c))) {
      tbody.appendChild(buildCategoryRow(cat, players, onCellClick));
    }
    tbody.appendChild(buildSummaryRow('lowerTotal', 'Lower Total', players));
    tbody.appendChild(buildSummaryRow('grandTotal', 'Grand Total', players, true));
    table.appendChild(tbody);
  }

  function thEl(text, cls) {
    const th = document.createElement('th');
    th.className = cls;
    th.textContent = text;
    return th;
  }

  function buildCategoryRow(cat, players, onCellClick) {
    const meta = CATEGORY_META[cat];
    const tr = document.createElement('tr');
    tr.dataset.category = cat;
    tr.className = 'yz-cat-row';

    const labelTd = document.createElement('td');
    labelTd.className = 'yz-cat-label';
    labelTd.textContent = meta.label;
    tr.appendChild(labelTd);

    for (const p of players) {
      const td = document.createElement('td');
      td.className = 'yz-score-cell';
      td.dataset.userId = p.userId;
      td.dataset.category = cat;
      td.textContent = '—';
      td.addEventListener('click', () => onCellClick(cat, p.userId));
      tr.appendChild(td);
    }

    const hintTd = document.createElement('td');
    hintTd.className = 'yz-hint';
    hintTd.textContent = meta.hint;
    tr.appendChild(hintTd);
    return tr;
  }

  function buildSummaryRow(kind, label, players, grand = false) {
    const tr = document.createElement('tr');
    tr.className = grand ? 'yz-summary-row yz-grand-row' : 'yz-summary-row';
    tr.dataset.summary = kind;

    const labelTd = document.createElement('td');
    labelTd.className = 'yz-cat-label';
    labelTd.textContent = label;
    tr.appendChild(labelTd);

    for (const p of players) {
      const td = document.createElement('td');
      td.className = 'yz-summary-cell';
      td.dataset.userId = p.userId;
      td.dataset.summary = kind;
      td.textContent = '0';
      tr.appendChild(td);
    }
    const hintTd = document.createElement('td');
    hintTd.className = 'yz-hint';
    tr.appendChild(hintTd);
    return tr;
  }

  // ─── paint ───────────────────────────────────────────────────────────────

  /**
   * Repaint every cell from current state.
   *
   * @param {Object} state
   * @param {Object} ctx
   * @param {string} ctx.myUserId
   * @param {string|null} ctx.selectedCategory  Category awaiting commit-click.
   */
  function paint(state, ctx) {
    const { myUserId, selectedCategory } = ctx;
    const curIdx = state.turnState.currentPlayerIndex;
    const cur = state.players[curIdx];
    const isMyTurn = cur?.userId === myUserId;
    const playing = state.status === 'playing';
    const finished = state.status === 'finished';
    const rollsUsed = state.turnState.rollsUsed;
    const dice = state.turnState.dice;

    const totals = state.players.map((p) => computeTotals(p.scoreSheet, state.config));
    const topGrand = Math.max(...totals.map((t) => t.grandTotal));

    // Column header highlights
    document.querySelectorAll('#yz-sheet thead th[data-user-id]').forEach((th) => {
      const isCur = playing && th.dataset.userId === cur?.userId;
      th.classList.toggle('yz-col-current', isCur);
      th.classList.toggle('yz-col-me', th.dataset.userId === myUserId);
      const idx = state.players.findIndex((p) => p.userId === th.dataset.userId);
      const isWinner = finished && totals[idx]?.grandTotal === topGrand;
      th.classList.toggle('yz-col-winner', isWinner);
    });

    // Category cells
    for (const cat of CATEGORIES) {
      for (const p of state.players) {
        const td = document.querySelector(
          `#yz-sheet td.yz-score-cell[data-user-id="${p.userId}"][data-category="${cat}"]`,
        );
        if (!td) continue;
        const v = p.scoreSheet[cat];

        td.classList.remove(
          'yz-cell-scored',
          'yz-cell-preview',
          'yz-cell-selected',
          'yz-cell-empty',
          'yz-cell-locked',
          'yz-col-current',
          'yz-col-me',
        );
        td.classList.toggle('yz-col-current', playing && p.userId === cur?.userId);
        td.classList.toggle('yz-col-me', p.userId === myUserId);
        td.style.removeProperty('color');

        if (v !== null) {
          td.textContent = String(v);
          td.classList.add('yz-cell-scored', 'yz-cell-locked');
          if (v === 0) td.style.color = 'var(--text-muted, #9aa0a6)';
        } else if (
          isMyTurn &&
          playing &&
          rollsUsed >= 1 &&
          dice.length > 0 &&
          p.userId === myUserId
        ) {
          // Preview score comes from the server-supplied descriptor.
          // No fallback: if descriptors are absent, the cell renders
          // blank rather than re-deriving from rule logic.
          const desc = findScoreDescriptor(state, cat);
          if (desc) {
            td.textContent = String(desc.data.previewScore);
            td.classList.add('yz-cell-preview');
            if (selectedCategory === cat) td.classList.add('yz-cell-selected');
          } else {
            td.textContent = '—';
            td.classList.add('yz-cell-empty');
          }
        } else {
          td.textContent = '—';
          td.classList.add('yz-cell-empty');
        }
      }
    }

    // Summary cells
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      const t = totals[i];
      setSummary(p.userId, 'upperSubtotal', t.upperSubtotal);
      setSummary(p.userId, 'upperBonus', t.upperBonus);
      setSummary(p.userId, 'lowerTotal', t.lowerTotal);
      setSummary(p.userId, 'grandTotal', t.grandTotal);
      document
        .querySelectorAll(`#yz-sheet td.yz-summary-cell[data-user-id="${p.userId}"]`)
        .forEach((td) => {
          td.classList.toggle('yz-col-current', playing && p.userId === cur?.userId);
          td.classList.toggle('yz-col-me', p.userId === myUserId);
          td.classList.toggle('yz-col-winner', finished && t.grandTotal === topGrand);
        });
    }
  }

  function setSummary(userId, kind, value) {
    const td = document.querySelector(
      `#yz-sheet td.yz-summary-cell[data-user-id="${userId}"][data-summary="${kind}"]`,
    );
    if (td) td.textContent = String(value);
  }

  function flashCell(state, username, category) {
    const p = state.players.find((pp) => pp.username === username);
    if (!p) return;
    const td = document.querySelector(
      `#yz-sheet td.yz-score-cell[data-user-id="${p.userId}"][data-category="${category}"]`,
    );
    if (!td) return;
    td.classList.add('yz-cell-flash');
    setTimeout(() => td.classList.remove('yz-cell-flash'), 800);
  }

  // ─── descriptor lookup ───────────────────────────────────────────────────

  /**
   * Find the scoreCategory descriptor for a given category from the
   * server-supplied state.actionDescriptors list. Returns undefined when
   * no descriptor exists for that category (already scored, pre-roll, or
   * not the player's turn). The renderer uses this for both the preview
   * value (data.previewScore) and the per-category enabled gate.
   */
  function findScoreDescriptor(state, category) {
    return state.actionDescriptors?.find(
      (d) => d.action === 'scoreCategory' && d.data?.category === category,
    );
  }

  function computeTotals(scoreSheet, config) {
    let upperSubtotal = 0;
    for (const c of CATEGORIES) {
      if (UPPER.has(c) && typeof scoreSheet[c] === 'number') upperSubtotal += scoreSheet[c];
    }
    const upperBonus =
      upperSubtotal >= config.settings.upperBonusThreshold ? config.settings.upperBonus : 0;
    let lowerTotal = 0;
    for (const c of CATEGORIES) {
      if (!UPPER.has(c) && typeof scoreSheet[c] === 'number') lowerTotal += scoreSheet[c];
    }
    return {
      upperSubtotal,
      upperBonus,
      lowerTotal,
      grandTotal: upperSubtotal + upperBonus + lowerTotal,
    };
  }

  return { rebuild, paint, flashCell, CATEGORIES };
})();
