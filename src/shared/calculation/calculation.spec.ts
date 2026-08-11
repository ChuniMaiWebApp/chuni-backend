import { ComboLamp } from '../chunithm-net/chunithm-net.types';
import { calculateOverpower } from './overpower';
import { calculateRating, calculateScoreForRating } from './rating';

/**
 * Every expectation below is a rating and OVER POWER the game itself awarded
 * for that score on that chart, taken from a real CHUNITHM International
 * profile on 2026-08-06.
 *
 * They lock the implementation to observed game behaviour rather than to our
 * reading of the curve — which is the only thing worth testing here, since a
 * formula that agrees with our own derivation but not with the cabinet is
 * simply wrong.
 */
interface Vector {
  name: string;
  score: number;
  internalLevel: number;
  comboLamp: ComboLamp;
  rating: number;
  op: number;
  opPercentage: number;
}

const VECTORS: Vector[] = [
  {
    name: 'Deep Blue [MASTER 15.6] — S+ range',
    score: 990_097,
    internalLevel: 15.6,
    comboLamp: ComboLamp.NONE,
    rating: 16.2,
    op: 81.015,
    opPercentage: 87.11,
  },
  {
    name: "DA'AT [EXPERT 14.3] — SS range",
    score: 1_004_136,
    internalLevel: 14.3,
    comboLamp: ComboLamp.NONE,
    rating: 15.71,
    op: 78.565,
    opPercentage: 90.82,
  },
  {
    name: "Tru'nembra [EXPERT 14.4] — floor equals round, no half step",
    score: 1_004_268,
    internalLevel: 14.4,
    comboLamp: ComboLamp.NONE,
    rating: 15.82,
    op: 79.13,
    opPercentage: 90.95,
  },
  {
    name: '☆をつなぐシュトラール [MASTER 14.4]',
    score: 1_004_062,
    internalLevel: 14.4,
    comboLamp: ComboLamp.NONE,
    rating: 15.8,
    op: 79.03,
    opPercentage: 90.83,
  },
  {
    name: 'カオスが極まる [EXPERT 10.0] — SSS+ with ALL JUSTICE bonus',
    score: 1_009_934,
    internalLevel: 10.0,
    comboLamp: ComboLamp.ALL_JUSTICE,
    rating: 12.15,
    op: 64.65,
    opPercentage: 99.46,
  },
  {
    name: 'NightTheater [EXPERT 11.8] — FAILED, coarse 0.05 quantum',
    score: 741_102,
    internalLevel: 11.8,
    comboLamp: ComboLamp.NONE,
    rating: 2.73,
    op: 13.65,
    opPercentage: 18.44,
  },
];

describe('rating', () => {
  it.each(VECTORS)('$name', ({ score, internalLevel, rating }) => {
    expect(calculateRating(score, internalLevel)).toBeCloseTo(rating, 2);
  });

  it('caps at chart constant + 2.15 for SSS+', () => {
    expect(calculateRating(1_010_000, 15.4)).toBeCloseTo(17.55, 2);
  });

  it('is zero below 500k', () => {
    expect(calculateRating(499_999, 14.0)).toBe(0);
  });

  it('round-trips through calculateScoreForRating', () => {
    const required = calculateScoreForRating(15.5, 14.5);

    expect(required).not.toBeNull();
    expect(calculateRating(required!, 14.5)).toBeGreaterThanOrEqual(15.5);
  });

  it('returns null when the target rating is unreachable', () => {
    expect(calculateScoreForRating(17.0, 14.0)).toBeNull();
  });
});

describe('overpower', () => {
  it.each(VECTORS)(
    '$name',
    ({ score, internalLevel, comboLamp, op, opPercentage }) => {
      const result = calculateOverpower(score, internalLevel, comboLamp);

      expect(result.value).toBeCloseTo(op, 3);
      expect(result.percentage).toBeCloseTo(opPercentage, 2);
    },
  );

  it('awards the full 1.25 bonus for ALL JUSTICE CRITICAL', () => {
    const plain = calculateOverpower(1_009_934, 10.0, ComboLamp.NONE);
    const ajc = calculateOverpower(
      1_009_934,
      10.0,
      ComboLamp.ALL_JUSTICE_CRITICAL,
    );

    expect(ajc.value - plain.value).toBeCloseTo(1.25, 3);
  });

  it('caps max OP at chart constant * 5 + 15', () => {
    expect(calculateOverpower(1_010_000, 15.6, ComboLamp.NONE).max).toBeCloseTo(
      93,
      3,
    );
  });
});
