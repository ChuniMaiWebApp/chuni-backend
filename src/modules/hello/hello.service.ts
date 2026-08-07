import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config';
import { HelloResponseDto } from './dto/hello-response.dto';

@Injectable()
export class HelloService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  getHello(): HelloResponseDto {
    return {
      message: 'Hello World from ChunithmQueue API 🐧',
      environment: this.config.get('env', { infer: true }),
      timestamp: new Date().toISOString(),
    };
  }
}
