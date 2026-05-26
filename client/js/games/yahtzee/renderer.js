/**
 * Yahtzee renderer — GameRenderer interface implementation.
 *
 * Self-registers with GameRendererRegistry at module load time.
 * The framework (app.js, socket-client.js) interacts with this module
 * exclusively through the registry; no direct references to this global.
 *
 * Implements: init / update / onEvent / destroy
 *
 * ─── Layout decision ────────────────────────────────────────────────────────
 * Chose layout (a) from docs/renderer-contract.md "score-sheet question":
 * a single shared table with players as columns and categories as rows. The
 * current player's column lights up with score previews on unscored
 * categories; opponents' unscored cells stay blank ("—").
 *
 * Why (a) over (b) and (c):
 *   • Canonical paper-Yahtzee layout — recognised instantly.
 *   • Side-by-side player columns put comparison data exactly where Yahtzee
 *     players want it (you finish scoring Threes; you immediately see what
 *     everyone else got in Threes — that informs your next category pick).
 *   • At expected 2-4 players the table is comfortably wide; at 5-8 it stays
 *     legible on a 1366×768 viewport (~100px per column). Worst case is a
 *     horizontal scroll bar, not a structural failure.
 *   • (c) sounds clean in the abstract but duplicates the current player's
 *     column into a separate "your options" panel — that forces the eye
 *     between two regions for one decision. Cost > benefit.
 *
 * ─── Layout inside .board-wrapper ──────────────────────────────────────────
 *
 *   ┌─ .board-wrapper ─────────────────────────────────────────────────┐
 *   │  ┌─ score-sheet table (current player col highlighted) ───────┐  │
 *   │  │  Category    │ You │ Bob │ Carol │ ...                     │  │
 *   │  │  Ones        │  3  │  5  │  —    │                         │  │
 *   │  │  ...                                                       │  │
 *   │  │  Upper sub, bonus, grand total                             │  │
 *   │  └────────────────────────────────────────────────────────────┘  │
 *   │  ┌─ dice tray (5 large clickable dice) ───────────────────────┐  │
 *   │  │   [d1]  [d2]  [d3]  [d4]  [d5]                             │  │
 *   │  └────────────────────────────────────────────────────────────┘  │
 *   │  ┌─ roll button ──────────────────────────────────────────────┐  │
 *   │  │     [ Roll 2 of 3 — 3 held ]                               │  │
 *   │  └────────────────────────────────────────────────────────────┘  │
 *   └───────────────────────────────────────────────────────────────────┘
 *
 * ─── Two-click commit ──────────────────────────────────────────────────────
 * Clicking a preview cell selects it (visual outline). Clicking the SAME cell
 * again commits the score. Clicking a different preview moves the selection.
 * Clicking Roll cancels. Selection auto-clears on turn change.
 *
 * ─── Action labels ─────────────────────────────────────────────────────────
 * Per docs/renderer-contract.md the action-label contract is deliberately
 * unresolved until more dice/card games land. Yahtzee handles its own
 * labels locally; the score sheet module owns the score-preview math.
 *
 * ─── Pre-game ──────────────────────────────────────────────────────────────
 * The Yahtzee renderer is only init'd when state.status === 'playing' (or
 * 'paused' on rejoin) — see client/js/app.js enterGameScreen. So there is
 * no "waiting-room" view to handle here; the framework's #waiting-screen
 * shows the player list before initGame runs.
 */

