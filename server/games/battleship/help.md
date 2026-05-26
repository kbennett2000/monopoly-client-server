# Battleship

## Overview

Battleship is a two-player game of hidden ship placement and shot-by-shot deduction. Each player has a 10×10 grid and a fleet of five ships. You secretly place your ships, then take turns firing shots at your opponent's grid. The first player to sink the entire enemy fleet wins.

A complete game takes roughly 10–20 minutes. The game has two distinct phases: a **setup** phase where both players place ships in secret, and a **firing** phase where they take turns shooting.

**Spectators welcome** — anyone logged in can watch a Battleship game in progress from the lobby's 👁 Spectate button. Note that spectators see *both* fleets' positions (the suspense is for the players, not the audience).

## Setup — Placing Your Fleet

Each player places five ships on their own 10×10 grid:

| Ship       | Length |
|------------|--------|
| Carrier    | 5      |
| Battleship | 4      |
| Cruiser    | 3      |
| Submarine  | 3      |
| Destroyer  | 2      |

Rules for placement:

- Each ship must be placed in a straight horizontal or vertical line. No diagonals or bends.
- Ships must fit entirely on the grid.
- Ships cannot overlap each other.
- Ships are allowed to be adjacent (touch sides or corners).

You can place ships in any order. Once you've placed all five, lock in your fleet to signal you're ready. The game starts as soon as both players have locked in.

Your fleet stays hidden from your opponent for the entire game. They'll only learn where your ships are by hitting them during the firing phase.

## Firing — Taking Shots

Once both players are ready, one player is chosen at random to fire first.

On your turn:

1. Click any unrevealed cell on your opponent's grid.
2. The result is announced immediately:
   - **Miss** — no ship was at that cell. The cell is marked with a miss.
   - **Hit** — your shot landed on one of their ships. The cell is marked with a hit, but you are not told which ship.
   - **Sunk** — your shot was the final hit on a ship. You are told *which* ship you sank ("You sank their Cruiser!"), revealing that ship's length.
3. The turn passes to your opponent regardless of whether you hit or missed.

You can also see all your opponent's shots on your own grid in real time, so you always know which cells they've already targeted.

## Winning

A player loses when **every cell of every ship in their fleet has been hit**. The total fleet has 17 cells (5 + 4 + 3 + 3 + 2), so it takes at least 17 perfect hits to finish a game.

When the last cell of the last ship is hit, the game ends and the firing player wins.

## Useful to Know

- **One shot per turn, hit or miss.** This implementation does not have the "extra turn on hit" house rule. Every shot ends your turn.
- **No salvo mode.** Each player fires exactly one shot per turn regardless of how many ships they have left.
- **You don't know which ship you hit** until you sink it. A single Hit could be on any of the five ships, and the only way to learn is to find every cell.
- **The first-fire choice is random** — neither player picks who goes first.
- **Your fleet is filtered out of the game state sent to the other player**, so even with developer tools you cannot snoop on their ship positions before they are hit. This is enforced server-side.

## Strategy Hints

- **Hunt mode versus target mode.** When you don't have any open hits to follow up, spread your shots out on a checkerboard pattern. Because the smallest ship is length 2, you can skip every other cell during hunt mode and still guarantee that every ship has at least one cell that a checkerboard pattern hits.
- **When you score a hit, work outward immediately.** Try the four adjacent cells (up, down, left, right). Once a second hit confirms the ship's orientation, fire along that line until you sink it.
- **Don't place ships in the corners.** A common pattern, especially against newer players, is to start hunting from the centre — corners are statistically safer, but only slightly. Better to place ships unpredictably than to follow any pattern.
- **Watch the kill list.** Once your opponent sinks one of your ships, they know its length. Use that information yourself: the moment one of *their* ships sinks, you can rule out cells that couldn't fit the remaining ships.
