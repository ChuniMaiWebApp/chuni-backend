/**
 * Saves the CHUNITHM-NET pages the parser tests run against, from a linked
 * account of your own.
 *
 *   npx ts-node scripts/capture-fixtures.ts
 *
 * The fixtures are SEGA's markup either way — nothing here is authored. What
 * this changes is where the copies came from: after running it they are pages
 * this installation fetched, not pages inherited from somebody else's test
 * suite.
 *
 * Writes to test/fixtures/chunithm-net/. Existing files are overwritten, so
 * commit or stash before running if you want to diff the markup.
 *
 * Expect tests to need updating afterwards: assertions name a player, their
 * scores and their dates, and those describe whoever produced the capture.
 * Run `npm test` straight after and fix what it points at.
 */
import { createDecipheriv } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import { ChunithmNetService } from '../src/shared/chunithm-net/chunithm-net.service';

loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

const OUT_DIR = join(__dirname, '..', 'test', 'fixtures', 'chunithm-net');

/**
 * Each fixture the suite reads, and the request that produces it.
 *
 * `music_record.html` and `200004.html` come from a song detail page, so they
 * need a song id — 2000/200004 are whatever the previous captures used. Any
 * song the account has played will do; the tests care about markup shape.
 */
const PAGES: ReadonlyArray<{
  file: string;
  method: 'GET' | 'POST';
  path: string;
  data?: Record<string, string>;
}> = [
  { file: 'logged_in_homepage.html', method: 'GET', path: 'mobile/home/' },
  { file: 'player_data.html', method: 'GET', path: 'mobile/home/playerData' },
  {
    file: 'collection_customise.html',
    method: 'GET',
    path: 'mobile/collection/customise',
  },
  {
    file: 'best30.html',
    method: 'GET',
    path: 'mobile/home/playerData/ratingDetailBest/',
  },
  {
    file: 'recent10.html',
    method: 'GET',
    path: 'mobile/home/playerData/ratingDetailRecent/',
  },
  { file: 'playlog.html', method: 'GET', path: 'mobile/record/playlog' },
  { file: 'login_bonus.html', method: 'GET', path: 'mobile/home/loginBonus/' },
  { file: 'linked_verse.html', method: 'GET', path: 'mobile/home/linkedVerse/' },
];

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

  await client.end();

  if (rows.length === 0) {
    console.error('No linked account found. Sign in through the web app first.');
    process.exit(1);
  }

  console.warn(
    `\nCapturing from ${rows[0].display_name}.\n` +
      'These pages contain that account\'s name, friend code and scores, and\n' +
      'they are committed to the repository. Use an account you are willing to\n' +
      'have public, and read the diff before committing.\n',
  );

  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  const session = new ChunithmNetService().createSession({
    cookieJar: decrypt(rows[0].cookie_jar, key),
  });

  const request = (
    session as unknown as {
      request: (
        method: string,
        path: string,
        data?: Record<string, string>,
      ) => Promise<string>;
    }
  ).request.bind(session);

  mkdirSync(OUT_DIR, { recursive: true });

  for (const page of PAGES) {
    process.stdout.write(`${page.file.padEnd(28)}`);

    try {
      const html = await request(page.method, page.path, page.data);

      if (html.includes('/mobile/error/')) {
        console.log('error page — skipped');
        continue;
      }

      writeFileSync(join(OUT_DIR, page.file), html, 'utf-8');
      console.log(`${html.length}b`);
    } catch (error) {
      console.log(`failed: ${(error as Error).message}`);
    }
  }

  console.log('\nNow run `npm test` and update the assertions it flags.');
}

main().catch((error: Error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
