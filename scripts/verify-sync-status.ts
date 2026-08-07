/**
 * Checks that the sync status endpoint reports song-dataset freshness.
 *
 * Creates a throwaway user and mints a token for it, so the check needs no
 * real CHUNITHM account: the statistics and sync-status endpoints read only
 * the local database.
 *
 *   npx ts-node scripts/verify-sync-status.ts
 */
import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { Client } from 'pg';

loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

const API = `http://localhost:${process.env.PORT ?? 3333}/api/v1`;

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query<{ id: string }>(
    `insert into app.users (friend_code, display_name)
     values (null, 'sync-status-verification') returning id`,
  );
  const userId = rows[0].id;

  try {
    const token = jwt.sign(
      { sub: userId, name: 'sync-status-verification' },
      process.env.JWT_SECRET!,
      { expiresIn: '5m' },
    );

    const response = await fetch(`${API}/records/sync`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      console.error(`FAIL: ${response.status} ${await response.text()}`);
      process.exitCode = 1;
      return;
    }

    const status = (await response.json()) as {
      hasSynced: boolean;
      dataset: {
        refreshedAt: string;
        newestRelease: string | null;
        songCount: number;
        ageDays: number;
      } | null;
    };

    console.log('sync status for a never-synced user:');
    console.log(`  hasSynced      : ${status.hasSynced}`);

    if (!status.dataset) {
      console.error('FAIL: dataset freshness missing from the response');
      process.exitCode = 1;
      return;
    }

    console.log('  dataset:');
    console.log(`    refreshed at : ${status.dataset.refreshedAt}`);
    console.log(`    age (days)   : ${status.dataset.ageDays}`);
    console.log(`    songs        : ${status.dataset.songCount}`);
    console.log(`    newest song  : ${status.dataset.newestRelease}`);

    const newest = status.dataset.newestRelease;

    if (newest) {
      const behind = Math.floor(
        (Date.now() - new Date(newest).getTime()) / 86_400_000,
      );

      console.log(
        `\n  Newest song in the dataset is ${behind} day(s) old. ` +
          'Anything released since then is missing entirely.',
      );
    }

    console.log('\nOK');
  } finally {
    await client.query('delete from app.users where id = $1', [userId]);
    await client.end();
  }
}

main().catch((error: Error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
