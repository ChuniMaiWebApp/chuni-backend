import { ConfigService } from '@nestjs/config';

import { DatabaseService } from '../../shared/database/database.service';
import { RedisService } from '../../shared/redis/redis.service';
import { CatalogueRefreshService } from './catalogue-refresh.service';
import { AvailabilityRefreshService } from './availability-refresh.service';
import { SongDataScheduler } from './song-data.scheduler';

/**
 * The refresh itself is exercised against the real upstream by the CLI; what
 * needs pinning down here is the part that only misbehaves in production —
 * two instances on the same schedule, an upstream that is down, a Redis that
 * is down.
 */
const build = (options: {
  autoRefresh?: boolean;
  lockAcquired?: boolean | Error;
  lastRefreshAgeHours?: number | null;
  refreshFails?: boolean;
  catalogueFails?: boolean;
}) => {
  const catalogueRefresh = jest.fn(() =>
    options.catalogueFails
      ? Promise.reject(new Error('sega is down'))
      : Promise.resolve({
          changed: true,
          songCount: 1734,
          chartCount: 7000,
          chartsWithConstant: 2785,
          unmatchedSongs: 0,
          newestRelease: null,
          skippedTracks: [],
        }),
  );

  const refresh = jest.fn(() => {
    if (options.refreshFails) {
      return Promise.reject(new Error('upstream is down'));
    }

    return Promise.resolve({
      publishedAt: null,
      upstreamSongs: 1,
      matchedSongs: 1,
      unmatchedSongs: 0,
      chartsUpdated: 1,
      unexplainedMisses: [],
    });
  });

  const del = jest.fn(() => Promise.resolve(1));
  const set = jest.fn(() => {
    if (options.lockAcquired instanceof Error) {
      return Promise.reject(options.lockAcquired);
    }

    return Promise.resolve(options.lockAcquired === false ? null : 'OK');
  });

  const age = options.lastRefreshAgeHours;

  const scheduler = new SongDataScheduler(
    {
      get: () => options.autoRefresh ?? true,
    } as unknown as ConfigService<never, true>,
    {
      queryOne: () =>
        Promise.resolve(
          age === null || age === undefined
            ? null
            : { fetched_at: new Date(Date.now() - age * 3_600_000) },
        ),
    } as unknown as DatabaseService,
    { client: { set, del } } as unknown as RedisService,
    { refresh: catalogueRefresh } as unknown as CatalogueRefreshService,
    { refresh } as unknown as AvailabilityRefreshService,
  );

  return { scheduler, refresh, catalogueRefresh, set, del };
};

describe('SongDataScheduler', () => {
  it('refreshes on the daily run and releases the lock afterwards', async () => {
    const { scheduler, refresh, catalogueRefresh, set, del } = build({});

    await scheduler.scheduledRefresh();

    expect(catalogueRefresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    // NX + EX, so a crashed instance cannot hold the lock forever.
    expect(set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'EX',
      expect.any(Number),
      'NX',
    );
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when another instance holds the lock', async () => {
    const { scheduler, refresh, del } = build({ lockAcquired: false });

    await scheduler.scheduledRefresh();

    expect(refresh).not.toHaveBeenCalled();
    // Releasing a lock this process never took would free the other instance's.
    expect(del).not.toHaveBeenCalled();
  });

  it('skips rather than throws when Redis cannot be reached', async () => {
    const { scheduler, refresh } = build({
      lockAcquired: new Error('ECONNREFUSED'),
    });

    await expect(scheduler.scheduledRefresh()).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('releases the lock when the refresh throws', async () => {
    // An upstream outage must not wedge the job until the TTL expires.
    const { scheduler, del } = build({ refreshFails: true });

    await expect(scheduler.scheduledRefresh()).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when auto refresh is switched off', async () => {
    const { scheduler, refresh, catalogueRefresh, set } = build({
      autoRefresh: false,
    });

    await scheduler.scheduledRefresh();
    await scheduler.onApplicationBootstrap();

    expect(catalogueRefresh).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('still applies region data when the catalogue refresh fails', async () => {
    // The two upstreams are independent. A GitHub outage must not also cost
    // players the Inter/Japan labelling, which is the part they actually see.
    const { scheduler, refresh, catalogueRefresh } = build({
      catalogueFails: true,
    });

    await expect(scheduler.scheduledRefresh()).resolves.toBeUndefined();

    expect(catalogueRefresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('catches up at boot when there is no region data yet', async () => {
    const { scheduler, refresh } = build({ lastRefreshAgeHours: null });

    await scheduler.onApplicationBootstrap();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('catches up at boot when the data is stale', async () => {
    const { scheduler, refresh } = build({ lastRefreshAgeHours: 72 });

    await scheduler.onApplicationBootstrap();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves fresh data alone at boot', async () => {
    // Restarting the API repeatedly must not hammer the upstream.
    const { scheduler, refresh } = build({ lastRefreshAgeHours: 2 });

    await scheduler.onApplicationBootstrap();

    expect(refresh).not.toHaveBeenCalled();
  });
});
