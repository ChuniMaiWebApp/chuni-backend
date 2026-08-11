import type { ChartDifficulty } from '../catalogue.types';

/**
 * Chart constants, from chunirec's public API.
 *
 * The constant is the number play rating is computed from, and it exists
 * nowhere in the game: SEGA prints `14+` and publishes `14+`. Every CHUNITHM
 * tool that computes a rating gets the decimal from a community measurement,
 * because there is no other way to have it.
 *
 * chunirec runs a documented developer programme with per-application tokens
 * (https://developer.chunirec.net/), which makes this a supported integration
 * rather than a scrape of somebody's published output.
 *
 * Also carries BPM, release date and note totals, which SEGA's list omits.
 */
const CHUNIREC_URL = 'https://api.chunirec.net/2.0/music/showall.json';

/**
 * Fewer than this and the response is treated as broken. chunirec normally
 * answers with roughly 1,700 songs.
 */
const MIN_PLAUSIBLE_SONGS = 1_200;

/** chunirec's difficulty keys, mapped to the codes used here. */
const DIFFICULTY: Record<string, ChartDifficulty> = {
  BAS: 'BAS',
  ADV: 'ADV',
  EXP: 'EXP',
  MAS: 'MAS',
  ULT: 'ULT',
  WE: 'WE',
};

interface ChunirecSheet {
  level?: number;
  const?: number;
  maxcombo?: number;
  is_const_unknown?: number;
}

interface ChunirecEntry {
  meta?: {
    id?: string;
    title?: string;
    artist?: string;
    genre?: string;
    bpm?: number;
    release?: string;
  };
  data?: Record<string, ChunirecSheet>;
}

/** What chunirec knows about one chart. */
export interface ChunirecChart {
  constant: number | null;
  maxCombo: number | null;
}

/** What chunirec knows about one song, keyed by difficulty. */
export interface ChunirecSong {
  title: string;
  bpm: number | null;
  releaseDate: string | null;
  charts: Map<ChartDifficulty, ChunirecChart>;
}

/**
 * Fetches chunirec and keys it by title.
 *
 * By title rather than by id on purpose: chunirec assigns its own opaque ids
 * that have no relation to SEGA's, so the title is the only field the two
 * feeds share. Titles that appear twice are dropped rather than guessed at —
 * see the merge step, which would otherwise attach one song's constants to
 * another song's charts.
 */
export async function fetchChunirecConstants(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, ChunirecSong>> {
  if (!token) {
    throw new Error('CHUNIREC_TOKEN is not set');
  }

  const url = `${CHUNIREC_URL}?region=jp2&token=${encodeURIComponent(token)}`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    // Deliberately does not echo the URL: it carries the token.
    throw new Error(`chunirec responded ${response.status}`);
  }

  const entries = (await response.json()) as ChunirecEntry[];

  if (!Array.isArray(entries)) {
    throw new Error('chunirec response did not parse as an array');
  }

  if (entries.length < MIN_PLAUSIBLE_SONGS) {
    throw new Error(
      `chunirec returned only ${entries.length} songs, expected at least ${MIN_PLAUSIBLE_SONGS}`,
    );
  }

  const byTitle = new Map<string, ChunirecSong>();
  const duplicates = new Set<string>();

  for (const entry of entries) {
    const title = entry.meta?.title?.trim();

    if (!title) continue;

    if (byTitle.has(title)) {
      duplicates.add(title);
      continue;
    }

    const charts = new Map<ChartDifficulty, ChunirecChart>();

    for (const [key, sheet] of Object.entries(entry.data ?? {})) {
      const difficulty = DIFFICULTY[key];

      if (!difficulty) continue;

      charts.set(difficulty, {
        // chunirec writes 0 for "nobody has measured this", which is not a
        // constant of zero. Anything at or below zero is absence.
        constant: sheet.const && sheet.const > 0 ? sheet.const : null,
        maxCombo: sheet.maxcombo && sheet.maxcombo > 0 ? sheet.maxcombo : null,
      });
    }

    byTitle.set(title, {
      title,
      bpm: entry.meta?.bpm && entry.meta.bpm > 0 ? entry.meta.bpm : null,
      releaseDate: entry.meta?.release?.trim() || null,
      charts,
    });
  }

  // An ambiguous title is worse than a missing one: attaching the wrong
  // constant silently changes a player's rating, while a missing constant is
  // visible and fixable.
  for (const title of duplicates) byTitle.delete(title);

  return byTitle;
}
