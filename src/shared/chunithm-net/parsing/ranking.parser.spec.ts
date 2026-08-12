import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LinkedGate } from '../linked-verse';
import { parseLoginBonus } from './login-bonus.parser';
import { parseLeaderboard, parseLinkedVerse } from './ranking.parser';

const fixture = (name: string) =>
  readFileSync(
    join(__dirname, '../../../../test/fixtures/chunithm-net', name),
    'utf-8',
  );

describe('parseLeaderboard', () => {
  const leaderboard = parseLeaderboard(fixture('music_ranking_detail.html'));

  it('reads the ranking', () => {
    expect(leaderboard.ranking.length).toBeGreaterThan(0);

    const [first] = leaderboard.ranking;

    expect(first.position).toBe(1);
    expect(first.playerName).toBeTruthy();
    expect(first.score).toBeGreaterThan(0);
  });

  it('numbers positions in ascending order', () => {
    const positions = leaderboard.ranking.map((entry) => entry.position);

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('never ranks a lower score above a higher one', () => {
    for (let i = 1; i < leaderboard.ranking.length; i += 1) {
      expect(leaderboard.ranking[i].score).toBeLessThanOrEqual(
        leaderboard.ranking[i - 1].score,
      );
    }
  });

  it('reads the update timestamp', () => {
    expect(leaderboard.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('parseLinkedVerse', () => {
  const gates = parseLinkedVerse(fixture('linked_verse.html'));

  it('reads every gate on the page', () => {
    expect(gates.length).toBeGreaterThan(0);

    for (const entry of gates) {
      expect(Object.values(LinkedGate)).toContain(entry.gate);
    }
  });

  it('keeps gates in release order, since the page does not name them', () => {
    const order = Object.values(LinkedGate);

    gates.forEach((entry, index) => {
      expect(entry.gate).toBe(order[index]);
    });
  });

  it('hands back the badge the game serves, without interpreting it', () => {
    // The whole result for a gate. Deriving a status from the filename needed
    // a hand-kept lookup, and every version of that lookup ended up
    // contradicting the artwork it sat beside.
    const html = `
      <div class="linked_verse_icon_status_block">
        <div class="linked_verse_icon_block">
          <img src="https://example.invalid/img/0W4PTHG72IIN3OIG0GBR3SF8OPB87CPN.png">
        </div>
      </div>`;

    expect(parseLinkedVerse(html)).toEqual([
      {
        gate: Object.values(LinkedGate)[0],
        badgeUrl:
          'https://example.invalid/img/0W4PTHG72IIN3OIG0GBR3SF8OPB87CPN.png',
      },
    ]);
  });

  it('collapses the doubled slash the page emits after the host', () => {
    const html = `
      <div class="linked_verse_icon_status_block">
        <div class="linked_verse_icon_block">
          <img src="https://example.invalid/mobile//images/ABC.png">
        </div>
      </div>`;

    expect(parseLinkedVerse(html)[0].badgeUrl).toBe(
      'https://example.invalid/mobile/images/ABC.png',
    );
  });
});

describe('parseLoginBonus', () => {
  const bonus = parseLoginBonus(fixture('login_bonus.html'));

  it('reads the weekday rota', () => {
    expect(bonus.daily.length).toBe(7);
    expect(bonus.daily.map((day) => day.weekday).sort()).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(bonus.daily.filter((day) => day.isToday).length).toBeLessThanOrEqual(
      1,
    );
  });

  it('reads streak rewards with their day numbers', () => {
    expect(bonus.streak.length).toBeGreaterThan(0);

    for (const item of bonus.streak) {
      expect(item.day).toBeGreaterThan(0);
      expect(item.name.length).toBeGreaterThan(0);
    }
  });

  it('reads the monthly cumulative track', () => {
    expect(bonus.monthly.length).toBeGreaterThan(0);
    expect(bonus.monthly[0].daysLoggedIn).toBeGreaterThanOrEqual(0);
  });
});
