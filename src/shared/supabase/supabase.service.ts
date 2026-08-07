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
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);

  private readonly serviceClient: AppSupabaseClient;
  private readonly publicClient: AppSupabaseClient;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const { url, anonKey, serviceRoleKey } = this.config.get('supabase', {
      infer: true,
    });

    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
    };

    this.publicClient = createClient(url, anonKey, options);
    this.serviceClient = createClient(url, serviceRoleKey || anonKey, options);
  }

  onModuleInit(): void {
    const { serviceRoleKey } = this.config.get('supabase', { infer: true });

    if (!serviceRoleKey) {
      this.logger.warn(
        'SUPABASE_SERVICE_ROLE_KEY is not set — falling back to the anon key. ' +
          'Row level security will apply to server side queries.',
      );
    }
  }

  /** Service role client: full access, bypasses row level security. */
  get client(): AppSupabaseClient {
    return this.serviceClient;
  }

  /** Anon client: subject to row level security. */
  get anonClient(): AppSupabaseClient {
    return this.publicClient;
  }

  /**
   * Liveness probe for the Kong gateway.
   *
   * Deliberately hits GoTrue's health endpoint rather than PostgREST: this
   * instance's kong.yml routes `/rest` (not `/rest/v1`) with strip_path, so
   * `/rest/v1/` resolves to a table named "v1" and always 404s. `/auth/health`
   * needs no API key and answers only when Kong is actually routing.
   */
  async ping(): Promise<boolean> {
    const { url } = this.config.get('supabase', { infer: true });

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
