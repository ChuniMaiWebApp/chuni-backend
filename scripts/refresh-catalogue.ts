/**
 * Loads the song catalogue from SEGA and chunirec.
 *
 *   npm run catalogue:refresh          # skip if both upstreams are unchanged
 *   npm run catalogue:refresh -- --force
 *
 * Deliberately a thin wrapper: the logic lives in CatalogueRefreshService so
 * the scheduled job and this command cannot drift apart.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../src/app.module';
import { CatalogueRefreshService } from '../src/modules/song-data/catalogue-refresh.service';

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const result = await app.get(CatalogueRefreshService).refresh(force);

    Logger.log(
      result.changed
        ? `Loaded ${result.songCount} songs, ${result.chartCount} charts, ${result.chartsWithConstant} with a constant.`
        : `Upstreams unchanged (${result.songCount} songs). Pass --force to load anyway.`,
      'RefreshCatalogue',
    );

    if (result.unmatchedSongs > 0) {
      Logger.warn(
        `${result.unmatchedSongs} song(s) had no chunirec entry — usually WORLD'S END arrangements and this week's releases.`,
        'RefreshCatalogue',
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error: Error) => {
  Logger.error(error.message, 'RefreshCatalogue');
  process.exit(1);
});
