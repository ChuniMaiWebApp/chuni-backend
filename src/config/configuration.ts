import { Environment } from './env.validation';

/**
 * Typed view over the (already validated) environment.
 *
 * Consumers read config through `ConfigService<AppConfig, true>` so that
 * `config.get('redis', { infer: true })` is fully typed.
 */
export interface AppConfig {
  env: Environment;
  host: string;
  port: number;
  apiPrefix: string;
  corsOrigin: string[] | string;
  /** Cookie `Domain` attribute, or undefined for a host-only cookie. */
  cookieDomain?: string;
  swaggerEnabled: boolean;
  /** Number of reverse proxy hops Express should trust. 0 disables it. */
  trustProxy: number;
  database: {
    connectionString: string;
  };
  security: {
    /** 32-byte AES key, decoded from base64. */
    encryptionKey: Buffer;
    jwtSecret: string;
    jwtExpiresIn: string;
  };
  supabase: {
    /** False when the deployment runs plain Postgres instead of Supabase. */
    configured: boolean;
    url: string;
    anonKey: string;
    serviceRoleKey: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  songData: {
    /**
     * Whether the API refreshes the regional song data on a schedule.
     *
     * On by default: left to a human it goes stale, which is the failure this
     * whole area keeps producing. Turn it off for a process that must not make
     * outbound calls, or when a second deployment already owns the job.
     */
    autoRefresh: boolean;
  };
}

const parseCorsOrigin = (raw: string): string[] | string => {
  if (raw.trim() === '*') return '*';

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

export const configuration = (): AppConfig => ({
  env: (process.env.NODE_ENV as Environment) ?? Environment.Development,
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3333),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigin: parseCorsOrigin(
    process.env.CORS_ORIGIN ?? 'http://localhost:3100',
  ),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  database: {
    connectionString: process.env.DATABASE_URL ?? '',
  },
  security: {
    encryptionKey: Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64'),
    jwtSecret: process.env.JWT_SECRET ?? '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  },
  supabase: {
    configured: Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY,
    ),
    url: process.env.SUPABASE_URL ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB ?? 0),
  },
  songData: {
    autoRefresh: process.env.SONG_DATA_AUTO_REFRESH !== 'false',
  },
});
