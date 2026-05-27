# Checkers

## Overview

Checkers is a two-player abstract strategy game played on an 8x8 board. One player is **Red**, the other is **Black**. Red moves first. The goal is to capture all of your opponent's pieces or leave them with no legal moves.

A typical game lasts about 15 minutes. The rules are American Checkers (also called English Draughts) — simpler than International Draughts, with no flying kings or backwards captures for regular pieces.

**Spectators welcome** — anyone logged in can watch a Checkers game in progress from the lobby's 👁 Spectate button. Checkers is a perfect-information game, so spectators see everything the players see.

## Setup

No setup phase. As soon as both players join and the host starts the game, a standard 8x8 board appears with 12 pieces per side. Pieces occupy only the dark squares: Black's 12 pieces fill the first three rows at the top, Red's 12 fill the last three rows at the bottom. The first player to join plays Red and moves first.

## How a Turn Works

On your turn:

1. Look at the board. Your pieces that have legal moves are highlighted with a subtle glow.
2. Click one of your highlighted pieces to select it. Valid destination squares light up with markers.
3. Click a destination to move. The turn passes to your opponent (unless a chain capture is available — see below).

You can click the selected piece again to deselect it, or click a different eligible piece to switch your selection.

## Movement Rules

- **Regular pieces** move diagonally forward only, one square at a time, onto empty dark squares.
- **Kings** move diagonally forward **and** backward, one square at a time. Kings do not "fly" across multiple squares — this is American Checkers, not International Draughts.
- **Captures** are diagonal jumps: leap over an adjacent opponent's piece to an empty square beyond it. The jumped piece is removed from the board.

## The Capture Rule

Captures are mandatory. If you can capture, you must.

- If any of your pieces can make a capture, you are not allowed to make a non-capturing move. The board highlights only the pieces that can capture, and a banner reminds you.
- **Chain captures**: after a capture, if your piece can immediately capture again from its new position, you must continue jumping. The chain keeps going until no more captures are available. During a chain, you cannot switch to a different piece — you must keep jumping with the same one.
- **You do not have to take the longest chain.** If multiple captures are available, any one satisfies the requirement. But once you start a chain, you must follow it through.
- **Coronation ends a chain.** If your piece reaches the back row mid-chain, it is crowned and the chain ends — even if more captures would be available as a king.

## King Coronation

When a regular piece reaches the opposite back row (row 0 for Red, row 7 for Black), it is promoted to a king. A crown appears on the piece. Kings are significantly more powerful because they can move and capture in all four diagonal directions.

Coronation happens at the end of the move. If a piece reaches the back row by capturing, the chain ends and the piece is crowned immediately.

## Winning

Two ways to win:

- **Capture all of your opponent's pieces.** The most common outcome.
- **Leave your opponent with no legal moves.** If it is their turn and none of their pieces can move (they are all blocked), they lose. Stalemate is a loss, not a draw.

There is no draw rule in this implementation — no 40-move rule, no threefold repetition, no agreed draws. Every game ends in a win or a loss.

## Useful to Know

- The first player to join the game is Red and moves first.
- A regular piece can capture a king. Being a king does not make a piece immune to capture.
- Kings move one square at a time, just like regular pieces. The only difference is that kings can move backward.
- The board locks once the game ends. Return to the lobby to start a new game.

## Strategy Hints

- **Control the centre.** Pieces in the middle of the board have more move options than pieces on the edges.
- **Don't rush to the back row.** Advancing all your pieces early leaves gaps behind them. Kings are powerful, but keeping a solid formation matters more in the early game.
- **Use the forced-capture rule.** Sometimes "offering" a piece — deliberately placing it where the opponent must capture — sets up a multi-jump reply that wins more pieces than it costs.
- **Kings are worth the investment.** A single king behind enemy lines can dominate the endgame. Prioritise crowning when the opportunity is safe.
- **Watch the edges.** Pieces on the side of the board cannot be jumped from that direction, making them safer but less mobile.
