import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import {
  ChainLamp,
  ClearLamp,
  ComboLamp,
  Difficulty,
  Rank,
} from '../chunithm-net.types';

/** CHUNITHM-NET renders every timestamp in JST with no timezone marker. */
export const CHUNITHM_TIMEZONE_OFFSET = '+09:00';

/** Parses `1,234,567` into a number. */
export function chuniInt(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  const value = Number.parseInt(cleaned, 10);

  return Number.isNaN(value) ? 0 : value;
}

/**
 * `.../rating_gold_01.png` -> `01`, `.../profile_normal.png` -> `normal`.
 *
 * CHUNITHM-NET encodes most state in image filenames, so this tiny helper is
 * how almost everything gets read.
 */
export function extractLastPart(url: string): string {
  const [last = ''] = url.split('_').slice(-1);

  return last.split('.')[0] ?? '';
}

/**
 * Converts `2026/08/04 21:12` (JST) into an ISO 8601 instant.
 * Returns `null` for the placeholder the game uses for "never".
 */
export function parseChunithmDate(raw: string): string | null {
  const text = raw.trim();

  if (!text || text.startsWith('----')) return null;

  const match = text.match(
    /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/,
  );

  if (!match) return null;

  const [, year, month, day, hour, minute, second = '00'] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${CHUNITHM_TIMEZONE_OFFSET}`;
  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The player rating is rendered as one image per digit, so it has to be read
 * back character by character.
 */
export function parsePlayerRating($: CheerioAPI, images: Cheerio<Element>) {
  let digits = '';

  images.each((_, element) => {
    const src = $(element).attr('src');

    if (!src) return;

    const part = extractLastPart(src);
    digits += part === 'comma' ? '.' : (part[1] ?? '');
  });

  const rating = Number.parseFloat(digits);

  return Number.isNaN(rating) ? 0 : rating;
}

export function difficultyFromImageUrl(url: string): Difficulty {
  switch (extractLastPart(url)) {
    case 'basic':
      return Difficulty.BASIC;
    case 'advanced':
      return Difficulty.ADVANCED;
    case 'expert':
      return Difficulty.EXPERT;
    case 'master':
      return Difficulty.MASTER;
    case 'ultima':
    case 'ultimate':
      return Difficulty.ULTIMA;
    case 'worldsend':
      return Difficulty.WORLDS_END;
    default:
      throw new Error(`Unknown difficulty in ${url}`);
  }
}

export interface RankAndLamps {
  rank: Rank;
  clearLamp: ClearLamp;
  comboLamp: ComboLamp;
  chainLamp: ChainLamp;
}

/**
 * Reads rank and lamps out of the badge images inside `scope`.
 *
 * Order matters: `fullchain2` must be tested before `fullchain`, because the
 * former's filename contains the latter.
 */
export function getRankAndLamps(
  $: CheerioAPI,
  scope: Cheerio<Element>,
): RankAndLamps {
  const rankImage = scope.find('img[src*="_rank_"]').first().attr('src');
  const rank = rankImage
    ? Number.parseInt(extractLastPart(rankImage), 10) || 0
    : Rank.D;

  const has = (needle: string) =>
    scope.find(`img[src*="${needle}"]`).length > 0;

  let clearLamp = ClearLamp.FAILED;
  if (has('clear')) clearLamp = ClearLamp.CLEAR;
  else if (has('hard')) clearLamp = ClearLamp.HARD;
  else if (has('absolute')) clearLamp = ClearLamp.ABSOLUTE;
  else if (has('brave')) clearLamp = ClearLamp.BRAVE;
  else if (has('catastrophy')) clearLamp = ClearLamp.CATASTROPHY;

  let chainLamp = ChainLamp.NONE;
  if (has('fullchain2')) chainLamp = ChainLamp.FULL_CHAIN;
  else if (has('fullchain')) chainLamp = ChainLamp.FULL_CHAIN_PLUS;

  // FULL COMBO / ALL JUSTICE override any clear lamp shown alongside them.
  let comboLamp = ComboLamp.NONE;
  if (has('fullcombo')) comboLamp = ComboLamp.FULL_COMBO;
  else if (has('alljusticecritical'))
    comboLamp = ComboLamp.ALL_JUSTICE_CRITICAL;
  else if (has('alljustice')) comboLamp = ComboLamp.ALL_JUSTICE;

  return { rank, clearLamp, comboLamp, chainLamp };
}

/** Pulls `url(...)` out of an inline `background-image` declaration. */
export function backgroundImageUrl(style: string | undefined): string | null {
  if (!style) return null;

  const match = style.match(/background-image\s*:\s*url\(['"]?(.+?)['"]?\)/);

  return match?.[1] ?? null;
}
