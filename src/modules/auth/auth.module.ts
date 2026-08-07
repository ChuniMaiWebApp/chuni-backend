import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';

import type { AppConfig } from '../../config';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginThrottleGuard } from './login-throttle.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const { jwtSecret, jwtExpiresIn } = config.get('security', {
          infer: true,
        });

        return {
          secret: jwtSecret,
          signOptions: {
            // jsonwebtoken types expiresIn as a template literal union
            // ("30d", "1h", ...), which a value read from the environment
            // cannot satisfy statically.
            expiresIn: jwtExpiresIn as SignOptions['expiresIn'],
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, JwtAuthGuard, LoginThrottleGuard],
  // Other feature modules run CHUNITHM-NET calls through AuthService so that
  // credential handling stays in one place.
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
