import { Rank, type Judgements } from '../chunithm-net/chunithm-net.types';

/**
 * Score borders: how many JUSTICE / ATTACK / MISS a chart can absorb and still
 * reach a given rank.
 *
 * A JUSTICE is worth 100/101 of a JUSTICE CRITICAL, so the score lost per
 * JUSTICE simplifies to `10000 / notecount`. Everything below is derived from
 * that, in units of "justices worth of tolerance".
 */

const ONE_ATTACK_IN_JUSTICE = 51;
const ONE_MISS_IN_JUSTICE = 101;
const ONE_MISS_IN_ATTACK = 2;

export type BorderKey = '99AJ' | Rank;

export interface Border extends Judgements {
  /** Lowest score that still counts as this rank. */
  minScore: number;
}

/**
 * A pure "all justices" border reads as 444-0-0, which nobody actually plays.
 * These ratios convert part of the tolerance into the odd ATTACK and MISS so
 * the numbers resemble a realistic run, matching what the Discord bot shows.
 */
const RATIOS: Array<{
  key: BorderKey;
  tolerance: (notes: number) => number;
  missDivisor: number | null;
  attackDivisor: number;
  minScore: number;
}> = [
  {
    key: Rank.SSSP,
    tolerance: (notes) => Math.floor(notes / 10),
    missDivisor: null,
    attackDivisor: 60,
    minScore: 1_009_000,
  },
  {
    key: Rank.SSS,
    tolerance: (notes) => Math.floor(notes / 4),
    missDivisor: null,
    attackDivisor: 59,
    minScore: 1_007_500,
  },
  {
    key: Rank.SSP,
    tolerance: (notes) => Math.floor(notes / 2),
    missDivisor: 300,
    attackDivisor: 58,
    minScore: 1_005_000,
  },
  {
    key: Rank.SS,
    tolerance: (notes) => notes,
    missDivisor: 275,
    attackDivisor: 56,
    minScore: 1_000_000,
  },
  {
    key: Rank.SP,
    tolerance: (notes) => notes * 2,
    missDivisor: 250,
    attackDivisor: 54,
    minScore: 990_000,
  },
  {
    key: Rank.S,
    tolerance: (notes) => Math.floor(notes * 3.5),
    missDivisor: 200,
    attackDivisor: 53,
    minScore: 975_000,
  },
];

export function calculateBorders(
  notecount: number,
): Array<Border & { key: BorderKey }> {
  if (notecount <= 0) return [];

  // 1,009,900+ with an ALL JUSTICE, the informal "99AJ" milestone.
  const tolerance99aj = Math.floor(notecount / 100);
  const borders: Array<Border & { key: BorderKey }> = [
    {
      key: '99AJ',
      justiceCritical: notecount - tolerance99aj,
      justice: tolerance99aj,
      attack: 0,
      miss: 0,
      minScore: 1_009_900,
    },
  ];

  for (const ratio of RATIOS) {
    const tolerance = ratio.tolerance(notecount);
    const miss =
      ratio.missDivisor === null
        ? 0
        : Math.floor(tolerance / ratio.missDivisor);
    const attack =
      Math.floor(tolerance / ratio.attackDivisor) - miss * ONE_MISS_IN_ATTACK;
    const justice =
      tolerance - attack * ONE_ATTACK_IN_JUSTICE - miss * ONE_MISS_IN_JUSTICE;

    borders.push({
      key: ratio.key,
      justiceCritical: notecount - justice - attack - miss,
      justice,
      attack,
      miss,
      minScore: ratio.minScore,
    });
  }

  return borders;
}

/** How much score each imperfect judgement costs on a chart, to two decimals. */
export function calculateScoreDeduction(notecount: number): {
  justice: number;
  attack: number;
  miss: number;
} {
  if (notecount <= 0) return { justice: 0, attack: 0, miss: 0 };

  const per = (units: number) => Math.floor((units * 100) / notecount) / 100;

  return {
    justice: per(10_000),
    attack: per(510_000),
    miss: per(1_010_000),
  };
}

export type AnmitsuVerdict = 'ideal' | 'risky' | 'no';

export interface AnmitsuResult {
  /** Time between the two notes, in milliseconds. */
  distanceMs: number;
  /** How long both notes sit inside the JUSTICE CRITICAL window together. */
  criticalOverlapMs: number;
  /** Same, for the wider JUSTICE window. */
  justiceOverlapMs: number;
  /** Rubbing the ground slider through two notes in the same lane. */
  rub: AnmitsuVerdict;
  /** Tapping two notes in different lanes as one, the "anmitsu" technique. */
  anmitsu: AnmitsuVerdict;
}

/**
 * Whether two consecutive notes are close enough to be hit as one.
 *
 * Windows are ±33.333 ms for JUSTICE CRITICAL and ±66.667 ms for JUSTICE, so
 * two notes overlap for `66.667 - distance` and `133.333 - distance`
 * respectively. Anmitsu is only considered comfortable once that overlap
 * exceeds ~16.7 ms, which is the threshold the Discord bot uses.
 *
 * Computed in thousandths of a millisecond to keep the rounding identical.
 */
export function calculateAnmitsu(
  bpm: number,
  noteDensity: number,
): AnmitsuResult {
  // A measure is four beats, so 240000/bpm ms, split by the beat divisor.
  const distance = Math.trunc((240_000 * 1000) / bpm / noteDensity);
  const criticalOverlap = Math.max(66_667 - distance, 0);
  const justiceOverlap = Math.max(133_333 - distance, 0);

  const COMFORTABLE = 16_667;
  const toMs = (value: number) => Math.floor(value / 100) / 10;

  return {
    distanceMs: toMs(distance),
    criticalOverlapMs: toMs(criticalOverlap),
    justiceOverlapMs: toMs(justiceOverlap),
    rub: criticalOverlap > 0 ? 'ideal' : justiceOverlap > 0 ? 'risky' : 'no',
    anmitsu:
      criticalOverlap > COMFORTABLE
        ? 'ideal'
        : justiceOverlap > COMFORTABLE
          ? 'risky'
          : 'no',
  };
}
