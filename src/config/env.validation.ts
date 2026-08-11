import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  IsInt,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

const toBoolean = ({ value }: { value: unknown }): boolean => {
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
};

/**
 * Schema of every environment variable the application reads.
 *
 * Validation runs once at boot: the process refuses to start when a required
 * variable is missing or malformed, instead of failing later at runtime.
 */
export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3333;

  /**
   * Interface to bind to. `0.0.0.0` in development so a phone on the same
   * network can reach it; `127.0.0.1` in production, where nginx is the only
   * thing that should be able to.
   */
  @IsString()
  @IsOptional()
  HOST: string = '0.0.0.0';

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api';

  /** Comma separated list of allowed origins, or `*` to allow everything. */
  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:3100';

  /**
   * Domain to scope the session cookie to. Empty means host-only, which is
   * right when the app and the API share an origin.
   *
   * When they do not — app on chunithm-app, API on chunithm-api — a host-only
   * cookie belongs to the API host alone. The browser would still send it on
   * XHR to the API (same site), but the document request to the app host would
   * carry nothing, so the Nuxt server would render every page signed out and
   * the header would flip on hydration. Setting `.novaseele.com` makes the
   * cookie visible to both, and to the maimai hosts later.
   */
  @IsString()
  @IsOptional()
  COOKIE_DOMAIN: string = '';

  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  SWAGGER_ENABLED: boolean = true;

  /**
   * How many reverse proxies sit in front of the API.
   *
   * Express only believes `X-Forwarded-For` when this is set, and until it
   * does `request.ip` is the proxy's address — which would put every visitor
   * in one bucket in the sign-in rate limiter. In production that is 1: nginx
   * on the same host, which overwrites the header rather than appending, so a
   * client cannot forge an address by sending its own.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  @IsOptional()
  TRUST_PROXY: number = 0;

  // --- Database -------------------------------------------------------------

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  /**
   * 32-byte key, base64 encoded, used to encrypt CHUNITHM-NET cookie jars at
   * rest. Generate one with: openssl rand -base64 32
   */
  @IsString()
  @IsNotEmpty()
  ENCRYPTION_KEY: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN: string = '30d';

  // --- Supabase -------------------------------------------------------------
  // Optional. Nothing outside the health check talks to Supabase — the backend
  // reaches Postgres directly through `pg` — so a deployment that runs plain
  // Postgres instead of the whole Supabase stack leaves these blank and the
  // health check simply stops reporting on it.

  @IsString()
  @IsOptional()
  SUPABASE_URL: string = '';

  @IsString()
  @IsOptional()
  SUPABASE_ANON_KEY: string = '';

  @IsString()
  @IsOptional()
  SUPABASE_SERVICE_ROLE_KEY: string = '';

  // --- Redis ----------------------------------------------------------------

  @IsString()
  @IsOptional()
  REDIS_HOST: string = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  REDIS_PORT: number = 6379;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD: string = '';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  REDIS_DB: number = 0;

  /** 'false' disables the scheduled regional song data refresh. */
  @IsString()
  @IsOptional()
  SONG_DATA_AUTO_REFRESH: string = 'true';

  /**
   * chunirec developer API token — https://developer.chunirec.net/
   *
   * Optional so the application still boots without it, but the catalogue
   * loads with no chart constants and every rating reads as zero. Treat a
   * missing token as a broken deployment rather than a supported mode.
   */
  @IsString()
  @IsOptional()
  CHUNIREC_TOKEN: string = '';
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('\n  - ');

    throw new Error(`Invalid environment configuration:\n  - ${details}`);
  }

  return validatedConfig;
}
