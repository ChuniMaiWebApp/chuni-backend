import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import type { HealthResponseDto } from './../src/modules/health/dto/health-response.dto';
import type { HelloResponseDto } from './../src/modules/hello/dto/hello-response.dto';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1 returns the greeting', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect((response) => {
        const body = response.body as HelloResponseDto;
        expect(body.message).toContain('Hello World');
      });
  });

  it('GET /api/v1/health reports dependency status', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((response) => {
        const body = response.body as HealthResponseDto;
        expect(body.dependencies).toHaveProperty('redis');
        expect(body.dependencies).toHaveProperty('supabase');
      });
  });
});
