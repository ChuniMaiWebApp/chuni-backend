import { Injectable } from '@nestjs/common';

import {
  ChunithmNetSession,
  type ChunithmNetSessionOptions,
} from './chunithm-net.session';
import { RateLimiter } from './rate-limiter';

/** A `clal` cookie is 64 lowercase alphanumerics. */
const CLAL_PATTERN = /^[a-z0-9]{64}$/;

export function normalizeClal(raw: string): string | null {
  const value = raw.trim().replace(/^clal=/, '');

  return CLAL_PATTERN.test(value) ? value : null;
}

/**
 * Hands out CHUNITHM-NET sessions that all share one outbound rate limit.
 *
 * SEGA sees a single IP for the whole instance, so the ceiling has to be
 * global — 10 requests/second matches what chuni-penguin has run in production
 * without being throttled.
 */
@Injectable()
export class ChunithmNetService {
  private readonly limiter = new RateLimiter(10, 10);

  createSession(
    options: Omit<ChunithmNetSessionOptions, 'limiter'>,
  ): ChunithmNetSession {
    return new ChunithmNetSession({ ...options, limiter: this.limiter });
  }
}
