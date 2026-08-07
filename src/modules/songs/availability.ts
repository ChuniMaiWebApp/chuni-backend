/**
 * Whether a song can be played on CHUNITHM International.
 *
 * Kept as a pure function, away from the repository, because this is the piece
 * that has been wrong twice: first by trusting the seeded `available` flag,
 * then by inferring from whether anyone had a score. Both are gone. The inputs
 * here come from a dataset that tracks the two regions separately, per chart.
 *
 * Nothing in here consults play history. A score proves a song IS playable but
 * can never show the opposite, and only a fifth of the catalogue has one, so
 * "nobody has played it" is not evidence of anything.
 */

export interface AvailabilityView {
  status: 'playable' | 'removed' | 'japanOnly' | 'absent' | 'unknown';
  /** Charts Japan has that International does not, by difficulty name. */
  chartsMissingHere: string[];
  source: {
    url: string;
    /** The upstream's own update time, which is what dates the claim. */
    publishedAt: string | null;
    fetchedAt: string;
    ageHours: number | null;
  } | null;
}

export interface RegionalSong {
  removed: boolean;
  available_intl: boolean | null;
  available_jp: boolean | null;
}

export interface RegionalChart {
  difficulty: string;
  available_intl: boolean | null;
  available_jp: boolean | null;
}

export interface RegionRefresh {
  source_url: string;
  published_at: Date | null;
  fetched_at: Date;
}

export function deriveAvailability(
  song: RegionalSong,
  charts: RegionalChart[],
  refresh: RegionRefresh | null,
  now: number = Date.now(),
): AvailabilityView {
  // Null is "the regional dataset has no entry", which is not the same as
  // "not available" — reporting it as unavailable is the original bug.
  const status: AvailabilityView['status'] = song.removed
    ? 'removed'
    : song.available_intl === true
      ? 'playable'
      : song.available_intl === null
        ? 'unknown'
        : song.available_jp
          ? 'japanOnly'
          : 'absent';

  return {
    status,
    // Only worth listing when the song itself is here: for a Japan-only song
    // every chart is missing, which the status already says.
    chartsMissingHere:
      status === 'playable'
        ? charts
            .filter(
              (chart) =>
                chart.available_intl === false && chart.available_jp === true,
            )
            .map((chart) => chart.difficulty)
        : [],
    source: refresh
      ? {
          url: refresh.source_url,
          publishedAt: refresh.published_at?.toISOString() ?? null,
          fetchedAt: refresh.fetched_at.toISOString(),
          ageHours: refresh.published_at
            ? Math.round((now - refresh.published_at.getTime()) / 3_600_000)
            : null,
        }
      : null,
  };
}
