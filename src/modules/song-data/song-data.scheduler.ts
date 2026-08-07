import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import type { AppConfig } from '../../config';
import { DatabaseService } from '../../shared/database/database.service';
import { RedisService } from '../../shared/redis/redis.service';
import { RegionRefreshService } from './region-refresh.service';
import { SeedRefreshService } from './seed-refresh.service';

/**
 * Keeps the song data current without anyone remembering to.
 *
 * Two passes, in order: the catalogue itself (chuni-penguin), then which of
 * its charts each region actually has (arcade-songs). Both upstreams publish
 * daily in the small hours UTC — arcade-songs at 06:43 UTC on the day this was
 * written — so the job runs at 08:00 UTC, after publication and while nobody
 * is playing.
 *
 * Safe to run unattended because neither pass can lose data: the catalogue is
 * upserted rather than replaced, and the region pass writes four boolean
 * columns. Both refuse to apply a download that looks truncated.
 */

/** Refuse to start a second refresh while one is running, or just after. */
const LOCK_KEY = 'song-data:refresh:lock';
const LOCK_TTL_SECONDS = 15 * 60;

/** Data older than this is refreshed at boot rather than waiting for the cron. */
const STALE_AFTER_HOURS = 36;

@Injectable()
export class SongDataScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SongDataScheduler.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly seed: SeedRefreshService,
    private readonly regions: RegionRefreshService,
  ) {}

  private get enabled(): boolean {
    return this.config.get('songData.autoRefresh', { infer: true });
  }

  /**
   * Only one process may refresh at a time.
   *
   * Without this, every instance behind a load balancer would download and
   * rewrite the same rows on the same schedule. A Redis SET NX is enough:
   * losing the lock means another instance is already doing the work, and the
   * worst case if Redis is unreachable is that the refresh is skipped — never
   * that two of them interleave writes.
   */
  private async withLock(run: () => Promise<void>): Promise<void> {
    let acquired = false;

    try {
      acquired =
        (await this.redis.client.set(
          LOCK_KEY,
          String(process.pid),
          'EX',
          LOCK_TTL_SECONDS,
          'NX',
        )) === 'OK';
    } catch (error) {
      this.logger.warn(
        `Skipping refresh: could not reach Redis to take the lock (${(error as Error).message})`,
      );

      return;
    }

    if (!acquired) {
      this.logger.log('Another instance is refreshing region data; skipping.');

      return;
    }

    try {
      await run();
    } finally {
      await this.redis.client.del(LOCK_KEY).catch(() => undefined);
    }
  }

  /**
   * Runs the refresh and swallows failures.
   *
   * A scheduled job that throws would take down the process on an unhandled
   * rejection; an upstream that is briefly unreachable is not a reason to stop
   * serving. The previous data stays in place and the next run tries again.
   */
  private async refreshQuietly(reason: string): Promise<void> {
    await this.withLock(async () => {
      this.logger.log(`Refreshing song data (${reason})…`);

      // Order matters: the catalogue first, so a song released this week
      // exists before the region pass tries to label it. They fail
      // independently — a catalogue that is briefly stale is much better than
      // skipping the region pass, which is what decides what players can see.
      try {
        await this.seed.refresh();
      } catch (error) {
        this.logger.error(
          `Song catalogue refresh failed, keeping the previous data: ${(error as Error).message}`,
        );
      }

      try {
        await this.regions.refresh();
      } catch (error) {
        this.logger.error(
          `Region refresh failed, keeping the previous data: ${(error as Error).message}`,
        );
      }
    });
  }

  @Cron('0 8 * * *', { name: 'song-data-refresh', timeZone: 'UTC' })
  async scheduledRefresh(): Promise<void> {
    if (!this.enabled) return;

    await this.refreshQuietly('daily schedule');
  }

  /**
   * Catches up at boot when the data is missing or stale.
   *
   * A machine that was switched off over the weekend would otherwise serve
   * three-day-old region data until 08:00 UTC came round again.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Automatic region refresh is disabled.');

      return;
    }

    const last = await this.db
      .queryOne<{ fetched_at: Date }>(
        'select fetched_at from app.region_refreshes order by fetched_at desc limit 1',
      )
      .catch(() => null);

    if (!last) {
      await this.refreshQuietly('no song data yet');

      return;
    }

    const ageHours = (Date.now() - last.fetched_at.getTime()) / 3_600_000;

    if (ageHours >= STALE_AFTER_HOURS) {
      await this.refreshQuietly(
        `last refresh was ${Math.round(ageHours)}h ago`,
      );
    }
  }
}
