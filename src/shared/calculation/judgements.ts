import type { Judgements } from '../chunithm-net/chunithm-net.types';

/**
 * How much score each imperfect judgement actually cost on a play.
 *
 * A CHUNITHM chart is worth 1,010,000: 1,000,000 spread over the notes plus a
 * 10,000 JUSTICE CRITICAL bonus, also spread over the notes. So relative to a
 * perfect play one note costs 10,000/notes as a JUSTICE, 510,000/notes as an
 * ATTACK, and the full 1,010,000/notes as a MISS.
 *
 * Note this is NOT `calculateScoreDeduction` in ./border: that one floors the
 * per-note cost, because a border is the score you must actually reach and
 * flooring is what makes it reachable. Here the interesting number is the
 * total already lost, so the exact per-note value is multiplied out first and
 * only the total is cut to two decimals. On a 2999-note chart the difference
 * is real — 52 ATTACKs are 8842.94 lost, not 52 x 170.05 = 8842.60.
 *
 * Verified against the game's own numbers for Phantom Crisis MASTER (2999
 * notes): 338 JUSTICE = -1127.04, 52 ATTACK = -8842.94, 44 MISS = -14818.27.
 */

/** Score units one note is worth, by how badly it was hit. */
const UNITS = {
  justice: 10_000,
  attack: 510_000,
  miss: 1_010_000,
} as const;

export interface JudgementLoss {
  justice: number;
  attack: number;
  miss: number;
  /** The three added up — what a perfect play would have scored instead. */
  total: number;
}

/** Truncated, not rounded: the game reports what was lost, never more. */
const cut = (value: number) => Math.trunc(value * 100) / 100;

export function calculateJudgementLoss(
  judgements: Judgements,
  notecount: number | null,
): JudgementLoss | null {
  // Without a notecount there is no per-note value, and inventing one would
  // put a confident wrong number next to a real judgement count.
  if (!notecount || notecount <= 0) return null;

  const loss = (count: number, units: number) =>
    cut((count * units) / notecount);

  const justice = loss(judgements.justice, UNITS.justice);
  const attack = loss(judgements.attack, UNITS.attack);
  const miss = loss(judgements.miss, UNITS.miss);

  return { justice, attack, miss, total: cut(justice + attack + miss) };
}
