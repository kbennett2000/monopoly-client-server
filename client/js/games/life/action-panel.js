/**
 * action-panel.js
 *
 * Owns the sidebar action area (#action-buttons): renders the right set of
 * buttons for the current player's phase, hosts the spinner wheel, and
 * handles the special retirement-fork "deliberate decision" treatment.
 *
 * ─── Phases ─────────────────────────────────────────────────────────────────
 *
 * The "phase" of the active player drives what we show:
 *
 *   pending = null & it's my turn → SPIN + out-of-band purchases
 *   pending.type = 'fork'             → Career / College buttons (start fork)
 *   pending.type = 'retirement-fork'  → CA / ME buttons + stakes banner
 *   pending.type = 'career-draw'      → N career card choices
 *   pending.type = 'salary-draw'      → N salary card choices
 *   pending.type = 'house-draw'       → N house card choices (cost + value)
 *   not my turn                       → "Bob is taking their turn…" + nothing
 *   retired                           → "You've retired"
 *   game over                         → empty (framework's modal handles it)
 *
 * The spec wants the retirement-fork as a deliberate moment.  We render its
 * two options larger than usual with a short banner explaining the cash
 * gamble.  Picking Millionaire Estates pops a small confirmation —
 * "Outcome decided at game over" — before sending the action.
 *
 * ─── Spinner wheel ──────────────────────────────────────────────────────────
 *
 * A round element with 10 numbered segments (1-10) and a pointer at the top.
 * On SPINNER_RESULT we set transform: rotate(<target>deg) with a CSS
 * transition.  Computed target rotation:
 *     target = (3 full rotations * 360) - (value * 36) - 18
 * The 3 full rotations make the spin "feel" big; subtracting `value * 36`
 * brings the matching segment under the pointer; the -18 centers the
 * segment under the pointer (each segment spans 36deg).
 *
 * The wheel only animates on the SPINNER_RESULT event.  update() never
 * touches the wheel's rotation — animations must not replay on state
 * resync.  (Renderer contract idempotency rule.)
 */

