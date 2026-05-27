# Socket.io Events

> Real-time WebSocket events used by the LAN Games client and server.
> For REST endpoints, see [API Reference](api.md). Back to
> [README](../README.md).

## Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join_game` | `gameId` | Join the Socket.io room for a game; server replies with full state |
| `leave_game` | — | Leave current game room |
| `lobby:join` | `gameId` | Join a waiting-room lobby (adds player to the roster) |
| `game:start` | — | Host starts the game |
| `game:action` | `{ action, ...payload }` | **Universal action event** — all player moves use this single event |
| `game:save` | — | Save (pause) the current game |
| `chat:message` | `{ text }` | Send a chat message to the game room |

### `game:action` — action names by game

**Monopoly**

| `action` | Extra payload | Effect |
|----------|--------------|--------|
| `rollDice` | — | Roll and move |
| `buyProperty` | — | Buy the current square |
| `declinePurchase` | — | Decline; triggers auction if enabled |
| `placeBid` | `{ amount }` | Place a bid in an ongoing auction |
| `passAuction` | — | Pass on the current auction |
| `endTurn` | — | End the current turn |
| `payJailFine` | — | Pay to leave jail |
| `useJailCard` | — | Use a Get Out of Jail Free card |
| `buildHouse` | `{ position }` | Build a house or hotel |
| `sellHouse` | `{ position }` | Sell a house or hotel |
| `mortgageProperty` | `{ position }` | Mortgage a property |
| `unmortgageProperty` | `{ position }` | Unmortgage a property |
| `offerTrade` | `{ toUserId, offerMoney, offerProps, offerCards, requestMoney, requestProps, requestCards }` | Propose a trade |
| `acceptTrade` | — | Accept a pending trade offer |
| `rejectTrade` | — | Reject a pending trade offer |
| `cancelTrade` | — | Cancel an outgoing trade offer |
| `declareBankruptcy` | — | Eliminate yourself and transfer assets |

**Connect Four**

| `action` | Extra payload | Effect |
|----------|--------------|--------|
| `dropPiece` | `{ column }` | Drop a piece into the given column (0-indexed) |

**Tic-Tac-Toe**

| `action` | Extra payload | Effect |
|----------|--------------|--------|
| `markCell` | `{ row, col }` | Mark the cell at (row, col); both 0-indexed |

**Yahtzee**

| `action` | Extra payload | Effect |
|----------|--------------|--------|
| `rollDice` | `{ held? }` | Roll the dice; `held` is a boolean array indicating which dice carry over from the previous roll (omit on the first roll of a turn) |
| `scoreCategory` | `{ category }` | Commit the current dice to the named category; locks the cell. Category strings: `ones`, `twos`, …, `sixes`, `threeOfAKind`, `fourOfAKind`, `fullHouse`, `smallStraight`, `largeStraight`, `yahtzee`, `chance` |

**Battleship**

| `action` | Extra payload | Valid in phase | Effect |
|----------|--------------|----------------|--------|
| `placeShip` | `{ shipId, origin: {x, y}, orientation }` | setup | Place or reposition one ship. Validates bounds, no-overlap, and not-yet-Ready. |
| `removeShip` | `{ shipId }` | setup | Return a placed ship to the unplaced pool. |
| `commitPlacement` | — | setup | Mark this player Ready. Requires all 5 ships placed. Auto-transitions to firing when both players are Ready. |
| `uncommitPlacement` | — | setup | Un-Ready. Only valid while the phase is still `setup` (i.e. the opponent hasn't also Ready'd yet). |
| `fireShot` | `{ cell: {x, y} }` | firing | Fire at a cell on the opponent's grid. Result (`hit` / `miss` / `sunk`) is recorded in both players' shot logs. Turn passes regardless of result. |

**Risk**

