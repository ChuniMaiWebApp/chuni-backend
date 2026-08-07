import { Module } from '@nestjs/common';

import { SongsController } from './songs.controller';
import { SongsRepository } from './songs.repository';
import { SongsService } from './songs.service';

@Module({
  controllers: [SongsController],
  providers: [SongsService, SongsRepository],
  exports: [SongsService, SongsRepository],
})
export class SongsModule {}
