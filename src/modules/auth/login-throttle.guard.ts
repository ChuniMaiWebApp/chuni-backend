import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { RedisService } from '../../shared/redis/redis.service';

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS_PER_IP = 10;
const MAX_ATTEMPTS_PER_ACCOUNT = 5;

/**
 * Rate limits sign-in attempts.
 *
 * This endpoint forwards credentials to SEGA, so an unthrottled version would
 * turn the app into a password-spraying proxy against SEGA accounts — and get
 * the server's IP banned in the process.
 *
 * Two counters: per IP to stop one host trying many accounts, and per account
 * to stop a botnet grinding one account from many hosts.
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  private async hit(key: string, limit: number): Promise<boolean> {
    const attempts = await this.redis.client.incr(key);

    if (attempts === 1) {
      await this.redis.client.expire(key, WINDOW_SECONDS);
    }

    return attempts <= limit;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? 'unknown';
    // The guard runs before validation, so the body is still untrusted here.
    const submitted = (request.body as { username?: unknown } | undefined)
      ?.username;
    const username =
      typeof submitted === 'string' ? submitted.trim().toLowerCase() : '';

    const checks = [this.hit(`throttle:login:ip:${ip}`, MAX_ATTEMPTS_PER_IP)];

    if (username) {
      checks.push(
        this.hit(`throttle:login:sid:${username}`, MAX_ATTEMPTS_PER_ACCOUNT),
      );
    }

    const results = await Promise.all(checks);

    if (results.some((allowed) => !allowed)) {
      throw new HttpException(
        'Too many sign-in attempts. Wait 15 minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
