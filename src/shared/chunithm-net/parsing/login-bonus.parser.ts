import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import { chuniInt, extractLastPart } from './utils';

export interface LoginBonusItem {
  day: number;
  name: string;
  iconUrl: string | null;
  obtained: boolean;
}

export interface MonthlyLoginBonus {
  name: string;
  daysLoggedIn: number;
  rewards: LoginBonusItem[];
}

export interface DailyBonus {
  /** 0 = Monday, matching `Date.getDay()` shifted so the week starts Monday. */
  weekday: number;
  bonus: string;
  iconUrl: string | null;
  isToday: boolean;
}

export interface LoginBonus {
  receivedToday: boolean;
  monthly: MonthlyLoginBonus[];
  streak: LoginBonusItem[];
  daily: DailyBonus[];
}

const WEEKDAYS: Record<string, number> = {
  'Mon.': 0,
  'Tue.': 1,
  'Wed.': 2,
  'Thu.': 3,
  'Fri.': 4,
  'Sat.': 5,
  'Sun.': 6,
};

function parseReward(
  $: CheerioAPI,
  element: Cheerio<Element>,
  iconSelector: string,
  obtainedSelector: string,
): LoginBonusItem | null {
  const dayBlock = element.find('.bonus_days_block').first();

  if (dayBlock.length === 0) return null;

  return {
    day: chuniInt(dayBlock.text().replace('Day ', '')),
    name: element.find('.bonus_reward_honor_text').first().text().trim(),
    iconUrl: element.find(iconSelector).first().attr('src') ?? null,
    obtained: element.find(obtainedSelector).length > 0,
  };
}

/**
 * Parses `GET /mobile/loginBonus/`.
 *
 * Three separate tracks share the page: a per-month cumulative reward table, a
 * consecutive-login streak, and a fixed weekday bonus rota.
 */
export function parseLoginBonus(html: string): LoginBonus {
  const $ = load(html);

  // The page states today's status in prose rather than in a class.
  const statusText = $('*:contains("Today\'s Login Bonus")').last().text();

  const monthly: MonthlyLoginBonus[] = [];

  $('.frame01_inside > div > div.w420').each((_, element) => {
    const block = $(element);
    const name = block.find('.box01_title').first().text().trim();

    // Days logged in is rendered one digit per image.
    let days = 0;
    block
      .find('.monthly_cumulative_login_bonus_days_count_num img')
      .each((__, image) => {
        const source = $(image).attr('src');

        if (source) days = days * 10 + Number(extractLastPart(source));
      });

    const rewards: LoginBonusItem[] = [];

    block
      .find(
        '.monthly_cumulative_login_bonus_reward, .monthly_cumulative_login_bonus_reward_off',
      )
      .each((__, reward) => {
        const item = parseReward(
          $,
          $(reward),
          '.monthly_cumulative_login_bonus_reward_img img',
          '.monthly_cumulative_login_bonus_reward_get',
        );

        if (item) rewards.push(item);
      });

    if (name || rewards.length > 0) {
      monthly.push({ name, daysLoggedIn: days, rewards });
    }
  });

  const streak: LoginBonusItem[] = [];

  $('.bonus_block_on, .bonus_block_off').each((_, element) => {
    const item = parseReward(
      $,
      $(element),
      '.bonus_reward_block img',
      '.bonus_reward_get',
    );

    if (item) streak.push(item);
  });

  const daily: DailyBonus[] = [];

  $('.weekday_bonus_block, .weekday_bonus_today').each((_, element) => {
    const block = $(element);
    const name = block.find('.weekday_bonus_week').first().text().trim();
    const weekday = WEEKDAYS[name];

    if (weekday === undefined) return;

    daily.push({
      weekday,
      bonus: block.find('.weekday_bonus_info_text').first().text().trim(),
      iconUrl:
        block.find('.weekday_bonus_info_icon img').first().attr('src') ?? null,
      isToday: (block.attr('class') ?? '').includes('weekday_bonus_today'),
    });
  });

  return {
    receivedToday:
      statusText.length > 0 && !statusText.includes('Not achieved'),
    monthly,
    streak,
    daily,
  };
}
