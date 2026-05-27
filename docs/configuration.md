# Configuration

> Every game's rules, board layout, and tuning parameters live in JSON
> config files under `server/games/<game>/config/`. This reference covers
> every configurable value for all eight bundled games.
>
> Config changes apply only to newly created games; in-progress games
> carry their own embedded snapshot. Hot-reload a game's config without
> a server restart via `POST /api/games/types/:type/config/reload`
> (see [API Reference](api.md)). For gameplay instructions, see
> [How to Play](how-to-play.md).

---

## Monopoly Settings

`server/games/monopoly/config/settings.json`

| Key | Default | Description |
|-----|---------|-------------|
| `startingMoney` | 1500 | Amount each player starts with |
| `goSalary` | 200 | Amount collected when passing or landing on Go |
| `incomeTaxAmount` | 200 | Flat income tax option |
| `incomeTaxPercent` | 10 | Percent-of-net-worth income tax option |
| `incomeTaxChoice` | true | If `true`, player chooses whichever is lower |
| `luxuryTaxAmount` | 100 | Luxury Tax amount |
| `jailFine` | 50 | Cost to pay your way out of jail |
| `jailMaxTurns` | 3 | Turns in jail before the fine becomes mandatory |
| `maxHousesInBank` | 32 | Total houses the bank can supply |
| `maxHotelsInBank` | 12 | Total hotels the bank can supply |
| `auctionEnabled` | true | Auction when a player declines to buy |
| `auctionMinBid` | 1 | Minimum opening bid |
| `freeParkingJackpot` | false | Taxes and fines accumulate on Free Parking |
| `maxPlayers` | 8 | Maximum players per game |
| `minPlayersToStart` | 2 | Minimum players to start |
| `tradeEnabled` | true | Allow player-to-player trades |
| `bankruptcyToBank` | true | Bankrupt assets go to the bank, not the creditor |

---

## Monopoly Board / Properties

`server/games/monopoly/config/board.json` — array of 40 objects, one per square (index 0 = Go, 39 = last square).

**Property square**
```json
{
  "position":       1,
  "type":           "property",
  "name":           "Mediterranean Avenue",
  "colorGroup":     "brown",
  "price":          60,
  "houseCost":      50,
  "hotelCost":      50,
  "mortgage":       30,
  "unmortgageCost": 33,
  "rent": {
    "base":        2,
    "monopoly":    4,
    "oneHouse":    10,
    "twoHouses":   30,
    "threeHouses": 90,
    "fourHouses":  160,
    "hotel":       250
  }
}
```

**Railroad square**
```json
{
  "position": 5,
  "type":     "railroad",
  "name":     "Reading Railroad",
  "price":    200,
  "mortgage": 100,
  "unmortgageCost": 110,
  "rent": { "owned1": 25, "owned2": 50, "owned3": 100, "owned4": 200 }
}
```

**Utility square**
```json
{
  "position": 12,
  "type":     "utility",
  "name":     "Electric Company",
  "price":    150,
  "mortgage": 75,
  "unmortgageCost": 83,
  "rent": { "multiplier1": 4, "multiplier2": 10 }
}
```

---

## Monopoly Cards

`server/games/monopoly/config/cards.json` — two arrays: `chance` and `communityChest` (16 cards each).

```json
{
  "id":     "ch_advance_go",
  "text":   "Advance to Go. Collect $200.",
  "action": "advance_to",
  "data":   { "position": 0, "collectGoSalary": true }
}
```

**Supported `action` values:**

| Action | `data` fields | Effect |
|--------|---------------|--------|
| `advance_to` | `position`, `collectGoSalary` | Move token to board position |
| `advance_to_nearest` | `type` (`railroad`/`utility`), `collectGoSalary`, `rentMultiplier` | Move to nearest of that type |
| `collect` | `amount` | Player receives money from bank |
| `pay` | `amount` | Player pays bank |
| `pay_each_player` | `amount` | Player pays every other player |
| `collect_from_each_player` | `amount` | Player collects from every other player |
| `go_to_jail` | — | Send to jail immediately |
| `get_out_of_jail` | — | Player receives a Get Out of Jail Free card |
| `go_back` | `spaces` | Move back N spaces |
| `repairs` | `houseCost`, `hotelCost` | Charge per house and per hotel owned |

