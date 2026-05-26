# Connect Four

## Overview

Connect Four is a two-player game played on a vertical board with 7 columns and 6 rows. Each player has a coloured disc — Red goes first, Yellow second. Players take turns dropping discs into columns; each disc falls and stacks on top of whatever is already in that column. The first player to line up **four of their discs in a row** — horizontally, vertically, or diagonally — wins.

A typical game lasts about 5 minutes. The rules are easy to teach but the strategy is much deeper than Tic-Tac-Toe.

**Spectators welcome** — anyone logged in can watch a Connect Four game in progress from the lobby's 👁 Spectate button.

## Setup

No setup phase. As soon as the host starts the game, both players see an empty 7×6 board. Red moves first.

## How a Turn Works

On your turn:

1. Look at the seven columns. Any column that is not already full is a legal move.
2. Click the column you want to play. Your disc drops into that column and settles into the lowest empty cell.
3. The turn immediately passes to your opponent.

You cannot choose *where* in the column to drop — gravity always pulls the disc to the lowest open spot. You cannot pass; you must drop a disc every turn.

## Winning

You win as soon as four of your discs are in a continuous line. The line can run:

- **Horizontally** along one row.
- **Vertically** up a single column.
- **Diagonally** in either direction.

The instant the fourth disc completes a line, the game ends and the winning line is highlighted on the board.

If all 42 cells fill up and no line of four exists, the game is a **draw**. Draws are uncommon — most games end with a win well before the board is full.

## Useful to Know

- Once a disc is placed, you cannot move it. There are no take-backs.
- A column with six discs already in it is full; you cannot play there. The board will reject the click.
- If both players ever sit idle, the game does not auto-resolve — somebody has to make the next move.

## Strategy Hints

A few starter ideas:

- **Play the centre column early.** The centre column is part of more winning lines than any other, so controlling it gives you the most options.
- **Watch your opponent's threats before your own.** If they have three in a row with an open fourth, you must block — even if it costs you a move you wanted to make.
- **Think about what you give your opponent.** When you drop a disc, the cell directly above becomes the next move in that column. Avoid setting up a stack that lets them complete a line on top of yours.
- **Aim for forks** — positions where one of your moves creates two separate threats. Your opponent can only block one, so the other wins.

Connect Four is a solved game with perfect play (Red wins by playing the centre column first), but in practice almost no one plays perfectly, so attentive defence and patient setup go a long way.
