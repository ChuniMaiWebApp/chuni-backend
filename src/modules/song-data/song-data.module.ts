import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { RegionRefreshService } from './region-refresh.service';
import { SeedRefreshService } from './seed-refresh.service';
import { SongDataScheduler } from './song-data.scheduler';

/**
 * Owns the third-party song data: what it says, and keeping it current.
 *
 * Separate from SongsModule, which serves that data to callers. Keeping the
 * refresh here means the CLI can load this module alone, without standing up
 * controllers and guards it has no use for.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [SeedRefreshService, RegionRefreshService, SongDataScheduler],
  exports: [SeedRefreshService, RegionRefreshService],
})
export class SongDataModule {}
