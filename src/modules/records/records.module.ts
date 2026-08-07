import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RecordsController } from './records.controller';
import { RecordsRepository } from './records.repository';
import { RecordsService } from './records.service';

@Module({
  imports: [AuthModule],
  controllers: [RecordsController],
  providers: [RecordsService, RecordsRepository],
  exports: [RecordsService],
})
export class RecordsModule {}
