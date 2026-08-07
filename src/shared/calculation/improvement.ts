/**
 * "How do I raise my rating" maths.
 *
 * The game averages the 30 best old-version plays with the 20 best
 * current-version ones, so a new score only helps if it displaces the weakest
 * entry in its frame — and then only by a fiftieth of the difference.
 */

/** Total slots that feed the rating: best 30 plus new 20. */
export const RATING_SLOTS = 50;

export interface RatingFrame {
  /** Play ratings already counted, in any order. */
  ratings: number[];
  /** How many slots the frame has, whether or not they are filled. */
  slots: number;
}

export interface WhatIfResult {
  currentRating: number;
  newRating: number;
  delta: number;
  /** The play rating this score would have to beat to count at all. */
  displaces: number | null;
  counts: boolean;
}

/**
 * Effect of achieving one new play rating.
 *
 * `replacing` is the play rating of the chart's current entry, when the player
 * already has a score on it — otherwise the new play adds to the pool rather
 * than swapping with itself.
 */
export function whatIf(
  frame: RatingFrame,
  overallRating: number,
  playRating: number,
  replacing?: number,
): WhatIfResult {
  const topSlots = (ratings: number[]) =>
    [...ratings].sort((a, b) => b - a).slice(0, frame.slots);
  const sum = (ratings: number[]) =>
    ratings.reduce((total, rating) => total + rating, 0);

  const before = topSlots(frame.ratings);

  // Compare the counted set before and after rather than reasoning about which
  // entry gets displaced. Removing the chart's existing entry first matters:
  // a chart cannot occupy two slots, so without this the gain looks larger
  // than it is.
  const remaining = [...frame.ratings];

  if (replacing !== undefined) {
    const index = remaining.indexOf(replacing);

    if (index >= 0) remaining.splice(index, 1);
  }

  const after = topSlots([...remaining, playRating]);

  const delta = (sum(after) - sum(before)) / RATING_SLOTS;
  const counts = delta > 0;

  // Whatever left the counted set, if anything did.
  const leftover = [...before];
  for (const rating of after) {
    const index = leftover.indexOf(rating);

    if (index >= 0) leftover.splice(index, 1);
  }

  return {
    currentRating: overallRating,
    newRating: Math.floor((overallRating + Math.max(delta, 0)) * 100) / 100,
    delta: Math.floor(Math.max(delta, 0) * 10_000) / 10_000,
    displaces: counts
      ? (leftover[0] ?? null)
      : (before[frame.slots - 1] ?? null),
    counts,
  };
}

/**
 * The play rating a new score must reach before it affects the rating at all.
 *
 * Anything at or below this is wasted effort as far as rating is concerned.
 */
export function ratingFloor(frame: RatingFrame): number | null {
  if (frame.ratings.length < frame.slots) return null;

  return [...frame.ratings].sort((a, b) => b - a)[frame.slots - 1] ?? null;
}

/**
 * Rating gained if every slot in the frame were lifted to `target`.
 *
 * Useful for answering "what would it take to reach rating X" without
 * simulating individual charts.
 */
export function ratingIfAllSlotsReach(
  frames: RatingFrame[],
  target: number,
): number {
  let total = 0;

  for (const frame of frames) {
    const ratings = [...frame.ratings].sort((a, b) => b - a);

    for (let slot = 0; slot < frame.slots; slot += 1) {
      total += Math.max(ratings[slot] ?? 0, target);
    }
  }

  return Math.floor((total / RATING_SLOTS) * 100) / 100;
}
