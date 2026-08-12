/**
 * Shows the Linked GATE badges a linked account is currently being served,
 * and writes the SQL to label the ones nobody has identified yet.
 *
 *   npx ts-node scripts/label-gate-badges.ts
 *
 * CHUNITHM-NET serves each hexagon under an opaque filename with nothing in
 * the markup to say what it means, so the meaning has to come from someone who
 * can see both the badge and their own progress. That is the account holder,
 * which is why this prints a template rather than deciding anything.
 *
 * The interface asks one question of a gate — cleared or not — because the
 * badge artwork already shows the stages in between. So label each badge
 * `clear` or `not_found` and leave the finer states alone unless something
 * later needs them; the column still accepts `under_analysis` and `linkable`.
 *
 * Never guess. A wrong label here reports the wrong progress to every player
 * who is served that badge, and does it silently.
 */
import { createDecipheriv } from 'node:crypto';
import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

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

  if (rows.length === 0) {
    console.error('No linked account found. Sign in through the web app first.');
    await client.end();
    process.exit(1);
  }

  const known = new Map<string, string | null>(
    (
      await client.query<{ filename: string; status: string | null }>(
        'select filename, status from app.linked_gate_badges',
      )
    ).rows.map((row) => [row.filename, row.status]),
  );

  console.log(`Reading the gates of ${rows[0].display_name}…\n`);

  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  const session = new ChunithmNetService().createSession({
    cookieJar: decrypt(rows[0].cookie_jar, key),
  });

  const progress = await session.getLinkedVerseProgress(
    Object.fromEntries(
      [...known].filter(([, status]) => status !== null),
    ) as Record<string, never>,
  );

  await client.end();

  const unlabelled: Array<{ gate: string; filename: string }> = [];

  console.log('gate        status          badge');
  console.log('─'.repeat(64));

  for (const entry of progress) {
    const filename = entry.badgeUrl?.split('/').pop()?.split('.')[0] ?? '';
    const labelled = known.get(filename);

    console.log(
      `${entry.gate.padEnd(11)} ${entry.status.padEnd(15)} ${filename}`,
    );

    if (!labelled) unlabelled.push({ gate: entry.gate, filename });
  }

  if (unlabelled.length === 0) {
    console.log('\nEvery badge on this account is already labelled.');

    return;
  }

  console.log(
    `\n${unlabelled.length} badge(s) need a label. Each line below assumes ` +
      "'clear' —\nchange the ones that are not cleared to 'not_found', then run:\n",
  );

  for (const { gate, filename } of unlabelled) {
    console.log(
      `update app.linked_gate_badges set status = 'clear', gate = '${gate}', ` +
        `labelled_at = now() where filename = '${filename}';` +
        `  -- ${gate}`,
    );
  }

  console.log(
    '\nRows are created automatically the first time a badge is served, so the\n' +
      'updates above will find them. If one reports 0 rows, open the Linked\n' +
      'VERSE page in the app once and try again.',
  );
}

main().catch((error: Error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
