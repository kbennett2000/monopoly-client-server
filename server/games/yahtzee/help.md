# Yahtzee

## Overview

Yahtzee is a dice game for 1–8 players. Each player rolls five dice and tries to score them into one of 13 categories. The game lasts exactly 13 rounds, so every player ends up scoring once in each category. After the final round, the player with the highest total score wins.

A full game takes around 15–25 minutes. The rules are simple but the choices each turn — *which dice to keep, which category to lock in* — are surprisingly rich.

## How a Turn Works

On your turn you get **up to three rolls** of all five dice, with the chance to keep some and reroll the rest in between.

1. **First roll.** All five dice are rolled.
2. **Keep or reroll.** Click a die to "hold" it. Unheld dice will be re-rolled when you click Roll. You can hold and release any dice between rolls — no commitments stick until you score.
3. **Second roll.** Unheld dice roll again.
4. **Keep or reroll.** Same as before.
5. **Third roll.** Unheld dice roll one last time.
6. **Score.** Pick one of the 13 categories that you haven't filled yet. Your current dice are scored into that category, even if the score is zero.

You don't have to use all three rolls. If your first or second roll is good enough, you can score immediately and end your turn.

Every turn must end with scoring something. If your dice don't match any unfilled category well, you'll need to **zero out** a category — pick one you can't fill and lock it in for 0 points. Choosing which category to sacrifice is a real part of the game.

## The Scoring Categories

There are 13 categories, split into an **upper section** (six) and a **lower section** (seven).

### Upper section

Score the sum of the dice showing that face. Other faces are ignored.

| Category | What scores                     |
|----------|---------------------------------|
| Ones     | Sum of dice showing 1           |
| Twos     | Sum of dice showing 2           |
| Threes   | Sum of dice showing 3           |
| Fours    | Sum of dice showing 4           |
| Fives    | Sum of dice showing 5           |
| Sixes    | Sum of dice showing 6           |

If the total of the upper section is **63 or more**, you earn a **+35 bonus**. 63 is what you would get by rolling exactly three of each face — so the bonus rewards consistent upper-section scoring without needing every category to be perfect.

### Lower section

Each lower category has a specific requirement.

| Category        | Requirement                  | Score                            |
|-----------------|------------------------------|----------------------------------|
| Three of a Kind | At least three dice the same | Sum of *all five* dice           |
| Four of a Kind  | At least four dice the same  | Sum of *all five* dice           |
| Full House      | Three of one + two of another| 25 points (flat)                 |
| Small Straight  | Four consecutive faces       | 30 points (flat)                 |
| Large Straight  | Five consecutive faces       | 40 points (flat)                 |
| Yahtzee         | All five dice the same       | 50 points (flat)                 |
| Chance          | Anything                     | Sum of all five dice             |

If your dice don't meet the requirement, the category scores **0**. For example, scoring "no straight" dice into Large Straight gives 0; the category is then used up.

## Winning

The game ends when every player has scored all 13 categories. Final score is:

- Upper section subtotal
- + the +35 bonus (if upper section ≥ 63)
- + lower section total

The highest total wins.

## Useful to Know

- **Five of a kind does not count as a Full House** in this implementation. Five matching dice scored as Full House gives 0. (Score it as Yahtzee instead.)
- **No Yahtzee bonus.** In the classic boxed version, rolling additional Yahtzees after your first earns +100 each. This version deliberately does *not* implement that bonus — a second Yahtzee scored after the Yahtzee category is filled scores normally (or zero, depending on the category you put it in).
- **Chance is the safety net** — it accepts any roll. Save it for a turn where everything else would zero out.
- **A "joker"-style override is not implemented either.** If your Yahtzee category is filled and you roll a Yahtzee again, you cannot use it to fill the matching upper category at full value; it scores like normal dice.

## Strategy Hints

- **Fill the upper section early.** Going for the +35 bonus is one of the easiest score boosts in the game, but only if you commit to it before all your big upper rolls have been spent.
- **Save Chance and the high upper categories (Fours, Fives, Sixes) for emergencies.** A bad-looking roll has somewhere to go if you still have these open.
- **Don't zero out Yahtzee too early.** If you're going to take a zero, pick a category you definitely can't fill — Yahtzee has a chance to drop into your lap on any turn.
- **Small Straight is easier to score than it looks** — 1-2-3-4, 2-3-4-5, or 3-4-5-6 with two rerolls is very common.
