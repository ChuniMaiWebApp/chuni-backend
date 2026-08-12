import { load } from 'cheerio';

import { LinkedGate } from '../linked-verse';
import { chuniInt, extractLastPart, parseChunithmDate } from './utils';

export interface LeaderboardEntry {
  position: number;
  playerName: string;
  score: number;
  /** How many times the player has ALL JUSTICE CRITICAL'd the chart. */
  ajcCount: number | null;
  achievedAt: string | null;
}

export interface Leaderboard {
  updatedAt: string | null;
  ranking: LeaderboardEntry[];
}

/**
 * CHUNITHM-NET prefixes the update date with a full-width colon, which is easy
 * to mistake for the ASCII one when editing this file.
 */
const UPDATE_PREFIX = 'Update on：';

function parseUpdatedAt(text: string | undefined): string | null {
  if (!text) return null;

  return parseChunithmDate(text.replace(UPDATE_PREFIX, '').trim());
}

/** Parses `POST /mobile/ranking/sendRankingDetail/` — a chart's leaderboard. */
export function parseLeaderboard(html: string): Leaderboard {
  const $ = load(html);
  const ranking: LeaderboardEntry[] = [];

  $('.rank_block').each((_, element) => {
    const block = $(element);
    const position = block.find('.rank_block_rank').first().text();
    const name = block.find('.rank_block_name').first().text();
    const score = block
      .find('.rank_score_block .rank_block_num')
      .first()
      .text();

    if (!position || !name || !score) return;

    const ajc = block
      .find('.rank_score_block .rank_block_theory_text')
      .first()
      .text();
    const achieved = block
      .find('.rank_block_date, .rank_block_date_new')
      .first()
      .text();

    ranking.push({
      position: chuniInt(position),
      playerName: name,
      score: chuniInt(score),
      ajcCount: ajc ? chuniInt(ajc) : null,
      achievedAt: parseChunithmDate(achieved),
    });
  });

  return {
    updatedAt: parseUpdatedAt($('.ranking_update').first().text()),
    ranking,
  };
}

export interface RankingEntry {
  position: number;
  playerName: string;
  /** Rating, total high score or currency, depending on which board this is. */
  value: number;
}

export interface Ranking {
  updatedAt: string | null;
  ranking: RankingEntry[];
}

/**
 * Parses the site-wide ranking pages (rating, total high score, total point).
 *
 * They share `rank_block_s` markup and differ only in which element holds the
 * value, so the caller says which one to read.
 */
export function parseRanking(
  html: string,
  valueSelector: string,
  readValue: (text: string, imageSources: string[]) => number,
): Ranking {
  const $ = load(html);
  const ranking: RankingEntry[] = [];

  $('.rank_block_s').each((_, element) => {
    const block = $(element);
    const position = block.find('.rank_block_rank_s').first().text();
    const name = block.find('.rank_block_name_s').first().text();
    const valueElement = block.find(valueSelector).first();

    if (!position || !name || valueElement.length === 0) return;

    const images = valueElement
      .find('img')
      .map((__, image) => $(image).attr('src') ?? '')
      .get();

    ranking.push({
      position: chuniInt(position),
      playerName: name,
      value: readValue(valueElement.text(), images),
    });
  });

  return {
    updatedAt: parseUpdatedAt($('.ranking_update').first().text()),
    ranking,
  };
}

/** Ratings are rendered as digit images, the same as on the player card. */
export function readRatingFromImages(_text: string, images: string[]): number {
  let digits = '';

  for (const source of images) {
    const part = extractLastPart(source);

    digits += part === 'comma' ? '.' : (part[1] ?? '');
  }

  const rating = Number.parseFloat(digits);

  return Number.isNaN(rating) ? 0 : rating;
}

export interface LinkedGateProgress {
  gate: LinkedGate;

  /**
   * The game's own badge art for this gate, in whatever state it is in.
   *
   * The only thing reported about a gate, and deliberately so. The hexagon
   * arrives already drawn for that state; there is nothing in the markup that
   * says which state it is, so anything more would have to come from a
   * hand-kept lookup of filename to meaning. There was one, and both times a
   * status was rendered from it the status disagreed with the picture beside
   * it — first calling every gate cleared, then calling cleared gates
   * uncleared. The picture was right on both occasions.
   */
  badgeUrl: string | null;
}

/** Parses `GET /mobile/home/linkedVerse/` — progress through the Linked GATEs. */
export function parseLinkedVerse(html: string): LinkedGateProgress[] {
  const $ = load(html);
  const gates = Object.values(LinkedGate);
  const result: LinkedGateProgress[] = [];

  $('.linked_verse_icon_status_block .linked_verse_icon_block img').each(
    (index, element) => {
      // Which gate this is comes from its position: the page renders them in
      // release order and names none of them.
      const gate = gates[index];

      if (gate === undefined) return;

      const source = $(element).attr('src');

      result.push({
        gate,
        // The page builds these with a doubled slash after the host.
        badgeUrl: source ? source.replace(/([^:])\/\//g, '$1/') : null,
      });
    },
  );

  return result;
}
