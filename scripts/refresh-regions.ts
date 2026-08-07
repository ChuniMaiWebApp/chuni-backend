/**
 * Refreshes the regional song data on demand.
 *
 *   npm run seed:regions
 *
 * The API already does this on a daily schedule; this is for the first run
 * after seeding, and for forcing an update without waiting for the cron.
 *
 * Deliberately a thin wrapper: the logic lives in RegionRefreshService so the
 * scheduled path and this one cannot drift apart.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { RegionRefreshService } from '../src/modules/song-data/region-refresh.service';

async function main(): Promise<void> {
  // The scheduler catches up at boot when the data is stale, which is exactly
  // the situation someone runs this in. Left on, it would race the explicit
  // refresh below for the same lock and one of the two would be a no-op.
  process.env.SONG_DATA_AUTO_REFRESH = 'false';

  // Logs from the rest of the app booting would drown out the report.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const service = app.get(RegionRefreshService);
    const result = await service.refresh();

    const age = result.publishedAt
      ? Math.round((Date.now() - result.publishedAt.getTime()) / 3_600_000)
      : null;

    console.log(
      `source published ${result.publishedAt?.toISOString() ?? 'unknown'}` +
        (age === null ? '' : ` (${age}h ago)`),
    );
    console.log(`upstream songs : ${result.upstreamSongs}`);
    console.log(`matched        : ${result.matchedSongs}`);
    console.log(`charts updated : ${result.chartsUpdated}`);
    console.log(
      `unmatched      : ${result.unmatchedSongs}` +
        ` (${result.unmatchedSongs - result.unexplainedMisses.length} already removed from the game)`,
    );

    if (result.unexplainedMisses.length > 0) {
      console.log('  not-removed songs with no upstream entry:');
      result.unexplainedMisses
        .slice(0, 15)
        .forEach((song) => console.log(`    ${song.id} ${song.title}`));
    }

    console.log('\nresulting picture:');
    for (const row of await service.summary()) {
      console.log(`  ${row.count.padStart(5)}  ${row.state}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: Error) => {
  new Logger('refresh-regions').error(error.stack ?? error.message);
  process.exit(1);
});
