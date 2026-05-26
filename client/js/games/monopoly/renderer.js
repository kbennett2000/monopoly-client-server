/**
 * Monopoly renderer — GameRenderer interface implementation.
 *
 * Self-registers with GameRendererRegistry at module load time.
 * The framework (app.js, socket-client.js) interacts with this module
 * exclusively through the registry; no direct references to this global.
 *
 * Implements: init / update / onEvent / destroy
 */

const MonopolyRenderer = (() => {

  let _myUserId = null;
  let _emit     = null;
  // Spectator mode: every Monopoly action button is rendered either inside
  // the framework's #action-section (which UIManager.applySpectatorChrome
  // hides for spectators) or inside the property/trade modals (whose
  // canManage gates fail when the viewer isn't in state.players).  The
  // flag is captured for symmetry with the other renderers and to allow
  // future defense-in-depth checks; today no Monopoly click handler is
  // reachable to a spectator that would emit a game:action.
  let _isSpectator = false;

  // Sidebar 2d6 pip display — the framework's chrome contains the DOM
  // (#dice-display + per-pip-slot elements like #d1-tl, #d2-mm, …) but
  // the visual state is Monopoly-owned.  Moved out of ui-manager so the
  // framework doesn't carry the dice geometry knowledge.
  const DIE_PIPS = {
    1: ['mm'],
    2: ['tr', 'bl'],
    3: ['tr', 'mm', 'bl'],
    4: ['tl', 'tr', 'bl', 'br'],
    5: ['tl', 'tr', 'mm', 'bl', 'br'],
    6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
  };
  const ALL_PIP_SLOTS = ['tl', 'tm', 'tr', 'ml', 'mm', 'mr', 'bl', 'bm', 'br'];

  function _setSidebarDiePips(prefix, value) {
    const active = new Set(DIE_PIPS[value] || []);
    for (const slot of ALL_PIP_SLOTS) {
      const el = document.getElementById(`${prefix}-${slot}`);
      if (el) el.classList.toggle('pip', active.has(slot));
    }
  }

  // The sidebar dice container is hidden in HTML at page load; this
  // function flips it on/off and paints pips when Monopoly state has
  // a non-zero dice pair.  Idempotent — safe to call on every update.
  // index.html owns the #dice-display element used by this function (the
  // *sidebar* one with pip slots).  Monopoly's board-center dice uses a
  // separate, simpler element built in init() below.
  function _updateSidebarDice(state) {
    const diceEl = document.getElementById('dice-display');
    const doublesEl = document.getElementById('doubles-badge');
    if (!diceEl) return;
    const [d1, d2] = state.turnState?.dice || [0, 0];
    if (d1 === 0 && d2 === 0) {
      diceEl.style.display = 'none';
      if (doublesEl) doublesEl.style.display = 'none';
      return;
    }
    _setSidebarDiePips('d1', d1);
    _setSidebarDiePips('d2', d2);
    if (doublesEl) doublesEl.style.display = d1 === d2 ? '' : 'none';
    diceEl.style.display = 'flex';
  }

  function _hideSidebarDice() {
    const diceEl = document.getElementById('dice-display');
    const doublesEl = document.getElementById('doubles-badge');
    if (diceEl) diceEl.style.display = 'none';
    if (doublesEl) doublesEl.style.display = 'none';
  }

  // Stored references for removeEventListener in destroy()
  let _onClosePropertyModal  = null;
  let _onCloseMyPropsModal   = null;
  let _onCloseTradeModal     = null;
  let _onCancelTradeModal    = null;
  let _onSendTrade           = null;
  let _onAcceptTrade         = null;
  let _onRejectTrade         = null;

  // ── private helpers ──────────────────────────────────────────────────────────

  function _actionHandlers() {
    return {
      rollDice:          () => _emit('rollDice'),
      buyProperty:       () => _emit('buyProperty'),
      declinePurchase:   () => _emit('declinePurchase'),
      placeBid:     (amt) => _emit('placeBid', { amount: amt }),
      passAuction:       () => _emit('passAuction'),
      endTurn:           () => _emit('endTurn'),
      payJailFine:       () => _emit('payJailFine'),
      useJailCard:       () => _emit('useJailCard'),
      openPropertyModal: () => _openMyPropertiesModal(),
      openTradeModal:    () => UIManager.showTradeModal(GameState.getState(), _myUserId),
      declareBankruptcy: () => {
        if (confirm('Are you sure you want to declare bankruptcy? You will be eliminated from the game.')) {
          _emit('declareBankruptcy');
        }
      },
    };
  }

  function _propertyHandlers() {
    return {
      buildHouse:         (pos) => _emit('buildHouse',         { position: pos }),
      sellHouse:          (pos) => _emit('sellHouse',          { position: pos }),
      mortgageProperty:   (pos) => _emit('mortgageProperty',   { position: pos }),
      unmortgageProperty: (pos) => _emit('unmortgageProperty', { position: pos }),
    };
  }

  function _openMyPropertiesModal() {
    const state = GameState.getState();
    if (!state || !_myUserId) return;

    const myProps = Object.keys(state.properties)
      .filter(pos => state.properties[pos].ownerId === _myUserId)
      .map(Number)
      .sort((a, b) => a - b);

    if (myProps.length === 0) {
      UIManager.appendLog('You own no properties.', 'info');
      return;
    }
    UIManager.showMyPropertiesModal(myProps, state, _myUserId, _propertyHandlers());
  }

  // ── init ────────────────────────────────────────────────────────────────────

  function init(container, state, myUserId, emitAction, options = {}) {
    _myUserId = myUserId;
    _emit     = emitAction;
    _isSpectator = !!options.isSpectator;

    // Build the entire Monopoly board structure inside the framework-owned
    // container.  destroy() removes it.  These inner ids (free-parking-pot,
    // dice-display, auction-center, …) are referenced by UIManager from
    // Monopoly-specific update paths, so they must exist when BoardRenderer
    // and UIManager run their first updates.
    container.insertAdjacentHTML('beforeend', `
      <div id="board" class="board">
        <div class="board-center">
          <div class="board-logo">🎲 MONOPOLY</div>
          <div id="free-parking-pot" class="free-parking-pot" style="display:none">
            <span class="pot-label">Free Parking</span>
            <span id="free-parking-amount" class="pot-amount">$0</span>
          </div>
          <div id="dice-display" class="dice-display">
            <span class="die" id="die1">—</span>
            <span class="die" id="die2">—</span>
          </div>
          <div id="auction-center" class="auction-center" style="display:none">
            <h4>AUCTION</h4>
            <p id="auction-property-name"></p>
            <p>Current bid: <strong id="auction-high-bid">$0</strong></p>
            <p>by <strong id="auction-high-bidder">—</strong></p>
          </div>
        </div>
      </div>
    `);

    BoardRenderer.buildBoard(state.config.board, (pos) => {
      UIManager.showPropertyModal(pos, GameState.getState(), _myUserId, _propertyHandlers());
    });

    // Wire Monopoly-specific modal buttons.  Named functions are stored so
    // destroy() can remove them precisely, preventing ghost handlers.
    _onClosePropertyModal = () => UIManager.closePropertyModal();
    _onCloseMyPropsModal  = () => UIManager.closeMyPropertiesModal();
    _onCloseTradeModal    = () => UIManager.closeTrade();
    _onCancelTradeModal   = () => UIManager.closeTrade();

    _onAcceptTrade = () => {
      _emit('acceptTrade');
      UIManager.closeIncomingTrade();
    };
    _onRejectTrade = () => {
      _emit('rejectTrade');
      UIManager.closeIncomingTrade();
    };
    _onSendTrade = () => {
      const toUserId     = document.getElementById('trade-target-player').value;
      const offerMoney   = Number(document.getElementById('trade-offer-money').value)   || 0;
      const offerCards   = Number(document.getElementById('trade-offer-cards').value)   || 0;
      const requestMoney = Number(document.getElementById('trade-request-money').value) || 0;
      const requestCards = Number(document.getElementById('trade-request-cards').value) || 0;
      const offerProps   = UIManager.getCheckedTradeProps('trade-offer-props');
      const requestProps = UIManager.getCheckedTradeProps('trade-request-props');

      if (!toUserId) {
        UIManager.showError('trade-error', 'Please select a player to trade with');
        return;
      }
      _emit('offerTrade', { toUserId, offerMoney, offerProps, offerCards, requestMoney, requestProps, requestCards });
      UIManager.closeTrade();
    };

    document.getElementById('close-property-modal')?.addEventListener('click', _onClosePropertyModal);
    document.getElementById('close-my-props-modal')?.addEventListener('click', _onCloseMyPropsModal);
    document.getElementById('close-trade-modal')?.addEventListener('click', _onCloseTradeModal);
    document.getElementById('cancel-trade-modal-btn')?.addEventListener('click', _onCancelTradeModal);
    document.getElementById('send-trade-btn')?.addEventListener('click', _onSendTrade);
    document.getElementById('accept-trade-btn')?.addEventListener('click', _onAcceptTrade);
    document.getElementById('reject-trade-btn')?.addEventListener('click', _onRejectTrade);
  }

  // ── update ──────────────────────────────────────────────────────────────────

  function update(state) {
    if (!state) return;

    BoardRenderer.update(state);
    UIManager.updateActionPanel(state, _myUserId, _actionHandlers());
    _updateSidebarDice(state);

    // Pending incoming trade modal
    if (state.trade && state.trade.status === 'pending' && state.trade.toUserId === _myUserId) {
      UIManager.showIncomingTrade(state, _myUserId);
    } else {
      UIManager.closeIncomingTrade();
    }
  }

  // ── onEvent ─────────────────────────────────────────────────────────────────

  function onEvent(event, state) {
    const myUsername = GameState.getUser()?.username;

    switch (event.type) {
      case 'ACTION_REJECTED': {
        UIManager.appendLog(`⚠ ${event.data.message}`, 'info');
        const actionsEl = document.getElementById('action-buttons');
        if (actionsEl) {
          actionsEl.style.outline = '2px solid #e53935';
          setTimeout(() => { actionsEl.style.outline = ''; }, 1000);
        }
        break;
      }
      case 'DICE_ROLLED':
        SoundManager.playDice();
        break;
      case 'PLAYER_MOVED':
        BoardRenderer.flashSquare(event.data.to);
        break;
      case 'PLAYER_LANDED':
        UIManager.appendLog(`${event.data.username} landed on ${event.data.squareName}`, 'move');
        break;
      case 'PASSED_GO':
        SoundManager.playBigCollect();
        break;
      case 'PLAYER_JAILED':
        UIManager.appendLog(`🚔 ${event.data.username} was sent to Jail!`, 'jail');
        SoundManager.playJail();
        break;
      case 'PLAYER_FREED_FROM_JAIL':
        UIManager.appendLog(`${event.data.username} got out of Jail`, 'jail');
        SoundManager.playFreeJail();
        break;
      case 'JAIL_FINE_PAID':
        SoundManager.playPay(false);
        break;
      case 'PROPERTY_BOUGHT':
        UIManager.appendLog(`${event.data.username} bought ${event.data.name} for $${event.data.price}`, 'property');
        SoundManager.playBuy();
        break;
      case 'AUCTION_STARTED':
        UIManager.appendLog(`🔔 Auction: ${event.data.name} (min bid $${event.data.minBid})`, 'auction');
        break;
      case 'AUCTION_WON':
        UIManager.appendLog(`${event.data.username} won ${event.data.name} at auction for $${event.data.amount}`, 'auction');
        if (event.data.username === myUsername) SoundManager.playBigCollect();
        else                                    SoundManager.playBuy();
        break;
      case 'MONOPOLY_ACHIEVED':
        UIManager.appendLog(`🏆 ${event.data.username} has a monopoly on ${event.data.colorGroup}!`, 'property');
        SoundManager.playMonopoly();
        break;
      case 'RENT_PAID': {
        UIManager.appendLog(`${event.data.from} paid $${event.data.amount} rent to ${event.data.to}`, 'money');
        const big = event.data.amount >= 100;
        if (event.data.to   === myUsername) SoundManager.playCollect();
        else if (event.data.from === myUsername) SoundManager.playPay(big);
        break;
      }
      case 'FREE_PARKING_COLLECTED':
        UIManager.appendLog(`🅿 ${event.data.username} collected $${event.data.amount} from Free Parking!`, 'money');
        SoundManager.playBigCollect();
        break;
      case 'MONEY_RECEIVED':
        UIManager.appendLog(`${event.data.username} collected $${event.data.amount}`, 'money');
        if (event.data.username === myUsername) SoundManager.playCollect();
        break;
      case 'CARD_DRAWN':
        UIManager.appendLog(`🃏 ${event.data.username}: "${event.data.card.text}"`, 'card');
        SoundManager.playCard();
        break;
      case 'BUILDING_BUILT':
        UIManager.appendLog(`🏠 ${event.data.username} built a ${event.data.buildingType} on ${event.data.name}`, 'property');
        SoundManager.playBuild();
        break;
      case 'BUILDING_SOLD':
        UIManager.appendLog(`${event.data.username} sold a ${event.data.buildingType} on ${event.data.name} for $${event.data.sellPrice}`, 'property');
        break;
      case 'PROPERTY_MORTGAGED':
        UIManager.appendLog(`${event.data.username} mortgaged ${event.data.name}`, 'property');
        break;
      case 'PROPERTY_UNMORTGAGED':
        UIManager.appendLog(`${event.data.username} unmortgaged ${event.data.name}`, 'property');
        break;
      case 'TRADE_OFFERED':
        UIManager.appendLog(`🤝 ${event.data.from} offered a trade to ${event.data.to}`, 'trade');
        break;
      case 'TRADE_ACCEPTED':
        UIManager.appendLog(`Trade between ${event.data.from} and ${event.data.to} completed`, 'trade');
        SoundManager.playCollect();
        break;
      case 'TRADE_REJECTED':
        UIManager.appendLog(`${event.data.to} rejected ${event.data.from}'s trade`, 'trade');
        break;
      case 'PLAYER_BANKRUPT':
        UIManager.appendLog(`💸 ${event.data.username} is bankrupt!`, 'game');
        SoundManager.playBankrupt();
        break;
      case 'GAME_OVER':
        UIManager.appendLog(
          event.data.winner ? `🏆 ${event.data.winner} wins the game!` : "🤝 It's a draw!", 'game'
        );
        SoundManager.playGameOver();
        break;
      // All other event types are silently ignored per interface contract.
    }
  }

  // ── destroy ─────────────────────────────────────────────────────────────────

  function destroy() {
    document.getElementById('close-property-modal')?.removeEventListener('click', _onClosePropertyModal);
    document.getElementById('close-my-props-modal')?.removeEventListener('click', _onCloseMyPropsModal);
    document.getElementById('close-trade-modal')?.removeEventListener('click', _onCloseTradeModal);
    document.getElementById('cancel-trade-modal-btn')?.removeEventListener('click', _onCancelTradeModal);
    document.getElementById('send-trade-btn')?.removeEventListener('click', _onSendTrade);
    document.getElementById('accept-trade-btn')?.removeEventListener('click', _onAcceptTrade);
    document.getElementById('reject-trade-btn')?.removeEventListener('click', _onRejectTrade);

    // Remove the board DOM we created in init().
    document.getElementById('board')?.remove();

    // Hide the framework-owned sidebar dice (we showed it in update()).
    _hideSidebarDice();

    _myUserId             = null;
    _emit                 = null;
    _isSpectator          = false;
    _onClosePropertyModal = null;
    _onCloseMyPropsModal  = null;
    _onCloseTradeModal    = null;
    _onCancelTradeModal   = null;
    _onSendTrade          = null;
    _onAcceptTrade        = null;
    _onRejectTrade        = null;
  }

  // ── player-card data hook ────────────────────────────────────────────────────
  //
  // Replaces ui-manager.updatePlayerPanels's hand-rolled Monopoly reads
  // (isMonopoly gate + money + jail/bankrupt badges + property count
  // subtext) per docs/renderer-contract.md.  Framework owns the visual
  // chrome (color dot, name, AFK badge, active-turn highlight); we own
  // the in-card game-specific content.

  function getPlayerCardData(player, state) {
    const props = state.properties || {};
    const owned = Object.values(props).filter((p) => p.ownerId === player.userId).length;

    const badges = [];
    if (player.inJail) badges.push({ label: 'JAIL' });
    if (player.isBankrupt) badges.push({ label: 'OUT' });

    const subtextParts = [`${owned} propert${owned === 1 ? 'y' : 'ies'}`];
    if (player.jailCards > 0) subtextParts.push(`${player.jailCards} jail card(s)`);

    return {
      primaryValue: typeof player.money === 'number' ? `$${player.money.toLocaleString()}` : '',
      badges,
      subtext: subtextParts.join(' · '),
      dimmed: !!player.isBankrupt,
    };
  }

  // ── public API ───────────────────────────────────────────────────────────────

  return { init, update, onEvent, destroy, getPlayerCardData };

})();

// Self-register with the framework registry.
GameRendererRegistry.register('monopoly', MonopolyRenderer);
