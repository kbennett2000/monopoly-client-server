# The Game of Life

## Overview

The Game of Life is a roll-and-move journey for 2–6 players. Each player picks a token (a car), spins through major life events — college, career, marriage, kids, a house, retirement — and ends up at one of two retirement destinations. The winner is whoever scores the most at game over, counting cash, the value of their house, life tiles, and a per-child bonus.

A full game takes 30–60 minutes. The board is a sequence of squares with a few forks; the spinner is a 1–10 wheel that replaces dice.

## Setup

Setup is automatic. Each player starts with **$10,000** in cash, no career, no salary, no spouse, no children, and no house. The first player is chosen and the game begins at the **start fork**.

## The Start Fork

Before your first spin you must pick one of two paths:

- **College.** You take out a **$40,000** college loan immediately and start on the college path. You'll draw a higher-tier career card and a higher salary later.
- **Career.** You skip college, save the loan, and start on the career path. Your career and salary draws are from a non-degree pool.

Once you commit, both paths merge back into the main track within a few squares.

## How a Turn Works

On your turn:

1. **Click Spin.** The wheel shows a value 1–10.
2. **Move.** Your car advances exactly that many squares along the track.
3. **Resolve the square you land on.** Some squares do something automatically; others present a choice.
4. The turn ends and play passes to the next player.

There is no "decide where to move" — the spin is the move.

## What Squares Do

The board is a single track (with the start fork already behind you) leading from early-career squares to retirement. Common square types:

- **PAY DAY.** Collect your salary plus your career's payday bonus. For example, a Doctor with a $90,000 salary and a $20,000 career bonus receives $110,000 on each payday.
- **Career draw.** Drawn from the appropriate deck (college or career path). You're shown a few options and pick one. Your career card is yours for the rest of the game.
- **Salary draw.** Same idea — pick a salary tier. Higher salaries also have higher tax rates on Pay-Tax squares.
- **Marry.** You marry; a peg representing your spouse joins your car, and every other active player owes you a small wedding gift ($5,000 each).
- **Have a baby / twins.** Children join your car. Each child increases your final score by $50,000. Every other player owes you a baby gift ($5,000 per child).
- **Buy home.** You're shown three house cards drawn from a deck of five (Starter Home, Country Cottage, Victorian House, Modern Home, Mansion). You pay the cost listed on the card you pick; at game over, the higher *value* on the card counts toward your score. If your remaining cash is less than the cost of every house offered, the buy-home square is skipped automatically — you keep your cash and continue without a house. This rarely happens in normal play but is possible if you've taken on debt (the college loan, accumulated taxes, or insurance costs).
- **Buy insurance / accident squares.** Auto insurance costs **$10,000**; life insurance **$20,000**. If you later land on a matching accident square *with* the matching insurance, you pay nothing; without it, you pay the accident cost.
- **Stock buy / payout.** Spend $50,000 to buy a stock card with a number on it; whenever a payout square hits that number, all stockholders for that number collect $10,000.
- **Pay tax.** Pay the tax amount listed on your current salary card. (Higher earners pay more.)
- **Pay raise / promotion / lawsuit-style squares.** Adjust cash up or down. (This implementation does NOT include the "sue another player" lawsuit mechanic from the boxed game — squares that would trigger a player-vs-player suit are not part of this build.)

If you started on the College path, you'll pass a square that pays back $5,000 toward your loan automatically each time, and your end-of-game tally treats any unpaid loan as debt.

## Retirement — The Endgame Fork

Eventually the board reaches a **retirement fork**. You must choose one of two terminal destinations:

### Countryside Acres (CA)

- Draw up to **4 Life Tiles** from a shared deck of 20.
- Each tile carries a hidden value (ranging $100,000 to $300,000).
- The tile deck does NOT replenish — late retirees may draw fewer than 4 if the deck has emptied.
- Your tile values are added to your final score.

This is the **steadier** retirement: you get whatever you draw, no gambling.

### Millionaire Estates (ME)

- You retire with **no life tiles**.
- At game over, the **single ME retiree with the most cash wins outright** and is declared the game winner regardless of total score.
- All other ME retirees score **zero** — they bet everything on being the richest and lost.

This is the **gambler's** retirement: if you're sitting on a pile of cash relative to the other ME bettors, you can win even from behind on paper. If you misjudge, you walk away with nothing.

Note: you don't have to declare which retirement you're aiming for in advance — you pick when you reach the fork. But which destination you pick is irreversible.

## Winning

The game ends when **all** players have retired. Scoring:

1. If anyone retired to Millionaire Estates: the ME retiree with the most cash wins the *game*. Everyone else's score is calculated for second place onward.
2. For all other (CA) retirees, score:
   - Cash on hand
   - + house value (the **value** field on the house card, not the cost paid)
   - + sum of life tile values
   - + **$50,000 per child**

The winner is the player with the highest total score (after the ME outright-win is settled).

## Useful to Know

- **Marriage is not required to have children** in this implementation. An unmarried player who lands on a baby/twins square gets the child and the gifts; the canonical rule that requires marriage first is deliberately not enforced (this matches the simpler board layout).
- **No lawsuit/sue mechanic.** The boxed game lets a player sue another player on certain squares; that mechanic is not implemented here.
- **The Life Tile deck is shared and depletes**, so retiring early to Countryside Acres is mechanically incentivised — late CA retirees can draw fewer than 4 tiles.
- **The Millionaire Estates pool is winner-take-all *among ME retirees only*.** If only one player picks ME, they win that branch automatically (subject to having any cash); if everyone picks Countryside Acres, the ME branch never triggers.
- **Houses give a profit at end-game.** The card's `value` is higher than its `cost`, so buying a house is essentially free money — but the up-front cost can hurt your cash position for a Millionaire Estates bid.
- **The spinner replaces dice.** It's a uniform 1–10. There are no doubles, no critical rolls, no re-rolls.

## Strategy Hints

- **College vs Career.** College pays more long-term but only if the game runs long enough. With a short game ahead of you, the career path's lack of loan can leave you with more cash on paddleboard squares early.
- **Buy a house when you can comfortably afford it.** The value-over-cost spread is profit. Skipping the house leaves $100,000+ of free value on the table.
- **If you're cash-rich, aim for Millionaire Estates** — the outright-win clause means a moderate lead in cash can beat opponents with higher *score* who took the safer CA path.
- **If you're a child magnet**, Countryside Acres is usually better — every kid is +$50,000, and that stacks well with life tiles.
- **Stocks pay out only when their number is hit.** A $50,000 stock is a long-tail bet — buy at most one or two and only if you have spare cash.
