import { deriveAvailability } from './availability';

const REFRESH = {
  source_url: 'https://example.test/data.json',
  published_at: new Date('2026-08-07T06:00:00Z'),
  fetched_at: new Date('2026-08-07T17:00:00Z'),
};

const NOW = new Date('2026-08-07T18:00:00Z').getTime();

const chart = (
  difficulty: string,
  intl: boolean | null,
  jp: boolean | null,
) => ({ difficulty, available_intl: intl, available_jp: jp });

describe('deriveAvailability', () => {
  it('reports a song Japan has and International does not as japanOnly', () => {
    // Melodiniq: the case the old logic got wrong, because nobody here had a
    // score on it and it inferred "unreleased" from that absence.
    const result = deriveAvailability(
      { removed: false, available_intl: false, available_jp: true },
      [chart('MAS', false, true), chart('ULT', false, true)],
      REFRESH,
      NOW,
    );

    expect(result.status).toBe('japanOnly');
    // The status already says every chart is missing; listing them repeats it.
    expect(result.chartsMissingHere).toEqual([]);
  });

  it('reports a song International has as playable regardless of play history', () => {
    // Phantom Crisis: a Linked VERSE unlock, so it appears in neither official
    // music list, yet it is playable. Nothing here consults scores.
    const result = deriveAvailability(
      { removed: false, available_intl: true, available_jp: true },
      [chart('MAS', true, true)],
      REFRESH,
      NOW,
    );

    expect(result.status).toBe('playable');
    expect(result.chartsMissingHere).toEqual([]);
  });

  it('names the individual charts International is missing', () => {
    // Philosopher ships everywhere except its ULTIMA. A song-level flag cannot
    // express this, and no amount of play data would reveal it.
    const result = deriveAvailability(
      { removed: false, available_intl: true, available_jp: true },
      [
        chart('EXP', true, true),
        chart('MAS', true, true),
        chart('ULT', false, true),
      ],
      REFRESH,
      NOW,
    );

    expect(result.status).toBe('playable');
    expect(result.chartsMissingHere).toEqual(['ULT']);
  });

  it('does not call a chart regionally missing when neither region has it', () => {
    const result = deriveAvailability(
      { removed: false, available_intl: true, available_jp: true },
      [chart('MAS', true, true), chart('WE', false, false)],
      REFRESH,
      NOW,
    );

    expect(result.chartsMissingHere).toEqual([]);
  });

  it('treats a missing regional entry as unknown, never as unavailable', () => {
    // Hiding what we have no data about is exactly the bug this replaced.
    const result = deriveAvailability(
      { removed: false, available_intl: null, available_jp: null },
      [chart('MAS', null, null)],
      REFRESH,
      NOW,
    );

    expect(result.status).toBe('unknown');
  });

  it('prefers removed over any regional flag', () => {
    const result = deriveAvailability(
      { removed: true, available_intl: false, available_jp: true },
      [],
      REFRESH,
      NOW,
    );

    expect(result.status).toBe('removed');
  });

  it('reports a song in neither region as absent rather than japanOnly', () => {
    const result = deriveAvailability(
      { removed: false, available_intl: false, available_jp: false },
      [],
      REFRESH,
      NOW,
    );

    expect(result.status).toBe('absent');
  });

  it('dates the claim from the upstream publish time, not our fetch time', () => {
    // Fetching a stale file does not make its contents current, so the age the
    // UI shows has to come from `published_at`.
    const result = deriveAvailability(
      { removed: false, available_intl: false, available_jp: true },
      [],
      REFRESH,
      NOW,
    );

    expect(result.source?.ageHours).toBe(12);
    expect(result.source?.publishedAt).toBe('2026-08-07T06:00:00.000Z');
  });

  it('leaves the age null when the upstream states no publish time', () => {
    const result = deriveAvailability(
      { removed: false, available_intl: true, available_jp: true },
      [],
      { ...REFRESH, published_at: null },
      NOW,
    );

    expect(result.source?.ageHours).toBeNull();
  });

  it('survives never having refreshed', () => {
    const result = deriveAvailability(
      { removed: false, available_intl: true, available_jp: true },
      [],
      null,
      NOW,
    );

    expect(result.source).toBeNull();
    expect(result.status).toBe('playable');
  });
});
