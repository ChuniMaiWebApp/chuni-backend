import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { HelloService } from './hello.service';

describe('HelloService', () => {
  let service: HelloService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HelloService,
        { provide: ConfigService, useValue: { get: () => 'test' } },
      ],
    }).compile();

    service = module.get(HelloService);
  });

  it('returns a greeting with the current environment', () => {
    const result = service.getHello();

    expect(result.message).toContain('Hello World');
    expect(result.environment).toBe('test');
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });
});
