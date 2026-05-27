# How to Play

> Complete rules and controls for all eight games in LAN Games. For
> installation and setup, see the [README](../README.md#quick-start).
> To customize game rules, see [Configuration](configuration.md).

---

## Monopoly

### Your turn

1. **Roll Dice** — moves your token; doubles let you roll again.
2. **Unowned property** — buy it or let it go to auction.
3. **Owned property** — rent is collected automatically.
4. **Chance / Community Chest** — card drawn and resolved automatically.
5. **Go to Jail** — landing on "Go to Jail" or rolling three consecutive doubles.
6. **End Turn** — passes to the next player.

### Anytime on your turn (pre-roll or post-roll)

- **Manage Properties** — click any board square or the "Manage Properties" button to build houses/hotels or mortgage/unmortgage.
- **Propose Trade** — offer money, properties, and Get Out of Jail Free cards in any combination.
- **Declare Bankruptcy** — if you cannot pay a debt, all your assets transfer to the creditor (or the bank).

### Jail

- Roll doubles to escape for free.
- Pay the $50 fine before rolling (configurable).
- Use a Get Out of Jail Free card.
- After 3 failed turns you must pay the fine and roll.

### Winning

Last player standing (not bankrupt) wins.

---

## Connect Four

Click a **▼** button above any column to drop your piece.  
The game alternates turns automatically.  
**Win** by connecting 4 of your pieces in a row — horizontally, vertically, or diagonally.  
**Draw** when the board fills with no winner.

---

## Risk

Your turn has three phases. The sidebar's **End … phase** button advances to the next one.

### 1. Reinforce

You start the phase with `max(3, ⌊territoriesOwned / 3⌋) + continent bonuses` armies to place.  
**Click any of your territories** to drop one army there. Repeat until your reserve hits zero, then **End reinforce phase**.

If your hand contains a valid 3-card set (3 of a kind, 1 of each, or 2+wild), the **Trade cards** button appears. Trading immediately adds the bonus armies to your reserve.

### 2. Attack (optional)

**Click one of your territories** (with ≥ 2 armies) to select it as the attacker.  
**Click an adjacent enemy territory** to launch one round of combat. Dice are rolled server-side, ties go to the defender, and a conquered territory automatically receives your dice count in armies.  
Attack as many times as you want; click the source again to deselect. Click **End attack phase** when done.

If you conquer at least one territory this turn, you draw one card at end of turn.

### 3. Fortify (one move per turn)

**Click your source territory**, then **a destination territory** reachable through your own land. A prompt asks how many armies to move (leaving at least 1 behind).  
Click **End turn** to pass.

### Winning

Conquer every territory on the board.

---

## Tic-Tac-Toe

Click any empty cell on the 3 × 3 grid to mark it.  
The game alternates turns automatically between `✕` (first player) and `◯`.  
**Win** by getting three of your marks in a row — horizontally, vertically, or diagonally.  
**Draw** when the board fills with no winner.

---

## Yahtzee

### Your turn

1. **Roll** — clicks the Roll button to roll all five dice. You get up to three rolls per turn.
2. **Hold** — click any die between rolls to keep it; click again to release. Held dice carry to the next roll; the Roll button shows "Roll N of 3 — K held".
3. **Score** — click any unscored category cell in your column to **preview** the score; click it again to **commit**. Clicking a different category moves the selection; clicking Roll cancels it.

A category is **locked** once scored — including categories scored at 0. Use `=== null` not falsy checks (a deliberate 0 is a real score). Two-click commit is the protection against accidental lock-in.

### The score sheet

Players are columns, the 13 categories are rows. Your column shows live previews of every unscored category given the current dice; opponents' unscored cells stay blank. Summary rows show upper subtotal, upper bonus (+35 when subtotal ≥ 63), lower total, and grand total — all derived client-side.

### Winning

After every player fills all 13 categories, the highest grand total wins. Ties produce a shared-winner array and the modal/log call out all tied players.

---

## Battleship

Battleship plays in two phases.

### Setup phase

Both players are in setup at the same time — there's no turn order. Drag a ship from the **Unplaced ships** panel onto your grid; press **R while dragging** to rotate horizontal ↔ vertical. Ships highlight green for a valid placement, red for invalid. Click a placed ship to pick it back up and reposition it.

When all five ships are placed, click **Ready**. You can **Unready** until the opponent commits — once both players are Ready, the game transitions to firing.

### Firing phase

Your fleet is on the left, the opponent's waters are on the right. On your turn, click any unshot cell of the opponent's grid to fire. Misses are marked with a dot, hits with a cross, and sunk ships reveal their full position. Turn passes after every shot regardless of result.

Sink all five of the opponent's ships to win. At game over both fleets are revealed.

---

## Checkers

Two players — Red and Black — on an 8×8 board with 12 pieces each. Red moves first. Pieces occupy only the dark squares and move diagonally forward, one square at a time.

Click an eligible piece (highlighted with a glow) to select it. Valid destinations appear as markers on the board. Click a destination to move. If your piece lands adjacent to an opponent's piece with an empty square beyond, it captures by jumping over — and if another jump is available from the new position, you must keep jumping (chain capture). Captures are mandatory: if any capture exists, you must take one.

When a regular piece reaches the opponent's back row, it is crowned a king (👑). Kings can move and capture diagonally in all four directions, but still one square at a time — this is American Checkers, not International Draughts. Coronation ends a chain capture even if more jumps would be available as a king.

**Win** by capturing all of your opponent's pieces, or by leaving them with no legal moves. Stalemate is a loss for the player who cannot move, not a draw.

## The Game of Life

Life plays in three phases: a start choice, the main track, and retirement. The board is a directed graph of 64 squares with branches and merges — your pawn (a small car with pegs for spouse and children) traverses it from the start square to one of two retirement terminals.

### Phase 1 — Start choice

Your first action is **chooseBranch**: take the **Career** path or the **College** path.

- **Career** skips the loan and earns immediately, but draws from the non-degree-required career pool (smaller payday bonuses on average).
- **College** pays $40,000 in loans up front (your cash can go negative — that's fine) but unlocks the degree-required pool (Doctor, Lawyer, Computer Consultant, etc., with larger payday bonuses).

The server offers 2 career cards filtered by your path, then 2 salary cards. Your first turn ends after both choices are made.

### Phase 2 — Main track

Each turn: spin (1–10), animate movement square-by-square, resolve the landing square's effect. Square types include payday (collect salary + career bonus), buy-house (pick from 3 offered houses), marry, have-baby/have-twins, auto-accident, life-accident (illness), spin-again, and pay-tax-by-salary (consumes your salary's `taxDue`).

Out-of-band actions available throughout your turn (when no decision is pending and you're not mid-spin-again):

- **Buy Auto Insurance** ($10,000) — nullifies auto-accident squares.
- **Buy Life Insurance** ($20,000) — nullifies life-accident squares.
- **Buy Stock** — pick a number 1–10 for $50,000. From then on, **whenever any player's spinner matches your number**, you collect $10,000. Each number can be owned by at most one player.

Marriage and children trigger collections from every other player: $5,000 wedding gift, $5,000 baby shower, $10,000 for twins. Your spouse and children show as pegs on your car for everyone to see.

### Phase 3 — Retirement

Landing on the retirement-fork square pauses your turn for a deliberate choice:

- **Countryside Acres** is the safe path. On arrival you draw up to 4 life tiles from a shrinking deck. Tile values count toward your final score.
- **Millionaire Estates** is the gamble. No tiles. You retire with whatever cash you have, and the outcome **does not resolve until every player retires**. At game over, the highest-cash ME retiree wins the game outright; all other ME retirees score zero.

The strategic crux is the **life-tile race** — the deck holds 20 tiles, while up to 6 players × 4 tiles each = 24 possible draws. Late CA retirees may find the deck empty. Retiring early is a gamble against your own future earnings; retiring late is a gamble against the deck.

Retired players stay on the board (their cars sit on the terminal square with a "✓ Retired" badge) but are skipped in turn rotation. The game continues until every player has retired.

### Final scoring

```
finalScore = cash
           + house.value
           + sum(lifeTiles[].value)
           + (children × $50,000)
```

If **any** player retired to Millionaire Estates, the highest-cash ME retiree(s) win outright and all other ME retirees score zero (regardless of their other holdings). If **no** player went ME, the highest-score Countryside Acres retiree wins. Ties produce a winners array — multiple winners share the championship.

Life tiles flip face-up one at a time during the game-over reveal animation, with a running total updating as each tile lands.
