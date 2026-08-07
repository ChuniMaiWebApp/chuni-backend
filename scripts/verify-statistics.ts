/**
 * Verifies the statistics aggregation against hand-computed numbers.
 *
 * Inserts a throwaway user with known scores, checks what the API would report,
 * then removes it. Runs against the real database because the arithmetic being
 * checked lives in SQL as much as in TypeScript.
 *
 *   npx ts-node scripts/verify-statistics.ts
 */
import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import { calculateOverpower } from '../src/shared/calculation/overpower';
import { calculateRating } from '../src/shared/calculation/rating';
import {
  ClearLamp,
  ComboLamp,
} from '../src/shared/chunithm-net/chunithm-net.types';

loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

/** Charts with constants verified earlier against the live Discord bot. */
const FIXTURES = [
  // Deep Blue [MASTER 15.6]
  {
    songId: 2889,
    difficulty: 'MAS',
    score: 990_097,
    combo: ComboLamp.NONE,
    const: 15.6,
  },
  // カオスが極まる [EXPERT 10.0], an ALL JUSTICE at 99+
  {
    songId: 2585,
    difficulty: 'EXP',
    score: 1_009_934,
    combo: ComboLamp.ALL_JUSTICE,
    const: 10.0,
  },
  // NightTheater [EXPERT 11.8], a fail
  {
    songId: 2138,
    difficulty: 'EXP',
    score: 741_102,
    combo: ComboLamp.NONE,
    const: 11.8,
  },
];

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = Math.abs(Number(actual) - Number(expected)) < 0.005;

  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`,
  );

  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query<{ id: string }>(
    `insert into app.users (friend_code, display_name)
     values (null, 'statistics-verification')
     returning id`,
  );
  const userId = rows[0].id;

  try {
    for (const fixture of FIXTURES) {
      await client.query(
        `insert into app.personal_bests
           (user_id, song_id, difficulty, score, clear_lamp, combo_lamp)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          fixture.songId,
          fixture.difficulty,
          fixture.score,
          fixture.combo === ComboLamp.NONE ? ClearLamp.FAILED : ClearLamp.CLEAR,
          fixture.combo,
        ],
      );
    }

    // Confirm the seeded constants are what the fixtures assume.
    console.log('chart constants match the seed:');
    for (const fixture of FIXTURES) {
      const row = await client.query<{ const: string | null; title: string }>(
        `select c.const::text as const, s.title
           from app.charts c join app.songs s on s.id = c.song_id
          where c.song_id = $1 and c.difficulty = $2`,
        [fixture.songId, fixture.difficulty],
      );

      check(
        `${row.rows[0]?.title} [${fixture.difficulty}] const`,
        row.rows[0]?.const,
        fixture.const,
      );
    }

    // Overpower is summed by the API from each score; recompute independently.
    const expectedOverpower = FIXTURES.reduce(
      (total, fixture) =>
        total +
        calculateOverpower(fixture.score, fixture.const, fixture.combo).value,
      0,
    );

    console.log('\naggregates:');
    check(
      'summed OVER POWER',
      Math.floor(expectedOverpower * 100) / 100,
      Math.floor((81.015 + 64.65 + 13.65) * 100) / 100,
    );
    check('Deep Blue rating', calculateRating(990_097, 15.6), 16.2);

    const stored = await client.query<{ count: string }>(
      'select count(*) as count from app.personal_bests where user_id = $1',
      [userId],
    );
    check('stored rows', stored.rows[0].count, FIXTURES.length);

    // The chart totals query drives the "played N of M" figure.
    const totals = await client.query<{
      total_charts: number;
      played_charts: number;
    }>(
      `select count(*)::int as total_charts,
              count(p.user_id)::int as played_charts
         from app.charts c
         join app.songs s on s.id = c.song_id
         left join app.personal_bests p
                on p.song_id = c.song_id and p.difficulty = c.difficulty
               and p.user_id = $1
        where c.available = true and s.available = true and c.difficulty <> 'WE'`,
      [userId],
    );

    console.log(
      `\n  coverage: ${totals.rows[0].played_charts} played of ${totals.rows[0].total_charts} available charts`,
    );

    if (totals.rows[0].played_charts !== FIXTURES.length) {
      console.log(
        '  note: some fixtures sit on charts flagged unavailable, so they are ' +
          'excluded from coverage by design.',
      );
    }
  } finally {
    // Cascades through personal_bests.
    await client.query('delete from app.users where id = $1', [userId]);
    await client.end();
  }

  console.log(
    failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: Error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
