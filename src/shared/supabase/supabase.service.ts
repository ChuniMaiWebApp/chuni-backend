import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

import type { AppConfig } from '../../config';

/**
 * The concrete client type produced by `createClient`. Derived instead of
 * hand-written so it stays correct when generated database types are added
 * later (`createClient<Database>(...)`).
 */
export type AppSupabaseClient = ReturnType<typeof createClient>;

/**
 * Holds the Supabase clients used by the application.
 *
 * - `client` uses the service role key and bypasses RLS. Server side only.
 * - `anonClient` uses the anon key and respects RLS, for acting on behalf of
 *   an end user.
 *
 * Optional by design. Every table the backend owns is reached through `pg`
 * directly (see DatabaseService), so a deployment can run plain Postgres and
 * leave SUPABASE_URL blank. In that mode `isConfigured` is false, the getters
 * throw rather than hand back a client built on empty strings, and the health
 * check drops the dependency instead of reporting it down forever.
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);

  private readonly serviceClient: AppSupabaseClient | null;
  private readonly publicClient: AppSupabaseClient | null;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const { configured, url, anonKey, serviceRoleKey } = this.config.get(
      'supabase',
      { infer: true },
    );

    if (!configured) {
      this.publicClient = null;
      this.serviceClient = null;
      return;
    }

    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
    };

    this.publicClient = createClient(url, anonKey, options);
    this.serviceClient = createClient(url, serviceRoleKey || anonKey, options);
  }

  onModuleInit(): void {
    const { configured, serviceRoleKey } = this.config.get('supabase', {
      infer: true,
    });

    if (!configured) {
      this.logger.log(
        'SUPABASE_URL is not set — running against Postgres directly.',
      );
      return;
    }

    if (!serviceRoleKey) {
      this.logger.warn(
        'SUPABASE_SERVICE_ROLE_KEY is not set — falling back to the anon key. ' +
          'Row level security will apply to server side queries.',
      );
    }
  }

  /** Whether this deployment has a Supabase stack at all. */
  get isConfigured(): boolean {
    return this.serviceClient !== null;
  }

  /** Service role client: full access, bypasses row level security. */
  get client(): AppSupabaseClient {
    if (!this.serviceClient) {
      throw new Error('Supabase is not configured on this deployment.');
    }

    return this.serviceClient;
  }

  /** Anon client: subject to row level security. */
  get anonClient(): AppSupabaseClient {
    if (!this.publicClient) {
      throw new Error('Supabase is not configured on this deployment.');
    }

    return this.publicClient;
  }

  /**
   * Liveness probe for the Kong gateway. `null` when there is nothing to probe.
   *
   * Deliberately hits GoTrue's health endpoint rather than PostgREST: this
   * instance's kong.yml routes `/rest` (not `/rest/v1`) with strip_path, so
   * `/rest/v1/` resolves to a table named "v1" and always 404s. `/auth/health`
   * needs no API key and answers only when Kong is actually routing.
   */
  async ping(): Promise<boolean | null> {
    const { configured, url } = this.config.get('supabase', { infer: true });

    if (!configured) return null;

    try {
      const response = await fetch(`${url}/auth/health`, {
        signal: AbortSignal.timeout(3_000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
