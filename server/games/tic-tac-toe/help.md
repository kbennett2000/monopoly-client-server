# Tic-Tac-Toe

## Overview

Tic-Tac-Toe is a two-player game played on a 3×3 grid. One player is **X**, the other is **O**. Players take turns placing their mark in an empty cell. The first player to line up three of their marks in a row, column, or diagonal wins. If every cell is filled and no one has three in a row, the game ends in a draw.

A complete game usually takes less than a minute. It is one of the simplest games on the platform and a good first pick if you are showing a new player how the framework works.

## Setup

There is no setup. As soon as both players join and the host starts the game, an empty 3×3 board appears. The first player is assigned **X** and moves first; the second player gets **O**.

## How a Turn Works

On your turn:

1. Look at the board for empty cells.
2. Click any empty cell to drop your mark there.
3. The turn passes immediately to your opponent.

You cannot place a mark in a cell that already has one. You cannot pass — every turn must place a mark.

## Winning

You win as soon as you have three of your marks in any straight line:

- Any of the three horizontal rows.
- Any of the three vertical columns.
- Either of the two diagonals.

The game ends the moment a winning line is formed. If all nine cells fill up without anyone forming a line, the result is a **draw**.

## Useful to Know

- The board is locked once the game ends. You will need to return to the lobby and start a new game to play again.
- There is no time limit on individual turns by default. Take as long as you like.
- The first move is the strongest — the centre cell gives the most winning lines (four pass through it).

## Strategy Hints

With perfect play, Tic-Tac-Toe always ends in a draw. A few practical pointers if you want to never lose:

- **Take the centre** if you move first.
- **Always block** an opponent who has two in a row, before you do anything else.
- Look for **forks** — a single move that creates two threats at once. Your opponent can only block one of them.

Once you and your opponent both know these patterns, every game ends in a draw and you should pick a more complex game.
