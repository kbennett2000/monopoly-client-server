# Monopoly

## Overview

Monopoly is a property-trading board game for 2–8 players. Each player rolls dice, moves around a 40-space board, buys properties, builds houses and hotels, and collects rent from opponents who land on what they own. The game ends when only one player remains solvent — everyone else has gone bankrupt.

A complete game typically runs 60–120 minutes. This implementation follows the classic ruleset with a few config defaults worth knowing — the most notable is that the **Free Parking jackpot** house rule is **off** by default. (The host can toggle several rules when creating a game.)

## Setup

Setup is automatic:

- Every player starts at GO with **$1,500**.
- Each player picks a unique colour and token from a set of 8.
- All 28 buildable spaces (22 colour-group properties, 4 railroads, 2 utilities) start owned by the bank.
- The first player is chosen and the game begins.

## How a Turn Works

A turn has three phases: **pre-roll** (before you roll the dice), **post-roll** (after you've moved), and possibly a **buying** sub-phase if you land on an unowned purchasable space.

### Pre-roll phase

Before rolling, you can:

- **Manage properties.** Mortgage, unmortgage, build houses or hotels, or sell buildings.
- **Propose trades** with other players (money, properties, jail cards).
- **Pay $50 jail fine** or **use a Get Out of Jail Free card** if you're in jail.

When ready, click **Roll Dice**.

### Rolling and moving

You roll two six-sided dice and move that many spaces clockwise around the board. A few special cases:

- **Doubles** (both dice show the same value): after resolving the space you land on, you get to roll *again*. Three doubles in a single turn sends you straight to jail without acting on the third roll.
- **Passing GO**: collect **$200** salary every time you pass or land on GO.
- **Go to Jail**: landing on the Go-to-Jail corner sends you to jail (see *Jail* below).

### Landing on a space

What happens depends on the type of space:

- **Unowned property / railroad / utility.** You can **Buy** it at the listed price, or **Decline** — in which case the property goes to **auction** (everyone, including you, bids in real time and the highest bidder wins).
- **Owned property.** Pay rent to the owner. Rent depends on the property type:
  - Colour-group properties: a base rate, doubled if the owner has the full colour group, then increasing sharply with houses and hotels.
  - Railroads: scales with how many of the 4 railroads the owner holds ($25 / $50 / $100 / $200).
  - Utilities: rent is the dice roll × 4 (one utility owned) or × 10 (both).
- **Tax space.** Income Tax (square 4) or Luxury Tax (square 38). Income Tax is $200 *or* 10% of total wealth — your choice (configurable). Luxury Tax is a flat $100.
- **Chance / Community Chest.** Draw a card and apply it (move you somewhere, pay or receive money, go to jail, etc.).
- **Jail (just visiting).** Nothing happens; you're not in jail unless you were sent there.
- **Free Parking.** Nothing happens by default. (If the host enabled the *Free Parking jackpot* house rule, all taxes paid go into a pot that lands here.)
- **Your own property.** Nothing — no self-rent.

### Post-roll phase

After your move resolves, you can manage properties or propose trades again. When you're ready, click **End Turn**.

## Buying Houses and Hotels

To build houses you must own a complete **colour group** (all the properties of one colour). House cost depends on the group; it's printed on each property's deed. Rules:

- Houses must be built **evenly across the group** — you can't have a 3-house property next to a 0-house property in the same group.
- Up to 4 houses per property, then a 5th "house" replaces the 4 with a **hotel**.
- Selling buildings is also done evenly. You get **half the building cost** back.

## Jail

You go to jail by:

- Rolling three doubles in one turn.
- Landing on the Go-to-Jail space.
- Drawing a Go-to-Jail card.

While in jail you can still manage properties and trade. To get out, on your turn you can:

- Pay the **$50 jail fine** before rolling.
- Use a **Get Out of Jail Free** card.
- Roll the dice and try for **doubles**. If doubles, you leave jail and move that distance (but don't get a bonus roll for it).

After three failed roll attempts, you **must** pay the $50 fine and then move using the last dice you rolled. Rent you owe is paid normally — being in jail doesn't pause the game for others.

## Trading

You can trade with any other solvent player at any time during your pre-roll or post-roll. Trades can include money, properties (only if they have no houses on them or on their colour-group siblings), and Get Out of Jail Free cards. Both sides must accept for the trade to go through.

## Mortgaging

Mortgaging a property gives you the listed mortgage value (half the purchase price). While mortgaged:

- You collect no rent on it.
- You can't build on it, and no property in its colour group can have houses built.
- You can't trade it cleanly with built siblings.

To unmortgage, pay the mortgage value plus a 10% interest charge.

## Bankruptcy

If you can't pay a debt — rent, tax, or building costs — you can sell buildings (half value), mortgage properties, or trade to raise funds. If still short, you can **Declare Bankruptcy**. If the debt is owed to another player, all your remaining cash and unmortgaged properties go to them; mortgaged properties also transfer (the new owner can choose to pay 10% to keep the mortgage or 10% + the mortgage value to lift it). If the debt was owed to the bank, all your properties go up for **auction** to the remaining players.

## Winning

The game ends when only one solvent player remains. That player wins. There is no time limit — the game runs until all-but-one player goes bankrupt.

## Useful to Know

- **The Free Parking jackpot is off by default.** Many players grew up with the house rule that all taxes go into a pot that the next player to land on Free Parking collects. This implementation has that *configurable*, but the default is the official rule: nothing happens on Free Parking.
- **Auctions are on by default.** Declining to buy a property sends it to auction at minimum $1 bid. You can deliberately decline expensive properties to bid for them at a discount.
- **Income Tax has a choice.** You can pay $200 flat or 10% of your total wealth (including property values and cash). The 10% option helps cash-rich, asset-light players; the flat $200 helps asset-rich players.
- **Properties can be mortgaged in any phase**, including in the middle of a payment crisis. Sell buildings first (half value) before mortgaging, because mortgaged properties stop you from building anywhere in the group.

## Strategy Hints

- **Buy everything you can afford early.** Owning is almost always better than not owning, even at a stretch.
- **Orange and red properties are the most-landed squares** because they're a short distance after Jail. Push hard for the orange or red group.
- **Houses scale rent dramatically; the third house is the biggest jump on most properties.** Build to 3 houses on your monopoly before building a fourth or a hotel.
- **Cash reserves matter.** Mid-game, lone players holding all-houses with $50 cash are one bad roll from bankruptcy.
