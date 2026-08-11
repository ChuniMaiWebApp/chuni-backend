import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Difficulty } from '../chunithm-net.types';
import { parseMusicCatalogue } from './catalogue.parser';
import { parseMusicList } from './record.parser';

const fixture = (name: string) =>
  readFileSync(
    join(__dirname, '../../../../test/fixtures/chunithm-net', name),
    'utf-8',
  );

/**
 * The distinction this parser exists for: `parseMusicList` answers "what has
 * the player scored", this one answers "what does the server carry". On a
 * rating detail page every entry has a score, so both agree — the difference
 * only shows on a full music list, which is exactly where it matters.
 */
describe('parseMusicCatalogue', () => {
  it('reads every chart on a rating detail page', () => {
    const charts = parseMusicCatalogue(fixture('best30.html'));

    expect(charts.length).toBeGreaterThan(20);

    for (const chart of charts) {
      expect(Number.isInteger(chart.songId)).toBe(true);
      expect(chart.songId).toBeGreaterThan(0);
      expect(Object.values(Difficulty)).toContain(chart.difficulty);
      expect(chart.title.length).toBeGreaterThan(0);
    }
  });

  it('takes the difficulty from the posted field, not the styling', () => {
    const charts = parseMusicCatalogue(fixture('best30.html'));

    // best30.html is a Best-30 page, whose entries are whatever the player
    // rates on — mixed difficulties, all read from `input[name=diff]`.
    expect(charts.some((c) => c.difficulty === Difficulty.EXPERT)).toBe(true);
  });

  it('keeps a chart that has no score, unlike parseMusicList', () => {
    // A music list page shows every chart; only the played ones carry a score
    // block. Stripping the score is what an untouched chart looks like.
    const withScore = `
      <form>
        <div class="w388 musiclist_box bg_master">
          <div class="music_title">Played Song</div>
          <div class="play_musicdata_highscore">SCORE：<span class="text_b">1,005,000</span></div>
          <input type="hidden" name="diff" value="3"/>
          <input type="hidden" name="idx" value="111"/>
        </div>
      </form>`;
    const withoutScore = `
      <form>
        <div class="w388 musiclist_box bg_master">
          <div class="music_title">Never Played</div>
          <input type="hidden" name="diff" value="3"/>
          <input type="hidden" name="idx" value="222"/>
        </div>
      </form>`;
    const html = `<html><body>${withScore}${withoutScore}</body></html>`;

    expect(parseMusicList(html)).toHaveLength(1);

    const charts = parseMusicCatalogue(html);

    expect(charts).toHaveLength(2);
    expect(charts.map((c) => c.songId)).toEqual([111, 222]);
    expect(charts[1]).toMatchObject({
      songId: 222,
      difficulty: Difficulty.MASTER,
      title: 'Never Played',
    });
  });

  it('does not count the same chart twice', () => {
    const entry = `
      <form>
        <div class="w388 musiclist_box bg_ultima">
          <div class="music_title">Doubled</div>
          <input type="hidden" name="diff" value="4"/>
          <input type="hidden" name="idx" value="999"/>
        </div>
      </form>`;

    expect(parseMusicCatalogue(`${entry}${entry}`)).toHaveLength(1);
  });

  it('ignores forms that are not music entries', () => {
    const html = `
      <form><input type="hidden" name="token" value="abc"/></form>
      <form>
        <div class="w388 musiclist_box bg_basic">
          <div class="music_title">Real</div>
          <input type="hidden" name="diff" value="0"/>
          <input type="hidden" name="idx" value="7"/>
        </div>
      </form>`;

    expect(parseMusicCatalogue(html)).toHaveLength(1);
  });

  /**
   * The WORLD'S END list has no `diff` field — the page is already about one
   * difficulty. An earlier version required the field and so read that whole
   * page as empty, which looked like success: 6,259 charts found, every
   * WORLD'S END entry missing.
   */
  it('falls back to the box class when the page posts no difficulty', () => {
    const html = `
      <form>
        <div class="w388 musiclist_box bg_worldsend">
          <div class="musiclist_worldsend_title">Ｌｅｇｅｎｄａｒｙ</div>
          <input type="hidden" name="idx" value="8042"/>
        </div>
      </form>`;

    expect(parseMusicCatalogue(html)).toEqual([
      {
        songId: 8042,
        difficulty: Difficulty.WORLDS_END,
        title: 'Ｌｅｇｅｎｄａｒｙ',
      },
    ]);
  });

  it('prefers the posted difficulty over the styling when both are present', () => {
    // If the two ever disagree, the field SEGA posts back is the one that
    // identifies the chart; the class is decoration.
    const html = `
      <form>
        <div class="w388 musiclist_box bg_basic">
          <div class="music_title">Mismatched</div>
          <input type="hidden" name="diff" value="3"/>
          <input type="hidden" name="idx" value="55"/>
        </div>
      </form>`;

    expect(parseMusicCatalogue(html)[0].difficulty).toBe(Difficulty.MASTER);
  });

  it('drops an entry whose difficulty is not one the game has', () => {
    const html = `
      <form>
        <div class="w388 musiclist_box">
          <div class="music_title">Bogus</div>
          <input type="hidden" name="diff" value="42"/>
          <input type="hidden" name="idx" value="7"/>
        </div>
      </form>`;

    expect(parseMusicCatalogue(html)).toEqual([]);
  });
});
