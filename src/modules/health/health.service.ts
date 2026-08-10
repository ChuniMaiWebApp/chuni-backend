import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../shared/database/database.service';
import { RedisService } from '../../shared/redis/redis.service';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { DependencyStatus, HealthResponseDto } from './dto/health-response.dto';

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly supabase: SupabaseService,
  ) {}

  async check(): Promise<HealthResponseDto> {
    const [postgresUp, redisUp, supabaseUp] = await Promise.all([
      this.database.ping(),
      this.redis.ping(),
      this.supabase.ping(),
    ]);

    const dependencies: Record<string, DependencyStatus> = {
      postgres: postgresUp ? 'up' : 'down',
      redis: redisUp ? 'up' : 'down',
    };

    // null means this deployment has no Supabase stack — reporting it "down"
    // would leave /health permanently degraded and make the deploy gate useless.
    if (supabaseUp !== null) {
      dependencies.supabase = supabaseUp ? 'up' : 'down';
    }

    const allUp = Object.values(dependencies).every(
      (status) => status === 'up',
    );

    return {
      status: allUp ? 'ok' : 'degraded',
      uptime: Number(process.uptime().toFixed(2)),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }
}
