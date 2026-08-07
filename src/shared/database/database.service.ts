import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import type { AppConfig } from '../../config';

/**
 * Direct Postgres access for tables the backend owns.
 *
 * Supabase's PostgREST is meant for clients that authenticate as an end user
 * and rely on row level security. The backend is trusted and needs bulk writes
 * and joins, so it talks to Postgres directly and leaves PostgREST for the
 * browser-facing surface.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const { connectionString } = this.config.get('database', { infer: true });

    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    this.pool.on('error', (error) => {
      this.logger.error(`Idle client error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.pool.query('select 1');
      this.logger.log('Connected to Postgres');
    } catch (error) {
      // Same policy as Redis: a database that is down must not stop the API
      // from booting, it only makes /health report degraded.
      this.logger.warn(
        `Could not reach Postgres on boot: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  async query<T extends QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, params);

    return result.rows;
  }

  async queryOne<T extends QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const [row] = await this.query<T>(text, params);

    return row ?? null;
  }

  /** Runs `fn` inside a transaction, rolling back if it throws. */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');

      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }
}
