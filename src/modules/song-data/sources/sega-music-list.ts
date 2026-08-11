import type {
  CatalogueChart,
  CatalogueSong,
  ChartDifficulty,
} from '../catalogue.types';

/**
 * SEGA's own song list.
 *
 * The publisher's public catalogue JSON, the same file the official site reads
 * to render its music list. Going here rather than to a community mirror means
 * the identity of a song — its id, title, artist, genre, jacket — comes from
 * the party that assigns it.
 *
 * What it does not carry: the chart constant. SEGA prints `14+` on the cabinet
 * and publishes exactly that, never the decimal underneath. See
 * ./chunirec-constants.ts for where that has to come from.
 */
export const SEGA_MUSIC_LIST_URL =
  'https://chunithm.sega.jp/storage/json/music.json';

/**
 * Below this the response is treated as broken rather than as the catalogue
 * having shrunk. A truncated download that still parses would otherwise be
 * recorded as a successful refresh and hide the staleness.
 */
const MIN_PLAUSIBLE_SONGS = 1_200;

/** The level fields, in the order the difficulties are stored. */
const LEVEL_FIELDS: ReadonlyArray<[ChartDifficulty, string]> = [
  ['BAS', 'lev_bas'],
  ['ADV', 'lev_adv'],
  ['EXP', 'lev_exp'],
  ['MAS', 'lev_mas'],
  ['ULT', 'lev_ult'],
];

/** One entry as SEGA publishes it. Every value arrives as a string. */
interface SegaEntry {
  id?: string;
  title?: string;
  artist?: string;
  catname?: string;
  image?: string;
  reading?: string;
  we_kanji?: string;
  we_star?: string;
  [levelField: string]: string | undefined;
}

const trimmed = (value: string | undefined): string | null => {
  const text = value?.trim();

  return text ? text : null;
};

/**
 * Below this printed level, the level and the constant are the same number.
 *
 * Not an assumption — measured. Of the 140 charts under level 10 that chunirec
 * has actually measured, the printed level matched the measured constant 140
 * times, with no exceptions. Nobody bothers separating a 7 from a 7.3 because
 * nothing at that level competes for a place in anyone's Best 50.
 *
 * At level 10 and above the two part company, and guessing becomes harmful:
 * an EXPERT `14+` is anywhere from 14.5 to 14.9, so inventing 14.5 would put a
 * wrong rating on a chart that counts.
 */
const LEVEL_BELOW_WHICH_CONSTANT_IS_THE_LEVEL = 10;

/**
 * Turns `14+` into 14.5 and `14` into 14.0.
 *
 * Exported for the check that verifies the rule above still holds; callers
 * that want a constant should go through `constantForChart`.
 */
export const constantFromDisplayLevel = (level: string): number | null => {
  const match = /^(\d+)(\+?)$/.exec(level.trim());

  if (!match) return null;

  return Number(match[1]) + (match[2] ? 0.5 : 0);
};

/**
 * The constant SEGA's list alone can establish, or null when a measurement is
 * needed. Null here is filled in from chunirec; anything still null after that
 * is a chart nobody has measured yet, and is left visibly absent rather than
 * approximated.
 */
const constantForChart = (level: string): number | null => {
  const value = constantFromDisplayLevel(level);

  if (value === null) return null;

  return value < LEVEL_BELOW_WHICH_CONSTANT_IS_THE_LEVEL ? value : null;
};

/**
 * WORLD'S END star ratings are written as a run of `☆`, occasionally with a
 * numeric suffix. Counting the character is more robust than parsing either.
 */
const parseWorldsEndStars = (value: string | null): number | null => {
  if (!value) return null;

  const stars = (value.match(/★|☆/g) ?? []).length;

  if (stars > 0) return stars;

  const numeric = Number.parseInt(value, 10);

  return Number.isNaN(numeric) ? null : numeric;
};

function toCharts(entry: SegaEntry, isWorldsEnd: boolean): CatalogueChart[] {
  if (isWorldsEnd) {
    // A WORLD'S END entry carries one chart, and its difficulty is expressed
    // in stars rather than a level.
    return [
      {
        difficulty: 'WE',
        displayLevel: trimmed(entry.we_star) ?? '',
        constant: null,
        maxCombo: null,
      },
    ];
  }

  return LEVEL_FIELDS.flatMap(([difficulty, field]) => {
    const level = trimmed(entry[field]);

    // An empty level means the song simply has no chart at that difficulty —
    // most songs have no ULTIMA.
    if (!level) return [];

    return [
      {
        difficulty,
        displayLevel: level,
        // Set only where the printed level settles it; everything harder is
        // filled in from chunirec, which is the only place the decimal exists.
        constant: constantForChart(level),
        maxCombo: null,
      },
    ];
  });
}

/** Fetches and maps SEGA's list. Throws rather than returning junk. */
export async function fetchSegaMusicList(
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogueSong[]> {
  const response = await fetchImpl(SEGA_MUSIC_LIST_URL);

  if (!response.ok) {
    throw new Error(`${SEGA_MUSIC_LIST_URL} responded ${response.status}`);
  }

  const entries = (await response.json()) as SegaEntry[];

  if (!Array.isArray(entries)) {
    throw new Error('SEGA music list did not parse as an array');
  }

  const songs = entries.flatMap((entry): CatalogueSong[] => {
    const id = Number.parseInt(entry.id ?? '', 10);
    const title = trimmed(entry.title);

    if (Number.isNaN(id) || !title) return [];

    const worldsEndKanji = trimmed(entry.we_kanji);
    const isWorldsEnd = worldsEndKanji !== null;

    return [
      {
        id,
        title,
        artist: trimmed(entry.artist) ?? '',
        genre: trimmed(entry.catname) ?? '',
        reading: trimmed(entry.reading),
        jacket: trimmed(entry.image),
        bpm: null,
        releaseDate: null,
        isWorldsEnd,
        worldsEndKanji,
        worldsEndStars: parseWorldsEndStars(trimmed(entry.we_star)),
        charts: toCharts(entry, isWorldsEnd),
      },
    ];
  });

  if (songs.length < MIN_PLAUSIBLE_SONGS) {
    throw new Error(
      `SEGA music list returned only ${songs.length} songs, expected at least ${MIN_PLAUSIBLE_SONGS}`,
    );
  }

  return songs;
}
