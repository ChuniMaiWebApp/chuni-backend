import { load } from 'cheerio';

import { Difficulty } from '../chunithm-net.types';
import { difficultyFromImageUrl } from './utils';

/**
 * One chart as CHUNITHM-NET lists it, whether or not the player has touched it.
 */
export interface ListedChart {
  songId: number;
  difficulty: Difficulty;
  title: string;
}

/**
 * Reads every chart a music list page offers, played or not.
 *
 * Deliberately separate from `parseMusicList`, which answers a different
 * question. That one collects the player's scores and so skips any entry with
 * no `play_musicdata_highscore` block; this one is about what the *server*
 * carries, so an untouched chart is exactly the kind of row it must keep.
 *
 * Why this exists at all: what a region actually has is otherwise guesswork.
 * SEGA's published music lists are periodic snapshots and omit every song
 * unlocked through a mission or a Linked VERSE gate, which is a real category
 * and not a rounding error. The signed-in music list has no such gap — it is
 * the International server describing itself.
 *
 * Difficulty is read from the posted `diff` field where the page has one,
 * because that is what SEGA itself uses to identify the chart. The WORLD'S END
 * list does not carry it — the page is already about one difficulty, so there
 * is nothing to disambiguate — and falls back to the `bg_<name>` class on the
 * box, which is how the existing score parser reads that same page.
 *
 * Requiring the field outright is what an earlier version did, and it read the
 * WORLD'S END list as empty rather than as unsupported: 6,259 charts found and
 * every one of them silently missing its WORLD'S END entries.
 */
function difficultyOf(
  form: ReturnType<ReturnType<typeof load>>,
): Difficulty | null {
  const posted = form.find('input[name=diff]').first().attr('value');

  if (posted !== undefined) {
    const value = Number.parseInt(posted, 10);

    return !Number.isNaN(value) && value in Difficulty ? value : null;
  }

  const box = form.find('.w388.musiclist_box').first();

  try {
    return difficultyFromImageUrl(box.attr('class') ?? '');
  } catch {
    // Throws on a class it does not recognise. A chart whose difficulty cannot
    // be established is dropped: recording it under a guessed difficulty would
    // mark the wrong chart as available in this region.
    return null;
  }
}

export function parseMusicCatalogue(html: string): ListedChart[] {
  const $ = load(html);
  const charts: ListedChart[] = [];
  const seen = new Set<string>();

  $('form').each((_, element) => {
    const form = $(element);

    if (!form.find('.w388.musiclist_box').length) return;

    const rawId = form.find('input[name=idx]').first().attr('value');

    if (!rawId) return;

    const songId = Number.parseInt(rawId, 10);
    const difficulty = difficultyOf(form);

    if (Number.isNaN(songId) || difficulty === null) return;

    // A page can repeat a chart — WORLD'S END songs appear once per chart and
    // share a title — so the pair is what has to be unique, not the id.
    const key = `${songId}:${difficulty}`;

    if (seen.has(key)) return;
    seen.add(key);

    charts.push({
      songId,
      difficulty,
      title: form
        .find('.music_title, .musiclist_worldsend_title')
        .first()
        .text()
        .trim(),
    });
  });

  return charts;
}
