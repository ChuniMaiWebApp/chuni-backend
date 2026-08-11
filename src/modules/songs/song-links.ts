import {
  DIFFICULTY_SHORT,
  Difficulty,
} from '../../shared/chunithm-net/chunithm-net.types';

/**
 * Builds a link to the chart view on sdvx.in.
 *
 * The shape of these URLs is sdvx.in's own convention, read off the site: it
 * files normal charts under a directory named by the first two digits of the
 * chart id, while ULTIMA and WORLD'S END live in directories of their own.
 * WORLD'S END additionally takes an index, because one song can carry several
 * WORLD'S END charts and the id alone would not say which.
 *
 * Two difficulty abbreviations differ from the ones CHUNITHM-NET uses, so they
 * are translated rather than passed through.
 */
export function sdvxinUrl(
  sdvxinId: string,
  difficulty: Difficulty,
  endIndex: string | null,
): string {
  const short = DIFFICULTY_SHORT[difficulty];

  if (short !== 'ULT' && short !== 'WE') {
    // sdvx.in spells two of these differently from CHUNITHM-NET.
    const name =
      short === 'MAS' ? 'mst' : short === 'BAS' ? 'bsc' : short.toLowerCase();

    return `https://sdvx.in/chunithm/${sdvxinId.slice(0, 2)}/${sdvxinId}${name}.htm`;
  }

  const name = short === 'WE' ? 'end' : 'ult';

  return `https://sdvx.in/chunithm/${name.slice(0, 3)}/${sdvxinId}${name}${endIndex ?? ''}.htm`;
}

/**
 * Jacket art host.
 *
 * The Japanese CDN, because it carries every song. The International one only
 * serves what is playable there and 404s on the rest, which would leave broken
 * images on exactly the pages about songs that have not arrived yet.
 *
 * One host and no fallbacks: filenames come from SEGA's own music list, so
 * they are always names this CDN knows. A row still holding a filename from
 * some earlier import will 404 until the next catalogue refresh overwrites it,
 * which is the right failure — a missing image that fixes itself, rather than
 * a second CDN kept alive to serve stale rows.
 */
const JACKET_HOST = 'https://new.chunithm-net.com/chuni-mobile/html/mobile/img';

export function jacketUrl(jacket: string | null): string | null {
  if (!jacket) return null;

  if (jacket.startsWith('http://') || jacket.startsWith('https://')) {
    return jacket;
  }

  return `${JACKET_HOST}/${jacket}`;
}

/** There is no official video, so link a search rather than guess a video id. */
export function youtubeSearchUrl(
  title: string,
  difficulty: Difficulty,
): string {
  const query = `CHUNITHM ${title} ${DIFFICULTY_SHORT[difficulty]}`;

  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