| `action` | Extra payload | Valid in phase | Effect |
|----------|--------------|----------------|--------|
| `placeReinforcement` | `{ territoryId, count }` | reinforce | Add armies to one of your territories |
| `tradeCards` | `{ cardIds: [id, id, id] }` | reinforce | Trade a 3-card set for escalating bonus armies |
| `endReinforcePhase` | — | reinforce | Advance to attack (only when no armies remain) |
| `attackTerritory` | `{ from, to, attackerDice }` | attack | One round of combat; defender auto-rolls max dice |
| `endAttackPhase` | — | attack | Advance to fortify |
| `fortify` | `{ from, to, count }` | fortify | Move armies through a connected friendly chain (once per turn) |
| `endTurn` | — | fortify | End turn and draw a card if you conquered at least one territory |
| `declareBankruptcy` | — | any | Eliminate yourself; all your territories become neutral and your cards are discarded |

**Checkers**

| `action` | Extra payload | Effect |
|----------|--------------|--------|
| `move` | `{ from: { row, col }, to: { row, col } }` | Move a piece; may capture, chain, or crown |
| `skipTurn` | — | Framework disconnect timer (not player-initiated) |

**The Game of Life**

The active action depends on the player's `pending` field — a discriminated union of pending choices. When `pending` is `null` and it's your turn, you can `spin` plus any of the out-of-band purchase actions.

| `action` | Extra payload | Valid when | Effect |
|----------|--------------|------------|--------|
| `spin` | — | `pending === null`, not retired | Generate 1–10, animate movement, resolve landing-square effect |
| `chooseBranch` | `{ nextSquareId }` | `pending.type === 'fork' \|\| 'retirement-fork'` | Pick a fork direction (start fork or retirement fork) |
| `chooseCareer` | `{ cardId }` | `pending.type === 'career-draw'` | Pick from 2 offered career cards; chains directly into the salary draw |
| `chooseSalary` | `{ cardId }` | `pending.type === 'salary-draw'` | Pick from 2 offered salary cards |
| `chooseHouse` | `{ houseId }` | `pending.type === 'house-draw'` | Pick from 3 offered house cards; rejects with an error if the chosen house is unaffordable (pending stays so you can pick a cheaper one) |
| `buyAutoInsurance` | — | your turn, no pending, not mid-spin-again | $10,000; nullifies auto-accident squares |
| `buyLifeInsurance` | — | same | $20,000; nullifies life-accident squares |
| `buyStock` | `{ number }` | same; one stock per player; number 1–10 must not be already owned | $50,000; pays $10k whenever any player's spinner matches |
| `endTurn` | — | your turn, no pending | Rarely needed — most turns auto-end after effect resolution |
| `skipTurn` | (framework-internal) | your turn | Auto-skip on disconnect timer |

## Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `game:state` | `{ state }` | Full state sync — sent on join or reconnect |
| `game:update` | `{ state, events[] }` | Incremental update after every action |
| `game:error` | `{ message }` | Action rejected — sent only to the acting socket |
| `game:saved` | `{ savedBy }` | Game was saved |
| `trade:incoming` | `{ from, payload }` | Targeted directly to the trade recipient |
| `chat:message` | `{ username, text, timestamp }` | Chat message broadcast to the room |
| `lobby:update` | — | Broadcast to all sockets; clients on the lobby screen refresh their game list |
| `game:turn_warning` | `{ username, deadlineTimestamp }` | Disconnected player's turn will auto-skip; `deadlineTimestamp` is Unix ms when the skip fires |
| `auth:error` | `{ message }` | Auth failure; socket is disconnected after this |

### Game events (inside `game:update → events[]`)

Each event has `{ type, data, timestamp }`. Clients use these for sounds, animations, and log entries.

