import {
  DIFFICULTY_SHORT,
  Difficulty,
} from '../../shared/chunithm-net/chunithm-net.types';

/**
 * Builds a link to the chart view on sdvx.in.
 *
 * sdvx.in files off normal charts by the first two digits of the chart id, but
 * ULTIMA and WORLD'S END live in their own directories and append an index to
 * disambiguate the several WORLD'S END charts a song can have. Ported from
 * chuni-penguin so the two stay in sync.
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
 * The Japanese CDN carries every song; the International one only carries what
 * is playable there and 404s on the rest. Since the song database includes
 * songs not yet released internationally, using the International host leaves
 * broken images on exactly those pages.
 */
const JACKET_HOST = 'https://new.chunithm-net.com/chuni-mobile/html/mobile/img';
const ZETARAKU_JACKET_HOST =
  'https://dp4p6x0xfi5o9.cloudfront.net/chunithm/img/cover';

export function jacketUrl(jacket: string | null): string | null {
  if (!jacket) return null;
  if (jacket.startsWith('http://') || jacket.startsWith('https://')) {
    return jacket;
  }

  // Zetaraku (arcade-songs) uses sha256 png hashes (e.g. 41d47015...png).
  if (jacket.endsWith('.png') || jacket.length > 30) {
    return `${ZETARAKU_JACKET_HOST}/${jacket}`;
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