const LifeActionPanel = (() => {
  let _myUserId = null;
  let _emit = null;
  let _buttonsEl = null;
  let _spinnerWheel = null;
  // Cumulative wheel rotation in degrees.  We add to it on each spin so
  // the wheel always rotates forward (subtracting from 0 would visually
  // un-spin a previously-spun wheel).
  let _wheelRotation = 0;
  // Local "I'm waiting on a server response" guard — disables the spin
  // button between click and the resulting state update.  Reset on every
  // update() so a state push from any source restores the panel.
  let _spinPending = false;

  // ── mount/update/unmount ────────────────────────────────────────────────

  function mount(state, myUserId, emit) {
    _myUserId = myUserId;
    _emit = emit;
    _buttonsEl = document.getElementById('action-buttons');
    if (!_buttonsEl) return;
    _buttonsEl.innerHTML = '';
    _wheelRotation = 0;
    _spinPending = false;

    // The spinner lives at the top of the action panel.  Once the player
    // clicks Spin, the button below the wheel disables, the wheel rotates,
    // and on the resulting state push the next action surface (or end of
    // turn) takes over.
    const wheelBox = document.createElement('div');
    wheelBox.className = 'life-spinner-box';
    const wheel = document.createElement('div');
    wheel.className = 'life-spinner-wheel';
    for (let i = 1; i <= 10; i++) {
      const seg = document.createElement('span');
      seg.className = 'life-spinner-seg';
      seg.style.transform = `rotate(${(i - 1) * 36}deg)`;
      const num = document.createElement('span');
      num.className = 'life-spinner-num';
      num.textContent = String(i);
      seg.appendChild(num);
      wheel.appendChild(seg);
    }
    const pointer = document.createElement('div');
    pointer.className = 'life-spinner-pointer';
    wheelBox.appendChild(wheel);
    wheelBox.appendChild(pointer);
    _buttonsEl.appendChild(wheelBox);
    _spinnerWheel = wheel;

    // Actions area below the wheel.
    const actionsEl = document.createElement('div');
    actionsEl.className = 'life-actions';
    actionsEl.id = 'life-actions';
    _buttonsEl.appendChild(actionsEl);

    renderActions(state);
  }

  function update(state) {
    _spinPending = false; // any state push clears local spin-pending state
    if (!_buttonsEl) return;
    renderActions(state);
  }

  function onEvent(event, _state) {
    if (event.type === 'SPINNER_RESULT') {
      animateWheel(event.data.value);
    }
  }

  function unmount() {
    if (_buttonsEl) _buttonsEl.innerHTML = '';
    _buttonsEl = null;
    _spinnerWheel = null;
    _myUserId = null;
    _emit = null;
    _wheelRotation = 0;
    _spinPending = false;
  }

  // ── spinner animation ──────────────────────────────────────────────────

  function animateWheel(value) {
    if (!_spinnerWheel) return;
    if (typeof value !== 'number' || value < 1 || value > 10) return;
    // 3 full forward rotations + the per-value offset.  Each segment spans
    // 36deg; we want the segment numbered `value` to end up under the
    // pointer (which sits at the top of the wheel).  Subtracting 18deg
    // centers the segment under the pointer rather than its edge.
    const offset = 3 * 360 - (value - 1) * 36 - 18;
    _wheelRotation += offset;
    _spinnerWheel.style.transform = `rotate(${_wheelRotation}deg)`;
  }

  // ── action rendering ───────────────────────────────────────────────────

  function renderActions(state) {
    const actionsEl = document.getElementById('life-actions');
    if (!actionsEl) return;
    actionsEl.innerHTML = '';

    if (state.status === 'finished') {
      // Framework owns the game-over modal — nothing to do here.
      return;
    }

    const me = state.players.find((p) => p.userId === _myUserId);
    const cur = state.players[state.turnState?.currentPlayerIndex];

    if (me?.retired) {
      const msg = document.createElement('p');
      msg.className = 'life-actions-message';
      msg.textContent = "You've retired. The game continues until everyone retires.";
      actionsEl.appendChild(msg);
      return;
    }

    const isMyTurn = cur?.userId === _myUserId;
    if (!isMyTurn) {
      const msg = document.createElement('p');
      msg.className = 'life-actions-message';
      msg.textContent = cur ? `${cur.username} is taking their turn…` : 'Waiting…';
      actionsEl.appendChild(msg);
      return;
    }

    // It's my turn.  Branch on pending.
    if (me.pending?.type === 'fork') {
      renderForkChoices(actionsEl, state, me, /* isRetirement */ false);
      return;
    }
    if (me.pending?.type === 'retirement-fork') {
      renderForkChoices(actionsEl, state, me, /* isRetirement */ true);
      return;
    }
    if (me.pending?.type === 'career-draw') {
      renderCareerChoices(actionsEl, state, me);
      return;
    }
    if (me.pending?.type === 'salary-draw') {
      renderSalaryChoices(actionsEl, state, me);
      return;
    }
    if (me.pending?.type === 'house-draw') {
      renderHouseChoices(actionsEl, state, me);
      return;
    }

    // No pending — default to Spin + out-of-band purchases.
    renderDefaultActions(actionsEl, state, me);
  }

  function renderDefaultActions(parent, state, me) {
    // The spin button is the headline.  Disabled while a spin is pending
    // (between click and server response) so we don't double-fire.
    const spinBtn = document.createElement('button');
    spinBtn.className = 'btn btn-primary btn-full life-spin-btn';
    spinBtn.textContent = me.spinAgain ? 'Spin again!' : 'Spin';
    spinBtn.disabled = _spinPending;
    spinBtn.addEventListener('click', () => {
      _spinPending = true;
      spinBtn.disabled = true;
      _emit('spin', {});
    });
    parent.appendChild(spinBtn);

    // Out-of-band purchases.  midTurn (spin-again chain) blocks them per
    // the server's rule — the buttons hide rather than show-and-error so
    // the UI matches getValidActions exactly.
    if (!me.midTurn) {
      const { autoInsuranceCost, lifeInsuranceCost, stockCost } = state.config.settings;

      if (!me.autoInsurance) {
        const btn = makePurchaseBtn(
          `Auto insurance — $${autoInsuranceCost.toLocaleString()}`,
          me.cash >= autoInsuranceCost,
          () => _emit('buyAutoInsurance', {}),
        );
        parent.appendChild(btn);
      }
      if (!me.lifeInsurance) {
        const btn = makePurchaseBtn(
          `Life insurance — $${lifeInsuranceCost.toLocaleString()}`,
          me.cash >= lifeInsuranceCost,
          () => _emit('buyLifeInsurance', {}),
        );
        parent.appendChild(btn);
      }
      if (me.stockNumber == null) {
        const btn = makePurchaseBtn(
          `Buy a stock — $${stockCost.toLocaleString()}`,
          me.cash >= stockCost,
          () => openStockPicker(parent, state, me),
        );
        parent.appendChild(btn);
      }
    }
  }

  function makePurchaseBtn(label, enabled, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline btn-full life-purchase-btn';
    btn.textContent = label;
    btn.disabled = !enabled;
    if (enabled) btn.addEventListener('click', onClick);
    return btn;
  }

  function openStockPicker(parent, state, me) {
    // Replace the panel briefly with an inline picker showing the 10
    // possible stock numbers; the player picks one or cancels.  Other
    // players' owned numbers are disabled.
    const taken = new Set(
      state.players.filter((p) => p.userId !== me.userId).map((p) => p.stockNumber),
    );
    parent.innerHTML = '';
    const title = document.createElement('p');
    title.className = 'life-actions-message';
    title.textContent = 'Pick a number 1-10:';
    parent.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'life-stock-grid';
    for (let n = 1; n <= 10; n++) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline life-stock-cell';
      btn.textContent = String(n);
      if (taken.has(n)) {
        btn.disabled = true;
        btn.title = 'Already owned';
      } else {
        btn.addEventListener('click', () => _emit('buyStock', { number: n }));
      }
      grid.appendChild(btn);
    }
    parent.appendChild(grid);

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost btn-full mt-2';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => renderActions(state));
    parent.appendChild(cancel);
  }

  // ── pending-state surfaces ─────────────────────────────────────────────

  function renderForkChoices(parent, state, me, isRetirement) {
    const options = me.pending.options || [];
    if (isRetirement) {
      const banner = document.createElement('div');
      banner.className = 'life-retirement-banner';
      banner.innerHTML =
        '<strong>Where will you retire?</strong><br>' +
        'Countryside Acres is the safe path — life tiles count toward your score.<br>' +
        'Millionaire Estates is a gamble — only the highest-cash ME retiree wins.';
      parent.appendChild(banner);
    }
    for (const nextId of options) {
      const sq = state.config.boardById[nextId];
      const btn = document.createElement('button');
      btn.className = isRetirement
        ? 'btn btn-primary btn-full life-retirement-choice'
        : 'btn btn-primary btn-full life-fork-choice';
      btn.textContent = sq?.label || nextId;
      btn.addEventListener('click', () => onForkPick(state, nextId, isRetirement));
      parent.appendChild(btn);
    }
  }

  function onForkPick(state, nextId, isRetirement) {
    if (isRetirement && nextId.includes('millionaire')) {
      // The deferred-resolution model is the most non-obvious feature of
      // ME — surface it before the player commits.  This isn't a "are you
      // sure?" — it's "you're about to bet your cash; the result is
      // decided at game over."  Plain confirm() is enough for v1.
      const ok = confirm(
        'Millionaire Estates: outcome decided at game over.\n\nThe highest-cash ME retiree wins the game outright; other ME retirees score zero. Proceed?',
      );
      if (!ok) return;
    }
    _emit('chooseBranch', { nextSquareId: nextId });
  }

  function renderCareerChoices(parent, state, me) {
    const careersById = Object.fromEntries((state.config.careers || []).map((c) => [c.id, c]));
    for (const cardId of me.pending.options || []) {
      const card = careersById[cardId];
      if (!card) continue;
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline btn-full life-card-choice';
      btn.innerHTML =
        `<strong>${escapeHtml(card.name)}</strong><br>` +
        `<small>Payday bonus: $${(card.paydayBonus || 0).toLocaleString()}</small>`;
      btn.addEventListener('click', () => _emit('chooseCareer', { cardId }));
      parent.appendChild(btn);
    }
  }

  function renderSalaryChoices(parent, state, me) {
    const salariesById = Object.fromEntries(
      (state.config.salaries || []).map((c) => [c.id, c]),
    );
    for (const cardId of me.pending.options || []) {
      const card = salariesById[cardId];
      if (!card) continue;
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline btn-full life-card-choice';
      btn.innerHTML =
        `<strong>$${card.amount.toLocaleString()}</strong><br>` +
        `<small>Tax due on tax squares: $${card.taxDue.toLocaleString()}</small>`;
      btn.addEventListener('click', () => _emit('chooseSalary', { cardId }));
      parent.appendChild(btn);
    }
  }

  function renderHouseChoices(parent, state, me) {
    const housesById = Object.fromEntries((state.config.houses || []).map((h) => [h.id, h]));
    for (const houseId of me.pending.options || []) {
      const house = housesById[houseId];
      if (!house) continue;
      const affordable = me.cash >= house.cost;
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline btn-full life-card-choice';
      btn.disabled = !affordable;
      btn.innerHTML =
        `<strong>${escapeHtml(house.name)}</strong><br>` +
        `<small>Cost $${house.cost.toLocaleString()} · scoring value $${house.value.toLocaleString()}</small>`;
      if (!affordable) btn.title = "You can't afford this one";
      if (affordable) btn.addEventListener('click', () => _emit('chooseHouse', { houseId }));
      parent.appendChild(btn);
    }
  }

  // ── small utilities ────────────────────────────────────────────────────

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
