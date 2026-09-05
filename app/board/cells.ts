/**
 * The board's contents.
 *
 * Six cells, two rows of three. Six because the plan's progression is 4, then
 * 6, then 9, and because row-column scanning only earns its second press once
 * a board is big enough for the row pass to save steps: on a 2x3 grid, linear
 * scanning averages 3.5 steps and row-column averages 3, which is close enough
 * that the extra press may not be worth it. That crossover is worth feeling
 * before the board grows.
 *
 * The emoji are placeholders standing in for real symbols. A production AAC
 * board uses a licensed symbol set (ARASAAC is the obvious one, and free), and
 * symbol choice is a clinical decision rather than a typographic one.
 */

export interface BoardCell {
  /** What gets spoken. */
  word: string;
  /** Placeholder icon. */
  icon: string;
}

/** Row-major. Indexed as BOARD[rowIndex][columnIndex]. */
export const BOARD: readonly (readonly BoardCell[])[] = [
  [
    { word: "yes", icon: "👍" },
    { word: "no", icon: "👎" },
    { word: "more", icon: "➕" },
  ],
  [
    { word: "help", icon: "🆘" },
    { word: "stop", icon: "✋" },
    { word: "thank you", icon: "🙏" },
  ],
];

export const BOARD_ROWS = BOARD.length;
export const BOARD_COLUMNS = BOARD[0].length;
