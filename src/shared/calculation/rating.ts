/**
 * CHUNITHM play rating.
 *
 * Ported from chuni-penguin (0BSD). The Python original does its arithmetic on
 * IEEE-754 doubles and truncates with `int()`, so the port keeps `Math.trunc`
 * on doubles rather than "cleaning up" the maths — the truncation is
 * load-bearing and matches what the game shows.
 */

/**
 * Play rating in units of 1e-4, before the game truncates it to two decimals.
 *
 * @param score in-game score, 0..1_010_000
 * @param internalLevel chart constant, e.g. 15.6
 */
export function calculateWholeRating(
  score: number,
  internalLevel: number | null,
): number {
  const il10000 = Math.trunc((internalLevel ?? 0) * 10000);

  if (score >= 1_009_000) return il10000 + 21_500;
  if (score >= 1_007_500) return il10000 + 20_000 + (score - 1_007_500);
  if (score >= 1_005_000) return il10000 + 15_000 + (score - 1_005_000) * 2;
  if (score >= 1_000_000) return il10000 + 10_000 + (score - 1_000_000);
  if (score >= 975_000) {
    return Math.trunc(il10000 + ((score - 975_000) * 2) / 5);
  }

  // Below S rank the curve is anchored to a "sub-S" constant 5.0 lower.
  const subS = Math.max(il10000 - 50_000, 0);

  if (score >= 900_000) {
    return Math.trunc(subS + ((score - 900_000) / 75_000) * (il10000 - subS));
  }
  if (score >= 800_000) {
    return Math.trunc(subS / 2 + ((score - 800_000) / 100_000) * (subS / 2));
  }
  if (score >= 500_000) {
    return Math.trunc(((score - 500_000) / 300_000) * (subS / 2));
  }

  return 0;
}

/** Play rating truncated to two decimals, the way the game displays it. */
export function calculateRating(
  score: number,
  internalLevel: number | null,
): number {
  return Math.floor(calculateWholeRating(score, internalLevel) / 100) / 100;
}

/**
 * Lowest score that reaches `targetRating` on a chart, rounded up to the
 * nearest achievable score (scores move in steps of 50 at most densities).
 *
 * Returns `null` when the rating is unreachable on that chart.
 */
export function calculateScoreForRating(
  targetRating: number,
  internalLevel: number,
): number | null {
  const rating10000 = Math.round(targetRating * 10000);

  if (rating10000 === 0) return 0;

  const il10000 = Math.round(internalLevel * 10000);
  const subS = Math.max(il10000 - 50_000, 0);
  const coeff = rating10000 - il10000;

  let required: number | null = null;

  if (coeff > 21_500) required = null;
  else if (coeff >= 20_000) required = 1_007_500 + coeff - 20_000;
  else if (coeff >= 15_000) required = 1_005_000 + (coeff - 15_000) / 2;
  else if (coeff >= 10_000) required = 1_000_000 + (coeff - 10_000);
  else if (coeff >= 0) required = 975_000 + (coeff * 5) / 2;
  else if (rating10000 >= subS) {
    required = ((rating10000 - subS) / (il10000 - subS)) * 75_000 + 900_000;
  } else if (rating10000 >= subS / 2) {
    required = ((rating10000 * 2) / subS - 1) * 100_000 + 800_000;
  } else if (rating10000 >= 0) {
    required = ((rating10000 * 2) / subS) * 300_000 + 500_000;
  }

  if (required === null) return null;

  return Math.round(Math.trunc(required) / 50) * 50;
}