The deck reshuffles automatically when exhausted.

---

## Connect Four Settings

`server/games/connect-four/config/settings.json`

| Key | Default | Description |
|-----|---------|-------------|
| `boardWidth` | 7 | Number of columns |
| `boardHeight` | 6 | Number of rows |
| `winLength` | 4 | Pieces in a row required to win |
| `playerColors` | red, yellow | Array of `{ id, hex }` colour objects |
| `playerTokens` | 🔴, 🟡 | Emoji tokens shown in the player panel |

---

## Risk Settings

`server/games/risk/config/settings.json`

| Key | Default | Description |
|-----|---------|-------------|
| `initialArmiesByPlayerCount` | `{2:40,3:35,4:30,5:25,6:20}` | Starting armies per player as a function of player count |
| `reinforcementMinimum` | 3 | Minimum armies per reinforce phase |
| `reinforcementDivisor` | 3 | Base reinforcements = `floor(territoriesOwned / divisor)` |
| `cardTradeBonuses` | `[4, 6, 8, 10, 12, 15]` | Bonus armies for the 1st, 2nd, … sets traded |
| `cardTradeIncrement` | 5 | Added to the last bonus for each set beyond the array |
| `attackerMaxDice` | 3 | Max dice per attack |
| `defenderMaxDice` | 2 | Max dice per defence |
| `defenderDicePolicy` | `"auto-max"` | Defender always rolls as many dice as possible (no interactive choice) |
| `minArmiesToAttack` | 2 | Source territory must have at least this many armies to attack |
| `maxAttacksPerTurn` | `null` | No limit |
| `fortifyOncePerTurn` | true | Single fortify move per turn (classic rule) |
| `winCondition` | `"world-domination"` | Only victory mode supported |
| `minPlayers` | 2 | |
| `maxPlayers` | 6 | |
| `playerColors` | 6 entries | Array of `{ id, hex }` |
| `playerTokens` | 🔴 🔵 🟢 🟡 🟣 ⚫ | Emoji tokens shown in the player panel |

---

## Risk Board / Territories

`server/games/risk/config/board.json`

The board is an object with two keys: `continents` and `territories`. Continents declare a name, an army bonus, and the list of member territory ids:

```json
{
  "continents": {
    "north-america": { "name": "North America", "bonus": 5, "territories": [...9 ids] },
    "australia":     { "name": "Australia",     "bonus": 2, "territories": [...4 ids] }
  },
  "territories": [
    {
      "id":        "alaska",
      "name":      "Alaska",
      "continent": "north-america",
      "adjacent":  ["northwest-territory", "alberta", "kamchatka"]
    }
  ]
}
```

Adjacencies are validated at load time as **symmetric** — if A lists B as a neighbour, B must list A. Each continent's `territories` array must exactly match the set of territories whose `continent` field points to it.

## Risk Cards

`server/games/risk/config/cards.json`

44 cards total: 42 territory cards plus 2 wilds. A territory card has a `troopType` of `infantry`, `cavalry`, or `artillery` and a `territoryId` matching a board territory. Wild cards have `troopType: "wild"` and `territoryId: null`.

```json
{
  "cards": [
    { "id": "card-alaska",  "territoryId": "alaska",  "troopType": "infantry" },
    { "id": "card-wild-1",  "territoryId": null,      "troopType": "wild" }
  ]
}
```

A valid trade-in is exactly 3 cards forming one of:
- Three of the same troop type
- One of each of the three troop types
- Any 2 cards plus a wild

Trading a card whose `territoryId` you currently own grants +2 extra armies on that territory.

---

## Tic-Tac-Toe Settings

`server/games/tic-tac-toe/config/settings.json`

| Key | Default | Description |
|-----|---------|-------------|
| `boardSize` | 3 | Square board edge length (also used as default `winLength`) |
| `winLength` | 3 | Marks in a row required to win |
| `playerColors` | x, o | Array of `{ id, hex }` colour objects |
| `playerTokens` | ✕, ◯ | Symbols shown in each cell |

---

## Yahtzee Settings

