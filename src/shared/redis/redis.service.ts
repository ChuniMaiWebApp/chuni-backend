import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import type { AppConfig } from '../../config';

/**
 * Thin wrapper around a single ioredis connection.
 *
 * The connection is lazy and never throws on boot: a missing Redis must not
 * prevent the API from starting, it only makes `/health` report `down`.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const { host, port, password, db } = this.config.get('redis', {
      infer: true,
    });

    this.redis = new Redis({
      host,
      port,
      password,
      db,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 500, 5_000),
    });

    this.redis.on('error', (error: Error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  /** The raw client, for callers that need commands not exposed here. */
  get client(): Redis {
    return this.redis;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.connect();
      this.logger.log('Connected to Redis');
    } catch (error) {
      this.logger.warn(
        `Could not connect to Redis on boot: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
