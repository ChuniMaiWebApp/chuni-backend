/**
 * CHUNITHM play rating.
 *
 * Play rating is a function of two things the game defines: the chart constant
 * and the score. Written here from the rating curve the game itself exhibits,
 * expressed as the breakpoints and anchors that curve is made of.
 *
 * Arithmetic runs in units of 1e-4 ("ten-thousandths of a rating point")
 * because that is the resolution the curve is defined at — above S rank every
 * segment has an exact integer slope in those units, so the whole high range
 * is computed without a single rounding decision. The game then truncates to
 * two decimals for display, which `calculateRating` does last.
 *
 * Truncation is deliberate everywhere it appears, not sloppiness: the cabinet
 * floors, it does not round, and a value that rounds up by 0.01 is a wrong
 * answer a player will notice on their own profile.
 */

/** Score at which the curve stops rewarding accuracy. */
const RATING_CAP_SCORE = 1_009_000;

/** Bonus over the chart constant at the cap, in 1e-4 units. */
const RATING_CAP_BONUS = 21_500;

/** Score at which play rating first equals the chart constant exactly. */
const S_RANK_SCORE = 975_000;

/**
 * Below S rank the curve is anchored to a constant this much lower — the
 * "sub-S" floor, in 1e-4 units.
 */
const SUB_S_DROP = 50_000;

/** Score below which a play is worth no rating at all. */
const ZERO_SCORE = 500_000;

/**
 * Segments at or above S rank, highest first.
 *
 * `bonus` is the bonus over the chart constant at `from`; `slope` is how many
 * 1e-4 units that bonus gains per point of score above `from`. Each segment
 * ends exactly where the next begins, which is what makes the curve continuous
 * — worth checking whenever SEGA revises it.
 */
const HIGH_SEGMENTS: ReadonlyArray<{
  from: number;
  bonus: number;
  slope: number;
}> = [
  { from: RATING_CAP_SCORE, bonus: RATING_CAP_BONUS, slope: 0 },
  { from: 1_007_500, bonus: 20_000, slope: 1 },
  { from: 1_005_000, bonus: 15_000, slope: 2 },
  { from: 1_000_000, bonus: 10_000, slope: 1 },
  { from: S_RANK_SCORE, bonus: 0, slope: 0.4 },
];

/**
 * Play rating in units of 1e-4, before the game truncates it for display.
 *
 * @param score in-game score, 0..1_010_000
 * @param internalLevel chart constant, e.g. 15.6
 */
export function calculateWholeRating(
  score: number,
  internalLevel: number | null,
): number {
  const constant = Math.trunc((internalLevel ?? 0) * 10000);

  for (const segment of HIGH_SEGMENTS) {
    if (score >= segment.from) {
      const bonus = segment.bonus + (score - segment.from) * segment.slope;

      return Math.trunc(constant + bonus);
    }
  }

  return Math.trunc(belowSRank(score, constant));
}

/**
 * The sub-S curve, in 1e-4 units.
 *
 * Four anchors joined by straight lines. Stating them as points rather than as
 * three separate slope formulas keeps the one property that matters visible:
 * the segments meet, so a score one point either side of an anchor does not
 * jump.
 */
function belowSRank(score: number, constant: number): number {
  if (score < ZERO_SCORE) return 0;

  const subS = Math.max(constant - SUB_S_DROP, 0);

  const anchors: ReadonlyArray<[score: number, rating: number]> = [
    [ZERO_SCORE, 0],
    [800_000, subS / 2],
    [900_000, subS],
    [S_RANK_SCORE, constant],
  ];

  for (let index = anchors.length - 1; index > 0; index -= 1) {
    const [upperScore, upperRating] = anchors[index];
    const [lowerScore, lowerRating] = anchors[index - 1];

    if (score >= lowerScore) {
      const progress = (score - lowerScore) / (upperScore - lowerScore);

      return lowerRating + progress * (upperRating - lowerRating);
    }
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
 * nearest achievable score.
 *
 * The inverse of the curve above, segment for segment. Scores move in steps of
 * 50 at most note densities, so a target that lands between two attainable
 * scores is reported as the next one a player could actually hit.
 *
 * Returns `null` when the rating is unreachable on that chart — above the cap,
 * no score gets there.
 */
export function calculateScoreForRating(
  targetRating: number,
  internalLevel: number,
): number | null {
  const target = Math.round(targetRating * 10000);

  if (target === 0) return 0;

  const constant = Math.round(internalLevel * 10000);
  const bonus = target - constant;

  const score =
    bonus >= 0 ? scoreForBonus(bonus) : scoreBelowSRank(target, constant);

  if (score === null) return null;

  return Math.round(Math.trunc(score) / 50) * 50;
}

/** Inverts the at-or-above-S segments. `null` past the cap. */
function scoreForBonus(bonus: number): number | null {
  if (bonus > RATING_CAP_BONUS) return null;

  for (const segment of HIGH_SEGMENTS) {
    if (bonus >= segment.bonus) {
      // The capped segment is flat: any score at or above it reaches the cap,
      // and the cheapest such score is where it starts.
      if (segment.slope === 0) return segment.from;

      return segment.from + (bonus - segment.bonus) / segment.slope;
    }
  }

  return S_RANK_SCORE;
}

/**
 * Inverts the sub-S anchors, mirroring `belowSRank` segment for segment.
 *
 * Reads top down, so the first segment whose floor the target clears is the
 * one it lands in — the same order the forward function walks, which is what
 * keeps the two from drifting apart.
 */
function scoreBelowSRank(target: number, constant: number): number | null {
  if (target < 0) return null;

  // Nothing to invert on a chart with no constant: every score is worth zero,
  // so no positive target is reachable and zero is reached at the floor.
  if (constant <= 0) return target === 0 ? ZERO_SCORE : null;

  const subS = Math.max(constant - SUB_S_DROP, 0);

  // Between 900k and S rank, climbing from the sub-S floor to the constant.
  if (target >= subS) {
    return 900_000 + ((target - subS) / (constant - subS)) * 75_000;
  }

  // Below here subS is necessarily positive: a zero subS is fully covered by
  // the branch above, since every target is then >= 0 === subS.
  if (target >= subS / 2) {
    return 800_000 + ((target - subS / 2) / (subS / 2)) * 100_000;
  }

  return ZERO_SCORE + (target / (subS / 2)) * 300_000;
}
