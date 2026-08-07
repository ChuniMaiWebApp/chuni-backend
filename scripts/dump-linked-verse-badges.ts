/**
 * Prints the Linked GATE badge image filenames CHUNITHM-NET currently serves
 * for a linked account, so unrecognised ones can be added to the lookup table.
 *
 * The badge table was inherited from chuni-penguin and only covers gates up to
 * NEW; SUN, LUMINOUS and VERSE badges hash to filenames nothing knows about,
 * and were being reported as "not found" rather than as unknown.
 *
 *   npx ts-node scripts/dump-linked-verse-badges.ts
 *
 * Reads the encrypted cookie jar of the most recently used account. Prints
 * filenames only — never the cookie.
 */
import { createDecipheriv } from 'node:crypto';
import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { load } from 'cheerio';
import { Client } from 'pg';

import { LINKED_GATE_BADGES } from '../src/shared/chunithm-net/linked-gate-badges';
import { ChunithmNetService } from '../src/shared/chunithm-net/chunithm-net.service';

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

  await client.end();

  if (rows.length === 0) {
    console.error(
      'No linked account found. Sign in through the web app first.',
    );
    process.exit(1);
  }

  console.log(`Using the session of ${rows[0].display_name}\n`);

  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  const session = new ChunithmNetService().createSession({
    cookieJar: decrypt(rows[0].cookie_jar, key),
  });

  // Reach past the parser to see the raw markup.
  const html = await (
    session as unknown as {
      request: (method: string, path: string) => Promise<string>;
    }
  ).request('GET', 'mobile/home/linkedVerse/');

  const $ = load(html);
  const images = $(
    '.linked_verse_icon_status_block .linked_verse_icon_block img',
  );

  console.log(`Found ${images.length} badge image(s):\n`);

  images.each((index, element) => {
    const source = $(element).attr('src') ?? '';
    const filename = source.split('/').pop()?.split('.')[0] ?? '';
    const known = LINKED_GATE_BADGES[filename];

    console.log(
      `  [${index}] ${filename}  ->  ${known ?? 'UNKNOWN — needs adding'}`,
    );
  });

  // Anything else on the page that might identify a gate without the hash.
  console.log('\nOther classes inside the status block:');
  console.log(
    [
      ...new Set(
        $('.linked_verse_icon_status_block *')
          .map((_, element) => $(element).attr('class'))
          .get()
          .filter(Boolean),
      ),
    ].join('\n  '),
  );
}

main().catch((error: Error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
