/**
 * The board's contents.
 *
 * Nine cells, three rows of three. The plan's progression is 4, then 6, then
 * 9, and 9 is where row-column scanning starts to pay for the extra press it
 * costs: on the previous 2x3 board linear scanning averaged 3.5 steps against
 * row-column's 3, close enough that the second press may not have been worth
 * it. On 3x3 it is 5 against 4. So this is the first size at which the method
 * the engine implements is the right method, which is worth feeling directly.
 *
 * What grew with it, and was not adjusted, because scan timing is being tuned
 * separately against a real face: a full pass is now three row steps instead
 * of two, so the worst case time to reach the last cell is one scan interval
 * longer, and `maxLoops` 3 now buys three passes over three rows rather than
 * over two.
 *
 * The third row is appended rather than interleaved. Cell order in a real
 * board is a frequency decision (the most-used words want to be reached in the
 * fewest steps) and that is a clinical judgement made with the person using
 * it, not a guess made here.
 *
 * The emoji are placeholders standing in for real symbols. A production AAC
 * board uses a licensed symbol set (ARASAAC is the obvious one, and free), and
 * symbol choice is a clinical decision rather than a typographic one. Nothing
 * here is fetched or licensed: they are font glyphs.
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
  [
    { word: "I want", icon: "🙋" },
    { word: "hurt", icon: "🤕" },
    { word: "done", icon: "✅" },
  ],
];

export const BOARD_ROWS = BOARD.length;
export const BOARD_COLUMNS = BOARD[0].length;
