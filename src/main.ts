import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import type { AppConfig } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService<AppConfig, true>);

  const host = config.get('host', { infer: true });
  const port = config.get('port', { infer: true });
  const apiPrefix = config.get('apiPrefix', { infer: true });
  const corsOrigin = config.get('corsOrigin', { infer: true });
  const swaggerEnabled = config.get('swaggerEnabled', { infer: true });
  const trustProxy = config.get('trustProxy', { infer: true });

  // Behind nginx, every request arrives from 127.0.0.1. Until Express is told
  // how many proxies to look through, `request.ip` is that loopback address
  // for everyone — which would collapse the whole player base into a single
  // bucket in the sign-in rate limiter and lock everybody out after ten tries.
  if (trustProxy > 0) {
    app.set('trust proxy', trustProxy);
  }

  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: corsOrigin, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  app.enableShutdownHooks();

  if (swaggerEnabled) {
    const documentConfig = new DocumentBuilder()
      .setTitle('ChunithmQueue API')
      .setDescription('Backend API for the Chunithm queue web app')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(port, host);

  const logger = new Logger('Bootstrap');
  logger.log(`API      → http://localhost:${port}/${apiPrefix}/v1`);
  logger.log(`Health   → http://localhost:${port}/${apiPrefix}/v1/health`);

  if (swaggerEnabled) {
    logger.log(`Swagger  → http://localhost:${port}/${apiPrefix}/docs`);
  }
}

void bootstrap();