const YahtzeeRenderer = (() => {
  // ─── module-private state ─────────────────────────────────────────────────

  let _myUserId = null;
  let _emit = null;
  let _selectedCategory = null; // category awaiting second-click commit
  let _lastTurnKey = null; // for detecting turn change → clear selection
  let _animationToken = 0; // bumped on each roll to abort stale animations

  // Pip layout per face value (1-indexed slot positions in a 3×3 grid).
  // Slots: 1 2 3 / 4 5 6 / 7 8 9
  const PIPS = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };

  // ─── init ────────────────────────────────────────────────────────────────

  function init(container, state, myUserId, emitAction) {
    _myUserId = myUserId;
    _emit = emitAction;
    _selectedCategory = null;
    _lastTurnKey = null;
    _animationToken = 0;

    const { diceCount } = state.config.settings;

    const wrapper = document.createElement('div');
    wrapper.id = 'yahtzee-wrapper';
    wrapper.className = 'yahtzee-wrapper';

    // Score sheet
    const sheetSection = document.createElement('div');
    sheetSection.className = 'yz-sheet-wrap';
    const table = document.createElement('table');
    table.id = 'yz-sheet';
    table.className = 'yz-sheet';
    sheetSection.appendChild(table);
    wrapper.appendChild(sheetSection);

    // Dice tray
    const tray = document.createElement('div');
    tray.id = 'yz-tray';
    tray.className = 'yz-tray';
    for (let i = 0; i < diceCount; i++) {
      const die = document.createElement('button');
      die.type = 'button';
      die.className = 'yz-die yz-die-empty';
      die.id = `yz-die-${i}`;
      die.dataset.idx = String(i);
      die.disabled = true;
      for (let s = 0; s < 9; s++) {
        const pip = document.createElement('span');
        pip.className = 'yz-pip-slot';
        die.appendChild(pip);
      }
      die.addEventListener('click', () => onDieClick(i));
      tray.appendChild(die);
    }
    wrapper.appendChild(tray);

    // Roll button
    const rollWrap = document.createElement('div');
    rollWrap.className = 'yz-roll-wrap';
    const rollBtn = document.createElement('button');
    rollBtn.type = 'button';
    rollBtn.id = 'yz-roll-btn';
    rollBtn.className = 'btn btn-primary yz-roll-btn';
    rollBtn.disabled = true;
    rollBtn.textContent = 'Roll';
    rollBtn.addEventListener('click', onRollClick);
    rollWrap.appendChild(rollBtn);
    wrapper.appendChild(rollWrap);

    container.appendChild(wrapper);

    YahtzeeScoreSheet.rebuild(table, state.players, { onCellClick });
  }

  // ─── update ──────────────────────────────────────────────────────────────

  function update(state) {
    if (!state?.turnState) return;

    // Detect turn change → clear pending selection so a stale highlight
    // doesn't carry into the next player's turn or even the same player's
    // next roll. Key includes rollsUsed so a fresh roll also drops it.
    const turnKey = `${state.turnState.currentPlayerIndex}:${state.turnState.roundsCompleted}:${state.turnState.rollsUsed}`;
    if (_lastTurnKey !== null && _lastTurnKey !== turnKey) {
      _selectedCategory = null;
    }
    _lastTurnKey = turnKey;

    // Roster shape changes (e.g. cross-game rejoin into a different game)
    // require rebuilding the table. Cheap to check.
    const expectedCols = state.players.length + 2;
    const existingHead = document.querySelector('#yz-sheet thead tr');
    if (!existingHead || existingHead.children.length !== expectedCols) {
      const table = document.getElementById('yz-sheet');
      if (table) YahtzeeScoreSheet.rebuild(table, state.players, { onCellClick });
    }

    YahtzeeScoreSheet.paint(state, {
      myUserId: _myUserId,
      selectedCategory: _selectedCategory,
    });
    paintDice(state);
    paintRollButton(state);
    paintSidebarTitle(state);

    // Clear any leftover Monopoly chrome.
    const buttonsEl = document.getElementById('action-buttons');
    if (buttonsEl) buttonsEl.innerHTML = '';
    const auctionEl = document.getElementById('auction-panel');
    if (auctionEl) auctionEl.style.display = 'none';
  }

  // ─── onEvent ─────────────────────────────────────────────────────────────

  function onEvent(event, state) {
    switch (event.type) {
      case 'ACTION_REJECTED': {
        UIManager.appendLog(`⚠ ${event.data.message}`, 'info');
        const tray = document.getElementById('yz-tray');
        if (tray) {
          tray.style.outline = '2px solid #e53935';
          setTimeout(() => {
            tray.style.outline = '';
          }, 800);
        }
        break;
      }
      case 'DICE_ROLLED': {
        SoundManager.playDice();
        animateDice(event.data.dice, event.data.held, state.config.settings.diceCount);
        break;
      }
      case 'CATEGORY_SCORED': {
        SoundManager.playCollect();
        YahtzeeScoreSheet.flashCell(state, event.data.username, event.data.category);
        break;
      }
      case 'GAME_OVER': {
        SoundManager.playGameOver();
        // state.winner is a userId (or array of userIds for ties); look up
        // display names from finalScores so the log shows the player's name.
        const w = event.data.winner;
        const lookup = (uid) =>
          event.data.finalScores?.find((s) => s.userId === uid)?.username || uid;
        const msg = Array.isArray(w)
          ? `🤝 Tie! ${w.map(lookup).join(' & ')} all win`
          : w
            ? `🏆 ${lookup(w)} wins!`
            : '🤝 Draw!';
        UIManager.appendLog(msg, 'game');
        break;
      }
      // TURN_STARTED, TURN_ENDED, TURN_SKIPPED — visuals covered by update().
    }
  }

  // ─── destroy ─────────────────────────────────────────────────────────────

  function destroy() {
    document.getElementById('yahtzee-wrapper')?.remove();
    _myUserId = null;
    _emit = null;
    _selectedCategory = null;
    _lastTurnKey = null;
    _animationToken++; // invalidate any in-flight animations
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  cell-click bridge to the score sheet
  // ═══════════════════════════════════════════════════════════════════════════

  function onCellClick(category, userId) {
    if (userId !== _myUserId) return;
    const state = GameState.getState();
    if (!state || state.status !== 'playing') return;
    const cur = state.players[state.turnState.currentPlayerIndex];
    if (cur?.userId !== _myUserId) return;
    if (state.turnState.rollsUsed < 1) return;
    const me = state.players.find((p) => p.userId === _myUserId);
    if (!me || me.scoreSheet[category] !== null) return;

    if (_selectedCategory === category) {
      _selectedCategory = null;
      _emit('scoreCategory', { category });
    } else {
      _selectedCategory = category;
      YahtzeeScoreSheet.paint(state, {
        myUserId: _myUserId,
        selectedCategory: _selectedCategory,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  helpers — dice
  // ═══════════════════════════════════════════════════════════════════════════

  function paintDice(state) {
    const { diceCount, rollsPerTurn } = state.config.settings;
    const dice = state.turnState.dice;
    const held = state.turnState.held;
    const rollsUsed = state.turnState.rollsUsed;
    const cur = state.players[state.turnState.currentPlayerIndex];
    const isMyTurn = cur?.userId === _myUserId;
    const playing = state.status === 'playing';
    const canHold = isMyTurn && playing && rollsUsed >= 1 && rollsUsed < rollsPerTurn;

    for (let i = 0; i < diceCount; i++) {
      const die = document.getElementById(`yz-die-${i}`);
      if (!die) continue;
      const val = dice[i];
      const isHeld = !!held?.[i];

      if (val === undefined) {
        renderDieFace(die, null);
        die.classList.add('yz-die-empty');
        die.classList.remove('yz-die-held');
      } else {
        renderDieFace(die, val);
        die.classList.remove('yz-die-empty');
        die.classList.toggle('yz-die-held', isHeld);
      }

      die.disabled = !canHold || val === undefined;
    }
  }

  function renderDieFace(die, value) {
    const slots = die.querySelectorAll('.yz-pip-slot');
    slots.forEach((s) => s.classList.remove('pip'));
    if (value === null || value === undefined) {
      die.dataset.value = '';
      return;
    }
    die.dataset.value = String(value);
    for (const pos of PIPS[value] || []) {
      slots[pos - 1]?.classList.add('pip');
    }
  }

  function onDieClick(idx) {
    const die = document.getElementById(`yz-die-${idx}`);
    if (!die || die.disabled) return;
    die.classList.toggle('yz-die-held');
    updateRollLabelFromDom();
  }

  function updateRollLabelFromDom() {
    const btn = document.getElementById('yz-roll-btn');
    if (!btn || btn.disabled) return;
    const next = Number(btn.dataset.nextRoll || '0');
    const max = Number(btn.dataset.maxRoll || '3');
    if (!next || next === 1) return;
    const heldCount = document.querySelectorAll('.yz-die.yz-die-held').length;
    btn.textContent = `Roll ${next} of ${max} — ${heldCount} held`;
  }

  function currentHeldFromDom(diceCount) {
    const held = [];
    for (let i = 0; i < diceCount; i++) {
      const die = document.getElementById(`yz-die-${i}`);
      held.push(!!die?.classList.contains('yz-die-held'));
    }
    return held;
  }

  /**
   * Animate dice flicker. Held dice (server-confirmed) stay still; non-held
   * dice flicker for ~300ms then settle on the new value. _animationToken
   * guards against overlapping rolls — only the most recent animation gets
   * to write the final values.
   */
  function animateDice(newDice, heldServer, diceCount) {
    _animationToken++;
    const token = _animationToken;
    const FRAMES = 6;
    const FRAME_MS = 50;

    for (let i = 0; i < diceCount; i++) {
      const die = document.getElementById(`yz-die-${i}`);
      if (!die) continue;
      if (heldServer[i]) continue;

      let frame = 0;
      const step = () => {
        if (token !== _animationToken) return;
        if (frame >= FRAMES) {
          renderDieFace(die, newDice[i]);
          die.classList.remove('yz-die-rolling');
          return;
        }
        die.classList.add('yz-die-rolling');
        renderDieFace(die, 1 + ((frame + i) % 6));
        frame++;
        setTimeout(step, FRAME_MS);
      };
      step();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  helpers — roll button
  // ═══════════════════════════════════════════════════════════════════════════

  function paintRollButton(state) {
    const btn = document.getElementById('yz-roll-btn');
    if (!btn) return;
    const cur = state.players[state.turnState.currentPlayerIndex];
    const isMyTurn = cur?.userId === _myUserId;
    const playing = state.status === 'playing';
    const ts = state.turnState;
    const rollsRemaining = state.config.settings.rollsPerTurn - ts.rollsUsed;
    const next = ts.rollsUsed + 1;
    const max = state.config.settings.rollsPerTurn;

    btn.dataset.nextRoll = String(next);
    btn.dataset.maxRoll = String(max);

    if (!playing) {
      btn.disabled = true;
      btn.textContent = 'Game over';
      return;
    }
    if (!isMyTurn) {
      btn.disabled = true;
      btn.textContent = `Waiting for ${cur?.username || ''}…`;
      return;
    }
    if (rollsRemaining <= 0) {
      btn.disabled = true;
      btn.textContent = 'Pick a category to score';
      return;
    }
    btn.disabled = false;
    if (next === 1) {
      btn.textContent = `Roll 1 of ${max}`;
    } else {
      const heldCount = currentHeldFromDom(state.config.settings.diceCount).filter(Boolean).length;
      btn.textContent = `Roll ${next} of ${max} — ${heldCount} held`;
    }
  }

  function onRollClick() {
    _selectedCategory = null;
    const state = GameState.getState();
    if (!state) return;
    const ts = state.turnState;
    if (ts.rollsUsed === 0) {
      _emit('rollDice');
    } else {
      _emit('rollDice', { held: currentHeldFromDom(state.config.settings.diceCount) });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  helpers — sidebar title
  // ═══════════════════════════════════════════════════════════════════════════

  function paintSidebarTitle(state) {
    const titleEl = document.getElementById('action-title');
    if (!titleEl) return;
    const cur = state.players[state.turnState.currentPlayerIndex];
    const isMyTurn = cur?.userId === _myUserId;
    const playing = state.status === 'playing';
    if (!playing) {
      titleEl.textContent = 'Game over';
      return;
    }
    if (!isMyTurn) {
      titleEl.textContent = `Waiting for ${cur?.username || ''}…`;
      return;
    }
    const ts = state.turnState;
    if (ts.rollsUsed === 0) titleEl.textContent = 'Your turn — roll!';
    else if (ts.rollsUsed >= state.config.settings.rollsPerTurn)
      titleEl.textContent = 'Your turn — pick a category';
    else titleEl.textContent = 'Your turn — re-roll or score';
  }

  // ─── public API ──────────────────────────────────────────────────────────

  return { init, update, onEvent, destroy };
})();

GameRendererRegistry.register('yahtzee', YahtzeeRenderer);
