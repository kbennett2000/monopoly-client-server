/**
 * turn-warning.js
 *
 * Countdown banner shown to every client in a room when the server emits
 * `game:turn_warning` — meaning a player's turn is about to auto-skip
 * because they've disconnected. The server emits an absolute
 * `deadlineTimestamp`; this module runs the countdown locally so the
 * display stays accurate without further server emits.
 *
 * ─── Dismissal semantics ───────────────────────────────────────────────────
 * The server does NOT emit any cancellation event when the timer is
 * cleared (e.g. when the AFK player reconnects). So the banner dismisses
 * based on client-side inspection of subsequent state updates:
 *
 *   • Any game:update / game:state where the warned player is now
 *     `connected: true` → dismiss (player came back).
 *   • Any state update where it's no longer the warned player's turn
 *     → dismiss (the skip fired and the turn advanced, OR another
 *     action somehow advanced past them).
 *   • Any state update where `status !== 'playing'` → dismiss (game over).
 *   • Local deadline reached and no state update arrived within ~500ms
 *     → dismiss as a fallback so the banner never gets stuck.
 *
 * The server-side `game:turn_warning` is fired from the disconnect
 * handler when the disconnecting player is the current player. In
 * current server behaviour that means the warning ALWAYS targets a
 * disconnected player, so the local-AFK-player banner variant
 * ("Take your turn or it will skip…") is mostly unreachable today —
 * the local player's own socket is offline at the moment of the emit.
 * The personalised text remains for a future server change that
 * adds idle-while-connected timeouts.
 */

const TurnWarning = (() => {
  let _active = null; // { username, deadline } | null
  let _interval = null;
  let _root = null;

  // ── public API (called from socket-client.js) ───────────────────────────

  /** Called when `game:turn_warning` arrives. */
  function handleTurnWarning(data) {
    if (!data?.username || typeof data?.deadlineTimestamp !== 'number') return;
    // Replace any prior warning. Two warnings in close succession (e.g.
    // two players disconnect in a row) overwrite cleanly because
    // _active is reassigned and the interval is restarted below.
    _active = { username: data.username, deadline: data.deadlineTimestamp };
    ensureRoot();
    render();
    startCountdown();
  }

  /** Called from handleFullStateUpdate on every game:state / game:update. */
  function handleStateUpdate(state) {
    if (!_active) return;
    if (shouldDismiss(state)) dismiss();
  }

  // ── internal ────────────────────────────────────────────────────────────

  function shouldDismiss(state) {
    if (!state || !Array.isArray(state.players)) return false;
    if (state.status !== 'playing') return true;
    const p = state.players.find((pp) => pp.username === _active.username);
    if (!p) return true; // player not in roster anymore
    if (p.connected) return true; // they came back
    const cur = state.players[state.turnState?.currentPlayerIndex];
    if (cur?.username !== _active.username) return true; // turn moved on
    return false;
  }

  function startCountdown() {
    if (_interval) clearInterval(_interval);
    // Tick at 1Hz — anything faster is distracting motion.
    _interval = setInterval(() => {
      if (!_active) {
        clearInterval(_interval);
        _interval = null;
        return;
      }
      const remaining = remainingSeconds();
      render(remaining);
      if (remaining === 0) {
        // The server's TURN_SKIPPED game:update should arrive any moment.
        // Stop ticking, but keep the banner visible for ~500ms so the
        // user sees "0s" briefly. If the state update doesn't arrive
        // (e.g. the player reconnected at the last second and the server
        // cleared without emitting), the fallback timeout dismisses anyway.
        clearInterval(_interval);
        _interval = null;
        setTimeout(() => {
          if (_active) dismiss();
        }, 500);
      }
    }, 1000);
  }

  function remainingSeconds() {
    return Math.max(0, Math.ceil((_active.deadline - Date.now()) / 1000));
  }

  function ensureRoot() {
    if (_root) return;
    _root = document.createElement('div');
    _root.id = 'turn-warning';
    _root.className = 'turn-warning';
    _root.style.display = 'none';
    document.body.appendChild(_root);
  }

  function render(remaining) {
    if (!_root || !_active) return;
    if (remaining === undefined) remaining = remainingSeconds();
    const me = (typeof GameState !== 'undefined' && GameState.getUser?.()?.username) || null;
    const isMe = me === _active.username;
    _root.classList.toggle('turn-warning-me', isMe);
    _root.textContent = isMe
      ? `⏱ Take your turn or it will skip in ${remaining}s`
      : `⏱ ${_active.username} has been idle — turn will skip in ${remaining}s`;
    _root.style.display = '';
  }

  function dismiss() {
    _active = null;
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
    if (_root) _root.style.display = 'none';
    // Keep the DOM node attached — hidden — so re-showing avoids
    // re-creation flicker and any browser-allocated relayout cost.
  }

  return { handleTurnWarning, handleStateUpdate };
})();
