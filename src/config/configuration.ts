import { Environment } from './env.validation';

/**
 * Typed view over the (already validated) environment.
 *
 * Consumers read config through `ConfigService<AppConfig, true>` so that
 * `config.get('redis', { infer: true })` is fully typed.
 */
export interface AppConfig {
  env: Environment;
  port: number;
  apiPrefix: string;
  corsOrigin: string[] | string;
  swaggerEnabled: boolean;
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
  port: Number(process.env.PORT ?? 3333),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigin: parseCorsOrigin(
    process.env.CORS_ORIGIN ?? 'http://localhost:3100',
  ),
  swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
  database: {
    connectionString: process.env.DATABASE_URL ?? '',
  },
  security: {
    encryptionKey: Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64'),
    jwtSecret: process.env.JWT_SECRET ?? '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  },
  supabase: {
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
