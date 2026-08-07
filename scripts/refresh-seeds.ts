/**
 * Downloads the song dataset from upstream and loads it, on demand.
 *
 *   npm run seed:refresh          # download and load if it changed
 *   npm run seed:refresh -- --force   # load even when unchanged
 *   npm run seed:check            # report staleness only, download nothing
 *
 * The API already does this daily; this is for the first run and for forcing
 * an update without waiting for the cron.
 *
 * Deliberately a thin wrapper: the logic lives in SeedRefreshService so the
 * scheduled path and this one cannot drift apart.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { SeedRefreshService } from '../src/modules/song-data/seed-refresh.service';

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const force = process.argv.includes('--force');

  // The scheduler catches up at boot when the data is stale, which is exactly
  // the situation someone runs this in. Left on, it would race this run.
  process.env.SONG_DATA_AUTO_REFRESH = 'false';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: checkOnly ? ['warn', 'error'] : ['log', 'warn', 'error'],
  });

  try {
    const service = app.get(SeedRefreshService);

    if (checkOnly) {
      const status = await service.status();

      if (!status) {
        console.log(
          'Never refreshed from upstream — running on the bundled copy.',
        );

        return;
      }

      const days = Math.floor(
        (Date.now() - status.fetched_at.getTime()) / 86_400_000,
      );

      console.log(`Last refreshed ${days} day(s) ago`);
      console.log(`  songs          : ${status.song_count}`);
      console.log(`  newest release : ${status.newest_release ?? 'unknown'}`);

      // A dataset whose newest song is months old is missing recent releases,
      // whatever its own refresh time says.
      if (status.newest_release) {
        const behind = Math.floor(
          (Date.now() - new Date(status.newest_release).getTime()) / 86_400_000,
        );

        console.log(
          `  upstream lag   : newest song is ${behind} day(s) old; anything ` +
            'released since is missing entirely',
        );
      }

      return;
    }

    const result = await service.refresh({ force });

    console.log(
      result.changed || force
        ? `Loaded ${result.songCount} songs, ${result.chartCount} charts, ` +
            `${result.aliasCount} aliases and ${result.courseCount} courses.`
        : `Upstream unchanged since the last refresh (${result.songCount} songs). ` +
            'Pass --force to load it anyway.',
    );
    console.log(`newest release : ${result.newestRelease ?? 'unknown'}`);

    if (result.skippedTracks.length > 0) {
      console.warn(
        `  ${result.skippedTracks.length} course track(s) reference songs the ` +
          `dataset does not carry: ${result.skippedTracks.join(', ')}`,
      );
    }

    if (result.changed || force) {
      console.log('\nRun `npm run seed:regions` to label the new songs.');
    }
  } finally {
    await app.close();
  }
}

main().catch((error: Error) => {
  new Logger('refresh-seeds').error(error.stack ?? error.message);
  process.exit(1);
});