| `type` | Notable `data` fields |
|--------|-----------------------|
| `DICE_ROLLED` | `die1`, `die2`, `doubles` |
| `PLAYER_MOVED` | `username`, `from`, `to` |
| `PLAYER_LANDED` | `username`, `squareName` |
| `PASSED_GO` | `username`, `amount` |
| `PROPERTY_BOUGHT` | `username`, `name`, `price` |
| `AUCTION_STARTED` | `name`, `position`, `minBid` |
| `AUCTION_WON` | `username`, `name`, `amount` |
| `MONOPOLY_ACHIEVED` | `username`, `colorGroup` |
| `RENT_PAID` | `from`, `to`, `amount` |
| `CARD_DRAWN` | `username`, `card` |
| `BUILDING_BUILT` | `username`, `name`, `buildingType` |
| `TRADE_OFFERED` | `from`, `to` |
| `TRADE_ACCEPTED` | `from`, `to` |
| `PLAYER_BANKRUPT` | `username` |
| `PLAYER_JAILED` | `username` |
| `TURN_SKIPPED` | `username` |
| `PIECE_DROPPED` | `username`, `column`, `row` |
| `REINFORCEMENT_PLACED` *(Risk)* | `username`, `territoryId`, `count` |
| `CARDS_TRADED` *(Risk)* | `username`, `cardIds`, `bonusArmies`, `setNumber`, `territoryBonus`, `bonusTerritoryId` |
| `ATTACK_DECLARED` *(Risk)* | `from`, `to`, `attacker`, `defender`, `attackerDice`, `defenderDice` |
| `DICE_ROLLED` *(Risk variant)* | `from`, `to`, `attackerRolls[]`, `defenderRolls[]`, `attackerLosses`, `defenderLosses` |
| `TERRITORY_CONQUERED` *(Risk)* | `username`, `from`, `to`, `armiesMovedIn` |
| `ARMIES_FORTIFIED` *(Risk)* | `username`, `from`, `to`, `count` |
| `CONTINENT_HELD` *(Risk)* | `username`, `continent`, `bonus` |
| `CARD_DRAWN` *(Risk variant)* | `username` *(actual card is private — sent only inside the owning player's filtered state)* |
| `PHASE_CHANGED` *(Risk)* | `phase` (`reinforce` / `attack` / `fortify`), `username` |
| `PLAYER_ELIMINATED` *(Risk)* | `username`, `eliminatedBy` |
| `CELL_MARKED` *(Tic-Tac-Toe)* | `username`, `row`, `col`, `token` |
| `DICE_ROLLED` *(Yahtzee variant)* | `username`, `dice[]`, `held[]`, `rollsUsed` |
| `CATEGORY_SCORED` *(Yahtzee)* | `username`, `category`, `dice[]`, `points` |
| `TURN_STARTED` *(Yahtzee/Battleship)* | `username` |
| `TURN_ENDED` *(Yahtzee)* | `username` |
| `SHIP_PLACED` *(Battleship)* | `username`, `shipId` *(positions deliberately omitted — events are broadcast to both players)* |
| `SHIP_REMOVED` *(Battleship)* | `username`, `shipId` |
| `PLAYER_READY` *(Battleship)* | `username` |
| `PLAYER_UNREADY` *(Battleship)* | `username` |
| `SETUP_COMPLETE` *(Battleship)* | `firstPlayer` — the username who fires first after both players Ready |
| `SHOT_FIRED` *(Battleship)* | `shooter`, `target`, `cell: {x,y}`, `result: 'hit'|'miss'|'sunk'` |
| `SHIP_SUNK` *(Battleship)* | `owner`, `shipId`, `shipName`, `length`, `cells[]` *(cell footprint revealed on sink — by rule, sunk ships are no longer hidden)* |
| `PIECE_MOVED` *(Checkers)* | `username`, `from: {row, col}`, `to: {row, col}` |
| `PIECE_CAPTURED` *(Checkers)* | `username`, `capturedAt: {row, col}`, `by: {row, col}` |
| `PIECE_CROWNED` *(Checkers)* | `username`, `position: {row, col}` |
| `CHAIN_CONTINUE` *(Checkers)* | `piece: {row, col}` *(the piece must continue capturing)* |
| `CHAIN_ABANDONED` *(Checkers)* | `username`, `piece: {row, col}` *(chain ended by disconnect skip)* |
| `SPINNER_RESULT` *(Life)* | `username`, `value` (1–10) |
| `PLAYER_MOVED` *(Life variant)* | `username`, `from`, `to`, `reason?` (`'branch'` or `'post-marriage'` / `'post-baby'` / etc. for stub-bumps) |
| `FORK_CHOICE_PENDING` *(Life)* | `username`, `squareId`, `kind?` (`'retirement-fork'` when applicable), `options[]: { id, label }` |
| `BRANCH_CHOSEN` *(Life)* | `username`, `from`, `to` |
| `CAREER_DRAW_OPTIONS` *(Life)* | `username`, `options[]: CareerCard` *(sent only inside the acting player's filtered state via pending state)* |
| `SALARY_DRAW_OPTIONS` *(Life)* | `username`, `options[]: SalaryCard` |
| `HOUSE_DRAW_OPTIONS` *(Life)* | `username`, `options[]: HouseCard` |
| `CAREER_CHOSEN` *(Life)* | `username`, `card` |
| `SALARY_CHOSEN` *(Life)* | `username`, `card` |
| `HOUSE_PURCHASED` *(Life)* | `username`, `house` |
| `PAYDAY` *(Life)* | `username`, `total`, `salary`, `careerBonus` |
| `LOAN_PAID` *(Life)* | `username`, `amount`, `squareId` |
| `MONEY_PAID` *(Life)* | `username`, `amount`, `to` (`'bank'`), `reason`, `taxBySalary?` |
| `MONEY_RECEIVED` *(Life)* | `username`, `amount`, `from` (`'bank'`), `reason` |
| `MONEY_TRANSFERRED` *(Life)* | `from`, `to`, `amount`, `reason` (e.g. `'wedding-gift'`, `'baby-gift'`, `'twins-gift'`, or the source square's label) |
| `PLAYER_MARRIED` *(Life)* | `username`, `giftsCollected`, `contributors[]` |
| `PLAYER_MARRIED_NO_EFFECT` *(Life)* | `username` *(emitted if a married player re-lands on the marriage square)* |
| `PLAYER_HAD_BABY` *(Life)* | `username`, `childCount`, `totalChildren`, `giftsCollected`, `contributors[]`, `kind` (`'baby'` or `'twins'`) |
| `INSURANCE_PURCHASED` *(Life)* | `username`, `insuranceType` (`'auto'` or `'life'`), `cost` |
| `INSURANCE_COVERED` *(Life)* | `username`, `insuranceType`, `squareId`, `avoided` *(emitted on an accident square the player is insured against)* |
| `STOCK_PURCHASED` *(Life)* | `username`, `number`, `cost` |
| `STOCK_PAYOUT` *(Life)* | `username`, `number`, `amount` *(fires during **any** player's spin whose result matches `number`)* |
| `SPIN_AGAIN_GRANTED` *(Life)* | `username` |
| `PLAYER_RETIRED_CA` *(Life)* | `username`, `squareId`, `tilesDrawn` *(tile values deliberately omitted — they stay hidden until game over)* |
| `PLAYER_RETIRED_ME` *(Life)* | `username`, `squareId`, `cashAtRetirement` |
| `GAME_OVER` | `winner` (userId, or array of userIds for ties, or `null` for draw); `winnerUsername` *(Life — same shape, denormalised for display)*; `finalScores[]` *(Yahtzee)*; `finalScores: { [userId]: { cash, house, lifeTilesValue, childrenBonus, total, retiredTo, lifeTiles[] } }` *(Life — full breakdown including revealed tile values)*; `finalFleets` *(Battleship — `{ [userId]: ships[] }` revealing both players' full layouts at game over)* |
