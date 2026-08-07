/**
 * Loads the bundled song dataset from `data/` into the database.
 *
 *   npm run seed:songs
 *
 * This is the offline path, for a first setup with no network or when pinning
 * to the copy committed alongside the code. To pull the current dataset
 * instead, use `npm run seed:refresh` — or just start the API, which refreshes
 * on a schedule.
 *
 * Re-running is safe: rows are upserted on their natural keys.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { SeedRefreshService } from '../src/modules/song-data/seed-refresh.service';
import type { SeedCourse, SeedSong } from '../src/modules/song-data/seed.types';

const DATA_DIR = join(__dirname, '..', 'data');

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as T;

async function main(): Promise<void> {
  // Nothing here needs the network; letting the scheduler fire would quietly
  // replace the bundled copy this script exists to load.
  process.env.SONG_DATA_AUTO_REFRESH = 'false';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const songs = read<SeedSong[]>('songs.json');
    const courses = read<SeedCourse[]>('courses.json');

    const result = await app.get(SeedRefreshService).load(songs, courses);

    const chartCount = songs.reduce(
      (total, song) => total + song.charts.length,
      0,
    );

    console.log(
      `Seeded ${songs.length} songs, ${chartCount} charts, ` +
        `${result.aliasCount} aliases and ${result.courseCount} courses.`,
    );

    if (result.skippedTracks.length > 0) {
      console.warn(
        `  ${result.skippedTracks.length} course track(s) reference unknown songs ` +
          `and were skipped: ${result.skippedTracks.join(', ')}`,
      );
    }

    console.log('\nRun `npm run seed:regions` to label which region has what.');
  } finally {
    await app.close();
  }
}

main().catch((error: Error) => {
  new Logger('seed-songs').error(error.stack ?? error.message);
  process.exit(1);
});
