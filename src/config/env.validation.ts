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

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api';

  /** Comma separated list of allowed origins, or `*` to allow everything. */
  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:3100';

  @Transform(toBoolean)
  @IsBoolean()
  @IsOptional()
  SWAGGER_ENABLED: boolean = true;

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

  @IsString()
  @IsNotEmpty()
  SUPABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  SUPABASE_ANON_KEY: string;

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
