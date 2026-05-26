# Risk

## Overview

Risk is a turn-based war game for 2–6 players played on a world map of 42 territories grouped into 6 continents. Each player commands an army, conquers territories, and tries to eliminate everyone else. The winner is the last player still holding any territory.

A full game takes 45–90 minutes depending on player count and aggression. Risk is the most complex game on the platform — there are three distinct phases per turn, dice combat, continent bonuses, and a card system that drives big swings.

## Setup

Setup is handled automatically:

- Every territory is assigned a random starting owner so that all 42 territories are claimed before the first turn.
- Each player gets a pool of starting armies based on the player count:

| Players | Starting armies |
|---------|-----------------|
| 2       | 40              |
| 3       | 35              |
| 4       | 30              |
| 5       | 25              |
| 6       | 20              |

- Those armies are distributed evenly across each player's territories. You don't manually place them at the start; the game does it.

The player who moves first is chosen and the game begins with that player's reinforce phase.

## How a Turn Works

Each turn has three phases, in order: **Reinforce**, **Attack**, **Fortify**. You don't have to attack or fortify if you don't want to — but you always reinforce.

### 1. Reinforce phase

At the start of your turn you get a fresh pool of armies to place. The size of the pool is:

- **max(3, territoriesOwned ÷ 3)** — rounded down. So 9 territories gives 3, 12 gives 4, 24 gives 8, and so on. Three is the minimum no matter how few territories you have.
- **+ continent bonuses** — for each entire continent you currently own, add its bonus:

| Continent     | Bonus |
|---------------|-------|
| North America | 5     |
| South America | 2     |
| Europe        | 5     |
| Africa        | 3     |
| Asia          | 7     |
| Australia     | 2     |

Click any of your territories to place reinforcements there. You can split them across as many of your territories as you like, in any combination. You must place every reinforcement before advancing to the attack phase.

**Trading cards.** If you hold at least three cards that form a valid set (see *Cards* below), you can trade them in during the reinforce phase for extra armies. Each set traded gives a growing bonus: the first set is +4, then +6, +8, +10, +12, +15, and every set after that adds 5 more (+20, +25, …). If you hold 5 or more cards at the start of your turn, you **must** trade a set.

### 2. Attack phase

You can attack any opposing territory that is adjacent to one of your own, as long as the attacking territory has at least 2 armies (you must keep one army at home).

Each attack is a single dice exchange:

- **Attacker** rolls 1, 2, or 3 dice (one less than the attacking territory's army count, up to 3). You pick how many to roll within that limit.
- **Defender** rolls 1 or 2 dice automatically (one or two, whichever is the higher legal number for the defending territory).
- Dice are sorted high-to-low. The attacker's highest die is compared to the defender's highest die; second-highest to second-highest. The **higher die wins**, **ties go to the defender**.
- Each die comparison kills one army on the losing side.

Repeat as many attacks as you like, including multiple attacks from the same territory, against the same target. There is no per-turn attack cap.

**Conquering.** If the defending territory's army count drops to zero, you take it over. You must immediately move at least one army from the attacking territory into the conquered one (up to all-but-one).

**Earning a card.** If you conquer at least one territory during your turn, you draw one Risk card at the end of the turn — regardless of how many territories you take. The cap is one card per turn no matter what.

When you're done attacking, advance to fortify.

### 3. Fortify phase

You may make **one** fortify move per turn. A fortify move:

- Picks two of your own territories that are connected to each other through a chain of your territories (you can fortify across the map, not just to neighbours).
- Moves any number of armies from one to the other, leaving at least one behind.

Fortify is optional. Skipping it ends your turn.

## Cards

Each Risk card is tied to a territory and shows one of three troop symbols: **Infantry**, **Cavalry**, or **Artillery**. A few cards are **wilds** that count as any symbol.

You earn a card by conquering at least one territory in a turn. You can hold cards across many turns. To trade in a set, you need exactly **three cards** that form one of:

- Three cards of the **same** symbol (three infantry, three cavalry, or three artillery).
- One card of **each** of the three symbols.
- **Two cards plus a wild** — the wild fills the third slot.

The trade-in bonus grows with how many sets have already been traded globally (across all players), following the +4, +6, +8, +10, +12, +15, +20, +25 … progression. The next bonus is shown in your hand panel.

If you trade in a card whose territory you still own, you also get a small bonus of armies placed directly on that territory.

If you hold 5+ cards at the start of your turn, you are forced to trade a set during reinforcement.

## Winning

The win condition is **world domination**: hold every territory on the map. In practice this happens by eliminating the other players one by one — when a player loses their last territory they're knocked out of the game.

If you knock a player out of the game and they had cards, those cards go to you. If receiving them puts you over the 5-card limit, you must trade sets down to four or fewer immediately (you may keep trading multiple sets in a single turn if that's what it takes).

## Useful to Know

- **Ties go to the defender.** This makes "defender + 2 dice vs. attacker + 3 dice" closer to even than you might expect.
- **The defender always rolls automatically with as many dice as the territory allows.** You cannot underroll defensive dice.
- **Continents are stronger than territory count for income.** A single complete continent (say Australia for +2) effectively doubles your reinforcement floor.
- **Fortifying once per turn means you can't relay armies across multiple chains in one turn** — pick your move carefully.
- **Eliminating a player is the most card-rich event** in the game; an opponent on the edge of being knocked out is a high-value target.

## Strategy Hints

- **Get a continent early.** Australia, with only one entry point (Siam), is the classic first-game pick. South America (only two entry points) is a close second.
- **Don't overextend.** A line of armies one-deep is brittle; pile armies on continent borders, not spread thin across the interior.
- **Watch when other players will trade.** If someone is holding four cards, your turn before theirs is a good time to attack — they may be forced to trade in cards that turn but you've blocked the territories where they would deploy them.
- **Tempo matters more than aggression.** Sitting out attacks for a turn to consolidate is sometimes correct, especially right before the trade-in bonus jumps.
