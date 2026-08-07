import { Rank } from '../chunithm-net/chunithm-net.types';
import {
  calculateAnmitsu,
  calculateBorders,
  calculateScoreDeduction,
} from './border';

describe('calculateBorders', () => {
  // Deep Blue [MASTER 15.6], whose notecount is in the seeded chart data.
  const borders = calculateBorders(4400);
  const byKey = new Map(borders.map((border) => [border.key, border]));

  it('covers 99AJ and every rank from S upwards', () => {
    expect([...byKey.keys()]).toEqual([
      '99AJ',
      Rank.SSSP,
      Rank.SSS,
      Rank.SSP,
      Rank.SS,
      Rank.SP,
      Rank.S,
    ]);
  });

  it('keeps every judgement total equal to the notecount', () => {
    for (const border of borders) {
      const total =
        border.justiceCritical + border.justice + border.attack + border.miss;

      expect(total).toBe(4400);
    }
  });

  it('never reports a negative judgement count', () => {
    for (const border of borders) {
      expect(border.justiceCritical).toBeGreaterThanOrEqual(0);
      expect(border.justice).toBeGreaterThanOrEqual(0);
      expect(border.attack).toBeGreaterThanOrEqual(0);
      expect(border.miss).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * Comparing JUSTICE CRITICAL counts looks tempting but is not actually
   * monotonic — at 1000 notes SSS and SSS+ both land on 950, because SSS
   * trades justices for attacks. What genuinely tightens is the total cost of
   * the mistakes allowed, measured in justice-equivalents.
   */
  const toleranceOf = (border: {
    justice: number;
    attack: number;
    miss: number;
  }) => border.justice + border.attack * 51 + border.miss * 101;

  it.each([1000, 4400])(
    'allows strictly less slack as the rank goes up (%i notes)',
    (notes) => {
      const order = [Rank.S, Rank.SP, Rank.SS, Rank.SSP, Rank.SSS, Rank.SSSP];
      const table = new Map(
        calculateBorders(notes).map((border) => [border.key, border]),
      );

      for (let i = 1; i < order.length; i += 1) {
        const looser = table.get(order[i - 1])!;
        const tighter = table.get(order[i])!;

        expect(toleranceOf(tighter)).toBeLessThan(toleranceOf(looser));
      }
    },
  );

  it('allows no mistakes beyond justices at SSS and above', () => {
    for (const rank of [Rank.SSS, Rank.SSSP]) {
      expect(byKey.get(rank)!.miss).toBe(0);
    }

    expect(byKey.get('99AJ')!.attack).toBe(0);
    expect(byKey.get('99AJ')!.miss).toBe(0);
  });

  it('returns nothing for an unknown notecount', () => {
    expect(calculateBorders(0)).toEqual([]);
  });
});

describe('calculateScoreDeduction', () => {
  it('costs 51 justices per attack and 101 per miss', () => {
    const { justice, attack, miss } = calculateScoreDeduction(1000);

    expect(attack / justice).toBeCloseTo(51, 1);
    expect(miss / justice).toBeCloseTo(101, 1);
  });
});

describe('calculateAnmitsu', () => {
  it('measures the gap between 1/16 notes', () => {
    // 240000 / 200 / 16 = 75ms
    expect(calculateAnmitsu(200, 16).distanceMs).toBeCloseTo(75, 1);
  });

  it('reports both overlap windows', () => {
    const result = calculateAnmitsu(200, 16);

    // 66.667 - 75 clamps to zero; 133.333 - 75 = 58.3
    expect(result.criticalOverlapMs).toBe(0);
    expect(result.justiceOverlapMs).toBeCloseTo(58.3, 1);
  });

  it('calls tight spacing ideal and wide spacing hopeless', () => {
    // 1/32 at 200bpm = 37.5ms gap, well inside the critical window.
    expect(calculateAnmitsu(200, 32).anmitsu).toBe('ideal');
    expect(calculateAnmitsu(200, 32).rub).toBe('ideal');

    // 1/4 at 60bpm = 1000ms, nowhere near.
    expect(calculateAnmitsu(60, 4).anmitsu).toBe('no');
    expect(calculateAnmitsu(60, 4).rub).toBe('no');
  });

  it('flags the band where rubbing avoids ATTACK but risks JUSTICE', () => {
    expect(calculateAnmitsu(200, 16).rub).toBe('risky');
  });
});
