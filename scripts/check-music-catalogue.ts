/**
 * Checks whether CHUNITHM-NET's music list really lists every chart the
 * server carries, or only the ones the account has played.
 *
 *   npx ts-node scripts/check-music-catalogue.ts
 *
 * This one assumption decides whether region data can come from the game
 * itself instead of from a third party, so it is worth measuring rather than
 * believing. The test is simple: if the list is the server's inventory, it is
 * far larger than the account's own play history, and the same for any
 * account. If it only ever returns what the player has scored, the two counts
 * match and the approach does not work.
 *
 * Reads the encrypted cookie jar of the most recently used account. Prints
 * counts and titles only — never the cookie.
 */
import { createDecipheriv } from 'node:crypto';
import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import { ChunithmNetService } from '../src/shared/chunithm-net/chunithm-net.service';
import { Difficulty } from '../src/shared/chunithm-net/chunithm-net.types';

loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

function decrypt(payload: string, key: Buffer): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);

  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]).toString('utf8');
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query<{
    cookie_jar: string;
    display_name: string;
  }>(
    `select l.cookie_jar, u.display_name
       from app.chunithm_links l
       join app.users u on u.id = l.user_id
      where l.invalidated_at is null
      order by l.last_used_at desc nulls last
      limit 1`,
  );

  if (rows.length === 0) {
    console.error('No linked account found. Sign in through the web app first.');
    await client.end();
    process.exit(1);
  }

  console.log(`Using the session of ${rows[0].display_name}\n`);

  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  const session = new ChunithmNetService().createSession({
    cookieJar: decrypt(rows[0].cookie_jar, key),
  });

  console.log('Reading the music list (6 requests, paced)…');
  const listed = await session.getMusicCatalogue();

  console.log('Reading this account\'s personal bests for comparison…');
  const played = await session.getAllPersonalBests();

  await client.end();

  const byDifficulty = new Map<Difficulty, number>();
  for (const chart of listed) {
    byDifficulty.set(
      chart.difficulty,
      (byDifficulty.get(chart.difficulty) ?? 0) + 1,
    );
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(`charts the list offers  : ${listed.length}`);
  console.log(`charts this account has : ${played.length}`);
  console.log('─────────────────────────────────────────────');

  for (const difficulty of [
    Difficulty.BASIC,
    Difficulty.ADVANCED,
    Difficulty.EXPERT,
    Difficulty.MASTER,
    Difficulty.ULTIMA,
    Difficulty.WORLDS_END,
  ]) {
    console.log(
      `  ${Difficulty[difficulty].padEnd(11)} ${byDifficulty.get(difficulty) ?? 0}`,
    );
  }

  console.log();

  if (listed.length > played.length * 1.5 && listed.length > 2000) {
    console.log(
      'PASS — the list is far larger than this account\'s history, so it is\n' +
        '       the server\'s inventory. Region data can come from here.',
    );
  } else if (listed.length === played.length) {
    console.log(
      'FAIL — the list returned exactly the played charts, so it is filtered\n' +
        '       to this account. Region data needs another source.',
    );
  } else {
    console.log(
      'INCONCLUSIVE — the counts are close. Compare against a second account\n' +
        '       with a very different play history before relying on this.',
    );
  }

  // A song this account has never played proves the point on its own.
  const playedKeys = new Set(
    played.map((record) => `${record.song.id}:${record.chart.difficulty}`),
  );
  const unplayed = listed.filter(
    (chart) => !playedKeys.has(`${chart.songId}:${chart.difficulty}`),
  );

  console.log(`\nlisted but never played by this account: ${unplayed.length}`);

  for (const chart of unplayed.slice(0, 5)) {
    console.log(
      `  ${String(chart.songId).padStart(5)}  ${Difficulty[chart.difficulty].padEnd(11)} ${chart.title}`,
    );
  }
}

main().catch((error: Error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