`server/games/yahtzee/config/settings.json`

| Key | Default | Description |
|-----|---------|-------------|
| `diceCount` | 5 | Number of dice rolled per turn |
| `diceFaces` | 6 | Faces per die |
| `rollsPerTurn` | 3 | Maximum rolls a player gets each turn |
| `upperBonusThreshold` | 63 | Upper-section subtotal needed for the bonus |
| `upperBonus` | 35 | Bonus awarded when the upper subtotal reaches the threshold |
| `fullHouseScore` | 25 | Fixed score for a full house |
| `smallStraightScore` | 30 | Fixed score for a small straight (4 consecutive faces) |
| `largeStraightScore` | 40 | Fixed score for a large straight (5 consecutive faces) |
| `yahtzeeScore` | 50 | Fixed score for five of a kind |
| `minPlayers` | 1 | Solo play supported |
| `maxPlayers` | 8 | |
| `playerColors` | 8 entries | Array of `{ id, hex }` |
| `playerTokens` | 🎲 🎯 🎪 🎨 🎭 🎰 🎳 🎱 | Emoji tokens shown in the player panel |

---

## Battleship Settings

`server/games/battleship/config/settings.json`

| Key | Default | Description |
|-----|---------|-------------|
| `gridWidth` | 10 | Grid width in cells |
| `gridHeight` | 10 | Grid height in cells |
| `ships` | 5-entry array | Each entry is `{ id, name, length }`. Defaults are Carrier (5), Battleship (4), Cruiser (3), Submarine (3), Destroyer (2). |
| `firstPlayerSelection` | `"random"` | Strategy for picking who fires first once both players are Ready. Only `"random"` is implemented in v1; other values are rejected by `loadConfig` with an explicit error. |
| `minPlayers` | 2 | Battleship is 2-player; v1 does not support N-player variants. |
| `maxPlayers` | 2 | |
| `playerColors` | blue, red | Array of `{ id, hex }` |
| `playerTokens` | ⚓ 🚢 | Emoji tokens shown in the player panel |

---

## Checkers Settings

`server/games/checkers/config/settings.json`

| Key | Default | Description |
|-----|---------|-------------|
| `boardSize` | 8 | Square board edge length (standard checkers is always 8) |
| `piecesPerPlayer` | 12 | Starting pieces per side |
| `playerColors` | red, black | Array of `{ id, hex }` colour objects |
| `playerTokens` | 🔴, ⚫ | Emoji tokens shown in the player panel |

Checkers is strictly 2-player; there is no `minPlayers`/`maxPlayers` in the config — the game metadata hardcodes both to 2.

---

## Life Settings

`server/games/life/config/settings.json`

| Key | Default | Description |
|-----|---------|-------------|
| `startingCash` | 10000 | Cash each player begins with |
| `collegeLoanAmount` | 40000 | Debited from cash on the college path's first square; cash may go negative |
| `spinMin` | 1 | Lower bound of the spinner |
| `spinMax` | 10 | Upper bound; also the count of stock numbers |
| `startSquareId` | `"sq-000-start"` | Board square every player begins on |
| `mainTrackEntrySquareId` | `"sq-m01-marry"` | First main-track square (where the college and career paths merge) |
| `careerOptionsCount` | 2 | Career cards offered per draw |
| `salaryOptionsCount` | 2 | Salary cards offered per draw |
| `houseOptionsCount` | 3 | House cards offered per draw |
| `weddingGiftPerPlayer` | 5000 | Marriage square: collected from each other active player |
| `babyGiftPerPlayer` | 5000 | Baby square: collected from each other active player |
| `twinsGiftPerPlayer` | 10000 | Twins square: doubled per-player collection (one baby shower for each twin) |
| `autoInsuranceCost` | 10000 | Cost to buy auto insurance |
| `autoAccidentCost` | 10000 | Charge on the auto-accident square (nullified by insurance) |
| `lifeInsuranceCost` | 20000 | Cost to buy life insurance |
| `lifeAccidentCost` | 20000 | Charge on the life-accident square (nullified by insurance) |
| `stockCost` | 50000 | One-time cost to buy a stock (one per player) |
| `stockPayoutAmount` | 10000 | Payout to the stock owner whenever **any** player's spinner matches |
| `caTilesPerRetiree` | 4 | Life tiles drawn at Countryside Acres retirement (deck has 20 tiles total — capped at remaining) |
| `childScoreBonus` | 50000 | Per-child bonus in the final score formula |
| `minPlayers` | 2 | |
| `maxPlayers` | 6 | |
| `playerColors` | 6 entries | Array of `{ id, hex, label }` |
| `playerTokens` | 🚗 🚙 🏎️ 🚕 🚐 🛻 | Vehicle emojis shown on player cars |

