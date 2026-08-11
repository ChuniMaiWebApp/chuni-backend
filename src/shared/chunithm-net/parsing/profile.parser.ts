import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import {
  Possession,
  SkillClass,
  type Profile,
  type Team,
  type Title,
} from '../chunithm-net.types';
import {
  backgroundImageUrl,
  chuniInt,
  extractLastPart,
  parseChunithmDate,
  parsePlayerRating,
} from './utils';

const TEAM_EMBLEM_SELECTOR = [
  'normal',
  'silver',
  'gold',
  'rainbow',
  'purple',
  'red',
  'yellow',
  'green',
]
  .map((colour) => `.player_team_emblem_${colour}`)
  .join(', ');

/**
 * Titles ("trophies") come in two flavours.
 *
 * Ordinary ones are a rarity plate with the text written over it: the plate is
 * named in the background filename (`honor_bg_platina.png`) and the text sits
 * in the DOM, so both halves can be read and redrawn.
 *
 * Collaboration ones are a single finished image with the wording already
 * baked in. Nothing in the DOM says what it reads — so rather than carry a
 * lookup table of filename to wording, which can only ever cover the titles
 * somebody has already catalogued, the image itself is handed on and drawn as
 * the game drew it. Same decision, and for the same reason, as the Linked GATE
 * hexagons: nothing redrawn here would be more recognisable to a player than
 * the artwork already on the cabinet.
 */
function parseTitle($: CheerioAPI, element: Cheerio<Element>): Title | null {
  const url = backgroundImageUrl(element.attr('style'));

  if (!url) return null;

  const filename = url.split('/').pop() ?? '';

  if (filename.startsWith('honor_bg_')) {
    const rarity = filename.split('.')[0].slice('honor_bg_'.length);

    // The player has an empty title slot.
    if (rarity === 'noSet') return null;

    const content = element
      .find('.player_honor_text span, .honor_now_text span')
      .first()
      .text();

    if (!content) return null;

    return { content, rarity, imageUrl: null };
  }

  return { content: '', rarity: 'special', imageUrl: url };
}

function parseSkillClass(
  $: CheerioAPI,
  root: Cheerio<Element>,
  selector: string,
): SkillClass | null {
  const src = root.find(selector).first().attr('src');

  if (!src) return null;

  const value = chuniInt(extractLastPart(src));

  return value in SkillClass ? value : null;
}

/**
 * Parses the player card that appears on the home page, the PLAYER DATA page
 * and inside every friend entry.
 *
 * `root` lets the same code read a friend's card out of a larger document.
 */
export function parsePlayerCard(
  $: CheerioAPI,
  root: Cheerio<Element> = $.root() as unknown as Cheerio<Element>,
): Profile {
  const charaElement = root.find('.player_chara').first();
  const charaFrame = backgroundImageUrl(charaElement.attr('style'));

  const nameElement = root.find('.player_name_in').first();
  const nameForm = nameElement.find('form').first();

  // On a friend's card the name is a link and the friend code is a hidden
  // input; on your own card it is plain text.
  const username = nameForm.length
    ? nameForm.find('a').first().text()
    : nameElement.text();
  const friendCode = nameForm.length
    ? (nameForm.find('input[name=idx]').first().attr('value') ?? null)
    : null;

  const teamName = root.find('.player_team_name').first().text() || null;
  const teamEmblemClass = root.find(TEAM_EMBLEM_SELECTOR).first().attr('class');
  const team: Team | null =
    teamName && teamEmblemClass
      ? { name: teamName, emblem: extractLastPart(teamEmblemClass) }
      : null;

  const titles: Title[] = [];
  root.find('.player_honor_short').each((_, element) => {
    const title = parseTitle($, $(element));

    if (title) titles.push(title);
  });

  const overpowerText = root.find('.player_overpower_text').first().text();
  const overpowerMatch = overpowerText.match(/([\d.]+)\s*\(([\d.]+)%\)/);

  const rebornText = root.find('.player_reborn').first().text();

  const possessionStyle = root.find('.box_playerprofile').first().attr('style');
  const possessionUrl = backgroundImageUrl(possessionStyle);
  const possessionName = possessionUrl ? extractLastPart(possessionUrl) : null;
  const possession = Object.values(Possession).includes(
    possessionName as Possession,
  )
    ? (possessionName as Possession)
    : Possession.NONE;

  return {
    username,
    level: root.find('.player_lv').length
      ? chuniInt(root.find('.player_lv').first().text())
      : null,
    reincarnationStars: rebornText ? chuniInt(rebornText) : 0,
    rating: parsePlayerRating($, root.find('.player_rating_num_block img')),
    overPower: overpowerMatch
      ? {
          value: Number.parseFloat(overpowerMatch[1]),
          percentage: Number.parseFloat(overpowerMatch[2]),
        }
      : null,
    titles,
    team,
    possession,
    // The base emblem is awarded for clearing one course of a class, the top
    // one for clearing every course of that class.
    emblem: parseSkillClass($, root, '.player_classemblem_base img'),
    medal: parseSkillClass($, root, '.player_classemblem_top img'),
    profilePicture: charaElement.find('img').first().attr('src') ?? null,
    profilePictureFrame: charaFrame,
    banner: null,
    friendCode,
    currency: null,
    totalCredits: null,
    lastPlayed: parseChunithmDate(
      root.find('.player_lastplaydate_text').first().text(),
    ),
  };
}

/** Parses `GET /mobile/home/playerData`, which adds currency and play count. */
export function parsePlayerData(html: string): Profile {
  const $ = load(html);
  const root = $.root() as unknown as Cheerio<Element>;
  const profile = parsePlayerCard($, root);

  const owned = root.find('.user_data_point .user_data_text').first().text();
  const total = root
    .find('.user_data_total_point .user_data_text')
    .first()
    .text();

  if (owned || total) {
    profile.currency = { owned: chuniInt(owned), total: chuniInt(total) };
  }

  const playCount = root
    .find('.user_data_play_count .user_data_text')
    .first()
    .text();

  if (playCount) profile.totalCredits = chuniInt(playCount);

  // The friend code sits in a span that the page keeps hidden until tapped.
  const friendCode = root
    .find('.user_data_friend_code .user_data_text span:not(.font_90)')
    .first()
    .text();

  if (friendCode) profile.friendCode = friendCode.trim();

  return profile;
}

export interface PlayerCollections {
  /** The wide artwork shown under the player card — CHUNITHM calls it a Name Plate. */
  nameplate: string | null;
  mapIcon: string | null;
  systemVoice: string | null;
  /** Titles as configured, which can differ from the three shown on the card. */
  titles: Title[];
}

/**
 * Parses `GET /mobile/collection/customise`.
 *
 * The nameplate lives here rather than on the player data page, so showing a
 * banner costs a second request. Map icon and system voice come along free.
 */
export function parseCollectionCustomise(html: string): PlayerCollections {
  const $ = load(html);
  const root = $.root() as unknown as Cheerio<Element>;

  const titles: Title[] = [];
  root.find('.honor_now').each((_, element) => {
    const title = parseTitle($, $(element));

    if (title) titles.push(title);
  });

  const image = (selector: string) =>
    root.find(`${selector} img`).first().attr('src') ?? null;

  return {
    nameplate: image('.nameplate_now'),
    mapIcon: image('.mapicon_now'),
    systemVoice: image('.systemvoice_now'),
    titles,
  };
}

/** Parses the home page, used as a cheap "is this token still valid" probe. */
export function parseHomePage(html: string): Profile {
  const $ = load(html);

  return parsePlayerCard($, $.root() as unknown as Cheerio<Element>);
}
