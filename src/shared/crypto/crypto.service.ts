import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import type { AppConfig } from '../../config';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Authenticated encryption for secrets held at rest.
 *
 * The thing being protected is a CHUNITHM-NET cookie jar, which is a bearer
 * credential: anyone holding it can read a player's whole profile and rename
 * their account. It must never sit in the database in plaintext, and it must
 * be tamper-evident — hence GCM rather than CBC.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.key = this.config.get('security', { infer: true }).encryptionKey;
  }

  onModuleInit(): void {
    if (this.key.length !== KEY_BYTES) {
      throw new Error(
        `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${this.key.length}. ` +
          'Generate one with: openssl rand -base64 32',
      );
    }
  }

  /** Returns base64 of `iv || authTag || ciphertext`. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      'base64',
    );
  }

  /**
   * Reverses {@link encrypt}. Throws if the payload was tampered with or was
   * encrypted under a different key.
   */
  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');

    if (raw.length <= IV_BYTES + TAG_BYTES) {
      throw new Error('Encrypted payload is too short to be valid');
    }

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Constant-time comparison, for one-time codes and similar secrets. */
  static safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);

    if (left.length !== right.length) return false;

    return timingSafeEqual(left, right);
  }
}
