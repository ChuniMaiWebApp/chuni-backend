import { ratingFloor, ratingIfAllSlotsReach, whatIf } from './improvement';

/** A full frame of 30 identical 16.00 plays, the simplest thing to reason about. */
const fullFrame = { ratings: Array.from({ length: 30 }, () => 16), slots: 30 };

describe('whatIf', () => {
  it('ignores a score that cannot beat the weakest counted play', () => {
    const result = whatIf(fullFrame, 16, 15.5);

    expect(result.counts).toBe(false);
    expect(result.delta).toBe(0);
    expect(result.newRating).toBe(16);
    expect(result.displaces).toBe(16);
  });

  it('spreads the gain across all fifty rating slots', () => {
    // Replacing a 16.00 with a 17.00 adds 1.00 / 50 = 0.02.
    const result = whatIf(fullFrame, 16, 17);

    expect(result.counts).toBe(true);
    expect(result.delta).toBeCloseTo(0.02, 4);
    expect(result.newRating).toBeCloseTo(16.02, 2);
  });

  it('adds outright when the frame still has empty slots', () => {
    const result = whatIf({ ratings: [16, 16], slots: 30 }, 16, 15);

    expect(result.counts).toBe(true);
    expect(result.displaces).toBeNull();
    // Nothing is removed, so the whole play rating lands in the average.
    expect(result.delta).toBeCloseTo(15 / 50, 4);
  });

  /**
   * A chart cannot hold two rating slots. Improving a play the frame already
   * counts is worth only the difference, not the whole new rating — leaving
   * `replacing` out overstates the gain, which is exactly the trap this guards.
   */
  it('swaps against the chart’s existing entry rather than adding to it', () => {
    const frame = { ratings: [17, 16, 16], slots: 3 };

    const overstated = whatIf(frame, 16.33, 17.5);
    const correct = whatIf(frame, 16.33, 17.5, 17);

    expect(correct.delta).toBeCloseTo((17.5 - 17) / 50, 4);
    expect(overstated.delta).toBeGreaterThan(correct.delta);
  });

  it('reports no gain when the new play is worse than the one it replaces', () => {
    const result = whatIf({ ratings: [17, 16, 16], slots: 3 }, 16.33, 16.5, 17);

    expect(result.counts).toBe(false);
    expect(result.delta).toBe(0);
  });
});

describe('ratingFloor', () => {
  it('is the weakest counted play once the frame is full', () => {
    expect(ratingFloor({ ratings: [17, 16, 15], slots: 3 })).toBe(15);
  });

  it('is null while slots remain, since anything counts', () => {
    expect(ratingFloor({ ratings: [17, 16], slots: 3 })).toBeNull();
  });
});

describe('ratingIfAllSlotsReach', () => {
  it('leaves plays that already exceed the target alone', () => {
    const frames = [
      { ratings: [17, 17, 17], slots: 3 },
      { ratings: [16, 16], slots: 2 },
    ];

    // (17*3 + 16*2) / 50 — nothing is below the 15.00 target.
    expect(ratingIfAllSlotsReach(frames, 15)).toBeCloseTo(83 / 50, 2);
  });

  it('counts empty slots as reaching the target', () => {
    const frames = [{ ratings: [], slots: 50 }];

    expect(ratingIfAllSlotsReach(frames, 16)).toBeCloseTo(16, 2);
  });
});
