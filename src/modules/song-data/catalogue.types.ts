/**
 * The song catalogue, in this application's own terms.
 *
 * Assembled from two upstreams that each know half the picture:
 *
 *   SEGA      — who the song is: id, title, artist, genre, jacket, the level
 *               printed on the cabinet, and the reading used for search.
 *   chunirec  — how hard it is: the chart constant, which SEGA has never
 *               published anywhere. Also BPM, release date and note totals.
 *
 * Neither source uses these names; the shape here is what the application
 * needs, not a mirror of either feed. Field names are the ones used in
 * `app.songs` / `app.charts` so the mapping to SQL stays obvious.
 */

/** Difficulty codes as stored in `app.charts.difficulty`. */
export type ChartDifficulty = 'BAS' | 'ADV' | 'EXP' | 'MAS' | 'ULT' | 'WE';

export interface CatalogueChart {
  difficulty: ChartDifficulty;

  /**
   * The level printed on the cabinet, e.g. `14+`. A string because SEGA writes
   * a `+` rather than a decimal, and because sorting by it is never what
   * anyone wants — that is what `constant` is for.
   */
  displayLevel: string;

  /**
   * Chart constant, e.g. 14.7. Null when nobody has measured it.
   *
   * This is the number play rating is computed from, and the single reason a
   * second upstream is needed at all: SEGA publishes `14+` and stops there.
   *
   * For BASIC and ADVANCED the community does not measure a decimal, because
   * at those levels there is nothing to distinguish — the constant is simply
   * the printed level, and that is what is stored.
   */
  constant: number | null;

  /** Total notes in the chart. Null when the upstream has not recorded it. */
  maxCombo: number | null;
}

export interface CatalogueSong {
  /**
   * SEGA's own song id, which is also what `app.songs.id` has always held.
   *
   * Verified rather than assumed: every id in the previous dataset that also
   * appears in SEGA's list carries the same title, 1691 for 1691. Scores
   * recorded before this change therefore keep pointing at the right song.
   */
  id: number;

  title: string;
  artist: string;
  genre: string;

  /**
   * Kana/romaji reading, straight from SEGA.
   *
   * This is what makes a search for "tentai kansoku" find 天体観測. Worth
   * naming explicitly because it removes the need for a hand-maintained alias
   * table — SEGA ships the reading for every song it lists.
   */
  reading: string | null;

  /** Jacket image filename, served from the CHUNITHM-NET image host. */
  jacket: string | null;

  bpm: number | null;
  releaseDate: string | null;

  /** True for the game's WORLD'S END arrangements. */
  isWorldsEnd: boolean;

  /** The single kanji the game prints on a WORLD'S END chart, e.g. 狂. */
  worldsEndKanji: string | null;

  /** Difficulty of a WORLD'S END chart, counted in stars. */
  worldsEndStars: number | null;

  charts: CatalogueChart[];
}

export interface CatalogueRefreshResult {
  /** False when both upstreams returned exactly what was stored last time. */
  changed: boolean;
  songCount: number;
  chartCount: number;

  /** Charts that ended up with a constant from chunirec. */
  chartsWithConstant: number;

  /** Songs SEGA lists that chunirec has never heard of. */
  unmatchedSongs: number;

  newestRelease: string | null;
}
