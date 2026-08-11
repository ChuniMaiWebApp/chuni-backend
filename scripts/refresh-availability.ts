/**
 * Records which charts each region has: Japan from SEGA's own music list,
 * International from the signed-in CHUNITHM-NET inventory.
 *
 *   npm run catalogue:availability
 *
 * Needs one linked CHUNITHM-NET account for the International half. Any
 * account will do — the inventory belongs to the server, not to the player.
 *
 * Deliberately a thin wrapper: the logic lives in AvailabilityRefreshService
 * so the scheduled job and this command cannot drift apart.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AvailabilityRefreshService } from '../src/modules/song-data/availability-refresh.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const result = await app.get(AvailabilityRefreshService).refresh();

    Logger.log(
      `Updated ${result.updatedCharts} charts — ${result.intlCharts} international, ${result.jpCharts} Japanese.`,
      'RefreshAvailability',
    );

    if (result.unknownCharts > 0) {
      Logger.warn(
        `${result.unknownCharts} listed chart(s) are not in the catalogue yet. Run catalogue:refresh first.`,
        'RefreshAvailability',
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error: Error) => {
  Logger.error(error.stack ?? error.message, 'RefreshAvailability');
  process.exit(1);
});
