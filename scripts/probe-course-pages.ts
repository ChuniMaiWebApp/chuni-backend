/**
 * Looks for a CHUNITHM-NET page that lists the game's courses.
 *
 *   npx ts-node scripts/probe-course-pages.ts
 *
 * The course data currently in this database came from an external dataset
 * and is frozen at the LUMINOUS version. Replacing it needs a first-party
 * source, and unauthenticated probing cannot find one: every path, real or
 * not, redirects to /mobile/error/ without a session. So this asks while
 * signed in and reports what actually comes back.
 *
 * Prints page titles and headings only — never the cookie.
 */
import { createDecipheriv } from 'node:crypto';
import { join } from 'node:path';

import { load } from 'cheerio';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import { ChunithmNetService } from '../src/shared/chunithm-net/chunithm-net.service';

loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

/** Paths worth asking for, in the shape CHUNITHM-NET uses elsewhere. */
const CANDIDATES: ReadonlyArray<[method: 'GET' | 'POST', path: string]> = [
  ['GET', 'mobile/record/course'],
  ['GET', 'mobile/record/courseList'],
  ['GET', 'mobile/record/classCourse'],
  ['GET', 'mobile/home/course'],
  ['GET', 'mobile/home/courseList'],
  ['GET', 'mobile/record/course/'],
  ['GET', 'mobile/home/playerData/course'],
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

  console.log(`Using the session of ${rows[0].display_name}\n`);

  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  const session = new ChunithmNetService().createSession({
    cookieJar: decrypt(rows[0].cookie_jar, key),
  });

  // Reach past the typed methods: none of these pages has a parser yet.
  const request = (
    session as unknown as {
      request: (method: string, path: string) => Promise<string>;
    }
  ).request.bind(session);

  for (const [method, path] of CANDIDATES) {
    process.stdout.write(`${method.padEnd(4)} ${path.padEnd(34)}`);

    try {
      const html = await request(method, path);
      const $ = load(html);
      const title = $('#page_title').first().text().trim();
      const heading = $('h2, .box01_title').first().text().trim();
      const forms = $('form').length;

      if (/error/i.test(title) || html.includes('/mobile/error/')) {
        console.log('error page');
        continue;
      }

      console.log(
        `OK  title="${title || heading || '(none)'}"  forms=${forms}  ${html.length}b`,
      );
    } catch (error) {
      console.log(`failed: ${(error as Error).message}`);
    }
  }

  console.log(
    '\nAnything reporting OK with a real title is worth writing a parser for.\n' +
      'If every line is an error page, CHUNITHM-NET does not publish course\n' +
      'listings to players and the data has no first-party source.',
  );
}

main().catch((error: Error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
