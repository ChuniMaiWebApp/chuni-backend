import { calculateJudgementLoss } from './judgements';

describe('calculateJudgementLoss', () => {
  it("matches the game's own figures for Phantom Crisis MASTER", () => {
    // Read off a real play: 2999 notes, 985211, S, x437.
    const loss = calculateJudgementLoss(
      { justiceCritical: 2565, justice: 338, attack: 52, miss: 44 },
      2999,
    );

    expect(loss).toEqual({
      justice: 1127.04,
      attack: 8842.94,
      miss: 14818.27,
      total: 24788.25,
    });
  });

  it('truncates rather than rounds', () => {
    // 52 * 510000 / 2999 = 8842.9476…, which rounds up to .95. The game shows
    // .94 — it never reports more lost than actually was.
    const loss = calculateJudgementLoss(
      { justiceCritical: 0, justice: 0, attack: 52, miss: 0 },
      2999,
    );

    expect(loss?.attack).toBe(8842.94);
  });

  it('multiplies the exact per-note cost, not a pre-floored one', () => {
    // Flooring per note first (as the border maths must) would give
    // 52 * 170.05 = 8842.60 — sixty points adrift on one line of a score card.
    const loss = calculateJudgementLoss(
      { justiceCritical: 0, justice: 0, attack: 52, miss: 0 },
      2999,
    );

    expect(loss?.attack).not.toBeCloseTo(8842.6, 2);
  });

  it('accounts for a full chart of misses as the whole 1,010,000', () => {
    const loss = calculateJudgementLoss(
      { justiceCritical: 0, justice: 0, attack: 0, miss: 1000 },
      1000,
    );

    expect(loss?.miss).toBe(1_010_000);
  });

  it('costs nothing for an all JUSTICE CRITICAL play', () => {
    const loss = calculateJudgementLoss(
      { justiceCritical: 2999, justice: 0, attack: 0, miss: 0 },
      2999,
    );

    expect(loss).toEqual({ justice: 0, attack: 0, miss: 0, total: 0 });
  });

  it('returns null rather than a made-up figure when the notecount is unknown', () => {
    const judgements = {
      justiceCritical: 100,
      justice: 1,
      attack: 1,
      miss: 1,
    };

    expect(calculateJudgementLoss(judgements, null)).toBeNull();
    expect(calculateJudgementLoss(judgements, 0)).toBeNull();
  });
});
