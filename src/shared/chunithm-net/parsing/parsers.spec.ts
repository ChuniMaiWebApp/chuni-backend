import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'cheerio';

import {
  ChainLamp,
  ClearLamp,
  ComboLamp,
  Difficulty,
  Possession,
  Rank,
  rankFromScore,
} from '../chunithm-net.types';
import {
  parseCollectionCustomise,
  parseHomePage,
  parsePlayerCard,
  parsePlayerData,
} from './profile.parser';
import {
  parseMusicList,
  parsePlaylog,
  parsePlaylogDetail,
} from './record.parser';

/**
 * Fixtures are real CHUNITHM-NET responses — SEGA's own markup, saved to disk.
 * Parsing it is guesswork without them, and a live account cannot be a test
 * dependency: the scores move, and the tests would fail for reasons that have
 * nothing to do with the parser.
 *
 * Recapture them from an account of your own with:
 *   npx ts-node scripts/capture-fixtures.ts
 * Expect assertions on player name, scores and dates to need updating with
 * them — they describe whichever profile produced the capture.
 */
const fixture = (name: string) =>
  readFileSync(
    join(__dirname, '../../../../test/fixtures/chunithm-net', name),
    'utf-8',
  );

describe('parsePlayerData', () => {
  const profile = parsePlayerData(fixture('player_data.html'));

  it('reads the player card', () => {
    expect(profile.username).toBe('ＢｏＡｎｈＤＬＢ');
    expect(profile.level).toBe(11);
    // Rendered as the digit images 1, 5, comma, 1, 0.
    expect(profile.rating).toBeCloseTo(15.1, 2);
    expect(profile.possession).toBe(Possession.NONE);
  });

  it('reads the digit-image rating and the overpower pair', () => {
    expect(profile.overPower).toEqual({ value: 4878.18, percentage: 5.68 });
  });

  it('reads currency, credits and the hidden friend code', () => {
    expect(profile.currency).toEqual({ owned: 133_500, total: 136_000 });
    expect(profile.friendCode).toBe('1234567890123');
    expect(profile.totalCredits).toBe(70);
  });

  it('collects equipped titles', () => {
    expect(profile.titles.length).toBeGreaterThan(0);
    // An ordinary title: a named rarity plate with the wording in the DOM, so
    // it can be redrawn rather than shown as artwork.
    expect(profile.titles[0]).toEqual({
      content: 'ネコぱら',
      rarity: 'silver',
      imageUrl: null,
    });
  });

  it('hands a collaboration title back as its own artwork', () => {
    // These bake the wording into the image, so there is nothing in the DOM to
    // read. Rather than look the filename up in a table — which can only cover
    // titles somebody already catalogued — the image is passed through and
    // drawn as the game drew it.
    const html = `
      <div class="player_honor_short"
           style="background-image:url(https://chunithm-net-eng.com/mobile/img/ddd90be40f2a38ec.png)">
      </div>`;
    const { titles } = parsePlayerCard(load(html));

    expect(titles).toEqual([
      {
        content: '',
        rarity: 'special',
        imageUrl:
          'https://chunithm-net-eng.com/mobile/img/ddd90be40f2a38ec.png',
      },
    ]);
  });

  it('reads the last play date as an instant, not a naive string', () => {
    // 2023/08/04 18:34 JST
    expect(profile.lastPlayed).toBe('2023-08-04T09:34:00.000Z');
  });
});

describe('parseCollectionCustomise', () => {
  const collections = parseCollectionCustomise(
    fixture('collection_customise.html'),
  );

  it('reads the nameplate, which is the banner shown under the player card', () => {
    expect(collections.nameplate).toBe(
      'https://chunithm-net-eng.com/mobile/img/14c0bda1b8026041.png',
    );
  });

  it('reads the other equipped cosmetics too', () => {
    expect(collections.mapIcon).toMatch(/^https:\/\/chunithm-net-eng\.com/);
    expect(collections.systemVoice).toMatch(/^https:\/\/chunithm-net-eng\.com/);
  });
});

