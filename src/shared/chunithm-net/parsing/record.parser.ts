import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import {
  Rank,
  rankFromScore,
  type Judgements,
  type NotePercentage,
  type PersonalBest,
  type RecentScore,
} from '../chunithm-net.types';
import {
  chuniInt,
  difficultyFromImageUrl,
  getRankAndLamps,
  parseChunithmDate,
} from './utils';

/**
 * No badge block on the page means the page simply does not carry lamps, so
 * they are reported as unknown rather than invented as FAILED/NONE.
 *
 * Within a badge block the absence of a clear icon is meaningful — that is a
 * genuine fail — and {@link getRankAndLamps} handles it.
 */
const UNKNOWN_LAMPS = {
  rank: Rank.D,
  clearLamp: null,
  comboLamp: null,
  chainLamp: null,
};

function baseScore() {
  return {
    maxCombo: null,
    judgements: null,
    notePercentage: null,
    rating: null,
    overpower: null,
    maxOverpower: null,
    judgementLoss: null,
  };
}

/**
 * Parses one entry of the playlog list, or the summary block at the top of a
 * playlog detail page — the markup is the same in both places.
 */
export function parseBasicRecentRecord(
  $: CheerioAPI,
  block: Cheerio<Element>,
): RecentScore {
  const jacketElement = block.find('.play_jacket_img img').first();
  // Jackets are lazy-loaded, so the real URL hides in data-original.
  const jacketUrl =
    jacketElement.attr('data-original') ?? jacketElement.attr('src') ?? null;

  const trackText = block.find('.play_track_text').first().text();
  const trackNo = trackText ? chuniInt(trackText.split(' ')[1] ?? '') : null;

  const iconBlock = block.find('.play_musicdata_icon').first();
  const lamps = iconBlock.length
    ? getRankAndLamps($, iconBlock)
    : { ...UNKNOWN_LAMPS };

  const score = chuniInt(
    block.find('.play_musicdata_score_text').first().text(),
  );

  const difficultyImage = block
    .find('.play_track_result img')
    .first()
    .attr('src');

  const playlogIndexRaw = block
    .find('form input[name=idx]')
    .first()
    .attr('value');

  return {
    song: {
      id: null,
      title: block.find('.play_musicdata_title').first().text(),
      jacketUrl,
    },
    chart: {
      difficulty: difficultyFromImageUrl(difficultyImage ?? ''),
      level: null,
      internalLevel: null,
      maxCombo: null,
    },
    score,
    // Pages without a rank badge still give the score, and rank is a pure
    // function of score, so derive it rather than reporting a false D.
    rank: lamps.rank === Rank.D ? rankFromScore(score) : lamps.rank,
    clearLamp: lamps.clearLamp,
    comboLamp: lamps.comboLamp,
    chainLamp: lamps.chainLamp,
    achievedAt: parseChunithmDate(
      block.find('.play_datalist_date, .box_inner01').first().text(),
    ),
    trackNo,
    isNewRecord: block.find('.play_musicdata_score_img').length > 0,
    character: null,
    skill: null,
    skillResult: null,
    playlogIndex: playlogIndexRaw ? chuniInt(playlogIndexRaw) : null,
    ...baseScore(),
  };
}

/** Parses `GET /mobile/record/playlog` — the 50 most recent plays. */
export function parsePlaylog(html: string): RecentScore[] {
  const $ = load(html);
  const records: RecentScore[] = [];

  $('.frame02.w400').each((_, element) => {
    records.push(parseBasicRecentRecord($, $(element)));
  });

  return records;
}

/**
 * Parses `POST /mobile/record/playlog/sendPlaylogDetail/`, which adds
 * judgements, note accuracy, max combo and the character/skill used.
 */
export function parsePlaylogDetail(html: string): RecentScore {
  const $ = load(html);
  const record = parseBasicRecentRecord($, $('.frame01_inside').first());

  const judgementCount = (className: string) =>
    chuniInt($(`.${className}.play_data_detail_judge_text`).first().text());
  const notePercentage = (className: string) =>
    Number.parseFloat(
      $(`.${className}.play_data_detail_notes_text`)
        .first()
        .text()
        .replace('%', ''),
    ) || 0;

  const maxComboText = $('.play_data_detail_maxcombo_block').first().text();
  if (maxComboText) record.maxCombo = chuniInt(maxComboText);

  const judgements: Judgements = {
    justiceCritical: judgementCount('text_critical'),
    justice: judgementCount('text_justice'),
    attack: judgementCount('text_attack'),
    miss: judgementCount('text_miss'),
  };

  // A detail page with no judgements at all means the play predates the data.
  const hasJudgements =
    $('.play_data_detail_judge_text').length > 0 &&
    Object.values(judgements).some((value) => value > 0);

  record.judgements = hasJudgements ? judgements : null;

  const notes: NotePercentage = {
    tap: notePercentage('text_tap_red'),
    hold: notePercentage('text_hold_yellow'),
    slide: notePercentage('text_slide_blue'),
    air: notePercentage('text_air_green'),
    flick: notePercentage('text_flick_skyblue'),
  };

  record.notePercentage =
    $('.play_data_detail_notes_text').length > 0 ? notes : null;

  const character = $('.play_data_chara_name').first().text();
  if (character) record.character = character;

  const skillName = $('.play_data_skill_name').first().text();
  if (skillName) {
    const gradeText = $('.play_data_skill_grade').first().text();

    record.skill = {
      name: skillName,
      grade: gradeText ? chuniInt(gradeText) : null,
    };
  }

  const skillResult = $('.play_musicdata_skilleffect_text').first().text();
  if (skillResult) record.skillResult = chuniInt(skillResult.replace('+', ''));

  const songId = $('form input[name=idx]').first().attr('value');
  if (songId) record.song.id = chuniInt(songId);

  return record;
}

/**
 * Parses any of the "music list" pages: the rating detail pages
 * (`ratingDetailBest` / `ratingDetailRecent`) and the per-genre and per-level
 * record lists. They all share the same `musiclist_box` markup.
 */
export function parseMusicList(html: string): PersonalBest[] {
  const $ = load(html);
  const records: PersonalBest[] = [];

  $('form').each((_, element) => {
    const form = $(element);
    const box = form.find('.w388.musiclist_box').first();

    if (!box.length) return;

    const scoreElement = form.find('.play_musicdata_highscore .text_b').first();

    // Charts the player has never touched have no high score element.
    if (!scoreElement.length) return;

    const iconBlock = form.find('.play_musicdata_icon').first();
    const lamps = iconBlock.length
      ? getRankAndLamps($, iconBlock)
      : { ...UNKNOWN_LAMPS };

    const score = chuniInt(scoreElement.text());
    const songId = form.find('input[name=idx]').first().attr('value');

    records.push({
      song: {
        id: songId ? chuniInt(songId) : null,
        title: form
          .find('.music_title, .musiclist_worldsend_title')
          .first()
          .text(),
        jacketUrl: null,
      },
      chart: {
        difficulty: difficultyFromImageUrl(box.attr('class') ?? ''),
        level: null,
        internalLevel: null,
        maxCombo: null,
      },
      score,
      rank: lamps.rank === Rank.D ? rankFromScore(score) : lamps.rank,
      clearLamp: lamps.clearLamp,
      comboLamp: lamps.comboLamp,
      chainLamp: lamps.chainLamp,
      achievedAt: null,
      playCount: null,
      ajcCount: null,
      ...baseScore(),
    });
  });

  return records;
}