## Life Cards

Life ships four card decks, each loaded from its own JSON config and validated by `config-loader.js` (unique IDs, positive numeric fields, deck non-empty).

`server/games/life/config/careers.json` — 12 careers, 6 with `degreeRequired: true` and 6 without. Filtering happens at draw time so the college path can only be offered degree-required cards and vice versa.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | unique |
| `name` | string | display name (Doctor, Salesperson, …) |
| `degreeRequired` | boolean | gates which path can draw the card |
| `paydayBonus` | number | added to salary on every PAY DAY square |

`server/games/life/config/salaries.json` — 6 salary tiers from $30k to $80k.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | unique |
| `amount` | number | paid on every PAY DAY square |
| `taxDue` | number | charged on the `pay-tax-by-salary` square |

`server/games/life/config/houses.json` — 5 houses; cost is what the player pays, value is what the house contributes to final scoring.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | unique |
| `name` | string | "Starter Home", "Mansion", … |
| `cost` | number | deducted from cash on chooseHouse |
| `value` | number | added to final score (typically > cost so houses are profitable) |

`server/games/life/config/lifeTiles.json` — 20 achievement tiles drawn at Countryside Acres retirement.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | unique |
| `name` | string | "Win Nobel Prize", "Climb Mt. Everest", … |
| `value` | number | added to final score; $100,000–$300,000 |

## Life Board

`server/games/life/config/board.json` — 64 squares modelled as a directed graph. Each square is `{ id, type, label, next[], data? }`:

- `id` — unique kebab-case identifier, e.g. `sq-c01-career-pick`.
- `type` — effect identifier dispatched by the `EFFECTS` registry in `game-logic.js`. See list below.
- `label` — human-readable name displayed by the renderer.
- `next` — array of square IDs. Single entry = linear; multiple entries = a fork.
- `data` — type-specific data (e.g. `{ amount: 5000 }` for pay-bank squares).

The board is composed of:

- **Start fork** (`sq-000-start`) — the only land-on fork that every player traverses. Two branches: `sq-c01-career-pick` (career path, 10 squares) and `sq-u01-college-loan` (college path, 12 squares).
- **Path merge** — both paths terminate on the main-track entry square (`sq-m01-marry`) via their respective junction squares.
- **Main track** (35 squares) — payday squares interleaved with life-event squares, accidents, taxes, and the buy-house, marry, have-baby, have-twins, retirement-fork squares.
- **Retirement fork** (`sq-m35-retirement-fork`) — branches to `sq-r-countryside-01` or `sq-r-millionaire-01`. The terminal squares (`sq-r-countryside-end`, `sq-r-millionaire-end`) have empty `next` arrays — a retired player stays there.

**Land-on forks only.** When the spinner moves a player through a fork mid-traversal, the server always takes `next[0]` automatically — passthrough forks aren't player choices. Only when a player **lands on** a fork (the start fork on their first turn, and the retirement fork) does the server pause for a `chooseBranch` action. This is a deliberate v1 simplification documented in [`game-logic.js`](../server/games/life/game-logic.js).

Known effect types (see `KNOWN_EFFECT_TYPES` in `config-loader.js`):

`career-fork`, `draw-career-degree`, `draw-career-no-degree`, `draw-salary`, `pay-loans`, `pay-bank`, `pay-tax-by-salary`, `collect-bank`, `pay-each-player`, `collect-each-player`, `payday`, `spin-again`, `marry`, `have-baby`, `have-twins`, `buy-house`, `auto-accident`, `life-accident`, `retirement-fork`, `countryside-retirement`, `millionaire-retirement`.