describe('parseHomePage', () => {
  it('reads enough of the card to validate a session', () => {
    const profile = parseHomePage(fixture('logged_in_homepage.html'));

    expect(profile.username).toBeTruthy();
    expect(profile.rating).toBeGreaterThan(0);
  });
});

describe('parsePlaylog', () => {
  const records = parsePlaylog(fixture('playlog.html'));

  it('reads every entry on the page', () => {
    expect(records).toHaveLength(50);
  });

  it('reads the newest play', () => {
    const [newest] = records;

    expect(newest.song.title).toBeTruthy();
    expect(newest.score).toBeGreaterThan(0);
    expect(newest.trackNo).toBeGreaterThanOrEqual(1);
    expect(newest.playlogIndex).not.toBeNull();
    expect(newest.achievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('resolves the lazy-loaded jacket url', () => {
    expect(records.every((record) => record.song.jacketUrl)).toBe(true);
  });

  it('assigns a difficulty to every entry', () => {
    const difficulties = new Set(records.map((r) => r.chart.difficulty));

    expect(difficulties.size).toBeGreaterThan(0);
    for (const difficulty of difficulties) {
      expect(Difficulty[difficulty]).toBeDefined();
    }
  });

  it('derives the rank from the score when no badge is shown', () => {
    for (const record of records) {
      if (record.score >= 1_009_000) expect(record.rank).toBe(Rank.SSSP);
      if (record.score < 500_000) expect(record.rank).toBe(Rank.D);
    }
  });
});

describe('parsePlaylogDetail', () => {
  const record = parsePlaylogDetail(fixture('playlog_detail.html'));

  it('reads judgements and note accuracy', () => {
    expect(record.judgements).not.toBeNull();
    expect(record.judgements!.justiceCritical).toBeGreaterThan(0);

    expect(record.notePercentage).not.toBeNull();
    expect(record.notePercentage!.tap).toBeGreaterThan(0);
  });

  it('reads max combo, character and skill', () => {
    expect(record.maxCombo).toBeGreaterThan(0);
    expect(record.character).toBeTruthy();
    expect(record.skill?.name).toBeTruthy();
  });

  it('resolves the song id, which the list page does not expose', () => {
    expect(record.song.id).not.toBeNull();
  });
});

describe('parseMusicList', () => {
  it('reads the best30 rating page', () => {
    const records = parseMusicList(fixture('best30.html'));

    expect(records).toHaveLength(30);
    expect(records[0].song.id).not.toBeNull();
    expect(records[0].score).toBeGreaterThan(0);

    // The best30 list is ordered by play rating, so scores trend downward.
    expect(records[0].score).toBeGreaterThan(records[29].score - 50_000);
  });

  it('reads the recent10 rating page', () => {
    const records = parseMusicList(fixture('recent10.html'));

    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.song.title.length > 0)).toBe(true);
  });

  /**
   * Regression: the rating detail pages carry no badge markup whatsoever, and
   * defaulting the lamps made every best50 entry render as FAILED and stripped
   * the FULL COMBO / ALL JUSTICE bonus out of OVER POWER.
   */
  it('reports lamps as unknown on pages that have no badges', () => {
    const html = fixture('best30.html');

    expect(html).not.toContain('play_musicdata_icon');

    for (const record of parseMusicList(html)) {
      expect(record.clearLamp).toBeNull();
      expect(record.comboLamp).toBeNull();
      expect(record.chainLamp).toBeNull();
    }
  });

  it('still derives rank from the score when no rank badge exists', () => {
    for (const record of parseMusicList(fixture('best30.html'))) {
      expect(record.rank).toBe(rankFromScore(record.score));
    }
  });

  it('reads real lamps from pages that do have badges', () => {
    const records = parsePlaylog(fixture('playlog.html'));
    const withBadges = records.filter((record) => record.clearLamp !== null);

    expect(withBadges.length).toBeGreaterThan(0);

    for (const record of withBadges) {
      expect(Object.values(ClearLamp)).toContain(record.clearLamp);
      expect(Object.values(ComboLamp)).toContain(record.comboLamp);
      expect(Object.values(ChainLamp)).toContain(record.chainLamp);
    }
  });
});
