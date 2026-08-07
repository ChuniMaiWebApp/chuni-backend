import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { configuration, validateEnv } from './config';
import { AuthModule } from './modules/auth/auth.module';
import { ChunithmModule } from './modules/chunithm/chunithm.module';
import { HealthModule } from './modules/health/health.module';
import { HelloModule } from './modules/hello/hello.module';
import { RecordsModule } from './modules/records/records.module';
import { SongDataModule } from './modules/song-data/song-data.module';
import { SongsModule } from './modules/songs/songs.module';
import { ToolsModule } from './modules/tools/tools.module';
import { ChunithmNetModule } from './shared/chunithm-net';
import { CryptoModule } from './shared/crypto/crypto.module';
import { DatabaseModule } from './shared/database/database.module';
import { RedisModule } from './shared/redis/redis.module';
import { SupabaseModule } from './shared/supabase/supabase.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      load: [configuration],
      validate: validateEnv,
    }),

    // Infrastructure (global providers)
    DatabaseModule,
    RedisModule,
    SupabaseModule,
    CryptoModule,
    ChunithmNetModule,

    // Feature modules
    HelloModule,
    HealthModule,
    AuthModule,
    ChunithmModule,
    SongsModule,
    SongDataModule,
    ToolsModule,
    RecordsModule,
  ],
})
export class AppModule {}
