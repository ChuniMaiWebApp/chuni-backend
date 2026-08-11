import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SongsModule } from '../songs/songs.module';
import { ChunithmController } from './chunithm.controller';
import { ChunithmService } from './chunithm.service';
import { LinkedGateBadgesRepository } from './linked-gate-badges.repository';
import { PlayDetailsRepository } from './play-details.repository';
import { ScoreEnricherService } from './score-enricher.service';

@Module({
  imports: [AuthModule, SongsModule],
  controllers: [ChunithmController],
  providers: [
    ChunithmService,
    ScoreEnricherService,
    PlayDetailsRepository,
    LinkedGateBadgesRepository,
  ],
  exports: [ChunithmService, ScoreEnricherService],
})
export class ChunithmModule {}
