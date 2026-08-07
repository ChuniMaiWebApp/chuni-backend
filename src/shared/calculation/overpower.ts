import { ComboLamp } from '../chunithm-net/chunithm-net.types';
import { calculateWholeRating } from './rating';

/**
 * OVER POWER.
 *
 * The game does something unusual: it floors the raw value and rounds it
 * half-up, then takes the average of the two. That is why real OP values end in
 * `.xx5` about half the time (e.g. `81.015`). Doing this in floating point
 * drifts, so everything below works on integers scaled by 1e-4 and only divides
 * at the very end.
 */

const FC_BONUS_MILLI = 500;
const AJ_BONUS_MILLI = 500;
const AJC_BONUS_MILLI = 250;

/** Raw OP scaled by 1e4, as an exact integer. */
function rawOverpowerScaled(score: number, internalLevel: number): number {
  if (score >= 1_007_500) {
    // Above SSS the curve is defined on the exact chart constant, not on the
    // truncated rating value. Chart constants always have one decimal.
    const il10 = Math.round(internalLevel * 10);
    return il10 * 5_000 + 100_000 + (score - 1_007_500) * 15;
  }

  return calculateWholeRating(score, internalLevel) * 5;
}

/**
 * Base OP in units of 1e-3 (milli-OP), before combo lamp bonuses.
 *
 * Rank S and above is quantised to 0.005, everything below to 0.05.
 */
export function calculateOverpowerBaseMilli(
  score: number,
  internalLevel: number,
): number {
  const raw = rawOverpowerScaled(score, internalLevel);

  // Quantum: 1e-2 above S rank, 1e-1 below. Expressed in the 1e-4 scale.
  const quantum = score >= 975_000 ? 100 : 1_000;

  const floored = Math.floor(raw / quantum);
  // Round half up, computed on integers to avoid a 0.5 landing wrong.
  const rounded = Math.floor((raw * 2 + quantum) / (2 * quantum));

  // (floored + rounded) / 2 quanta, converted from the quantum scale to 1e-3.
  return ((floored + rounded) * quantum) / 20;
}

/** Maximum attainable OP on a chart, in units of 1e-3. */
export function calculateMaxOverpowerMilli(internalLevel: number): number {
  return Math.round(internalLevel * 10) * 500 + 15_000;
}

/** OP actually awarded for a play, including combo lamp bonuses, in 1e-3. */
export function calculatePlayOverpowerMilli(
  score: number,
  internalLevel: number,
  comboLamp: ComboLamp,
): number {
  let op = calculateOverpowerBaseMilli(score, internalLevel);

  if (comboLamp >= ComboLamp.FULL_COMBO) op += FC_BONUS_MILLI;
  if (comboLamp >= ComboLamp.ALL_JUSTICE) op += AJ_BONUS_MILLI;
  if (comboLamp >= ComboLamp.ALL_JUSTICE_CRITICAL) op += AJC_BONUS_MILLI;

  return op;
}

/** Convenience wrapper returning display-ready numbers. */
export function calculateOverpower(
  score: number,
  internalLevel: number,
  comboLamp: ComboLamp,
): { value: number; max: number; percentage: number } {
  const milli = calculatePlayOverpowerMilli(score, internalLevel, comboLamp);
  const maxMilli = calculateMaxOverpowerMilli(internalLevel);

  return {
    value: milli / 1000,
    max: maxMilli / 1000,
    // The game floors the percentage rather than rounding it.
    percentage: Math.floor((milli * 10_000) / maxMilli) / 100,
  };
}
