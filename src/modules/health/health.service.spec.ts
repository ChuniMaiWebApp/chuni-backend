import { DatabaseService } from '../../shared/database/database.service';
import { RedisService } from '../../shared/redis/redis.service';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { HealthService } from './health.service';

/**
 * The deploy script gates on `status === 'ok'` and rolls back when it is not,
 * so anything that reports "degraded" forever would make every deploy roll
 * back. Production runs plain Postgres with SUPABASE_URL blank — that has to
 * read as healthy, not as a dependency that is down.
 */
const build = (
  postgres: boolean,
  redis: boolean,
  supabase: boolean | null,
): HealthService =>
  new HealthService(
    { ping: () => Promise.resolve(postgres) } as unknown as DatabaseService,
    { ping: () => Promise.resolve(redis) } as unknown as RedisService,
    { ping: () => Promise.resolve(supabase) } as unknown as SupabaseService,
  );

describe('HealthService', () => {
  it('reports ok when Postgres and Redis are up and Supabase is not configured', async () => {
    const result = await build(true, true, null).check();

    expect(result.status).toBe('ok');
    expect(result.dependencies).toEqual({ postgres: 'up', redis: 'up' });
    expect(result.dependencies).not.toHaveProperty('supabase');
  });

  it('includes Supabase when it is configured', async () => {
    const result = await build(true, true, true).check();

    expect(result.status).toBe('ok');
    expect(result.dependencies.supabase).toBe('up');
  });

  it('degrades when a configured Supabase is unreachable', async () => {
    const result = await build(true, true, false).check();

    expect(result.status).toBe('degraded');
    expect(result.dependencies.supabase).toBe('down');
  });

  it('degrades when Postgres is down, whatever Supabase says', async () => {
    const result = await build(false, true, null).check();

    expect(result.status).toBe('degraded');
    expect(result.dependencies.postgres).toBe('down');
  });

  it('degrades when Redis is down — the sign-in throttle lives there', async () => {
    const result = await build(true, false, null).check();

    expect(result.status).toBe('degraded');
    expect(result.dependencies.redis).toBe('down');
  });
});
