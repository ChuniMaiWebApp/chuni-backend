import { Global, Module } from '@nestjs/common';

import { ChunithmNetService } from './chunithm-net.service';

@Global()
@Module({
  providers: [ChunithmNetService],
  exports: [ChunithmNetService],
})
export class ChunithmNetModule {}
