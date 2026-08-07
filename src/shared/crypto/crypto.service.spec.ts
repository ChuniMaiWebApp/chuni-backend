import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { CryptoService } from './crypto.service';

const withKey = (key: Buffer) =>
  new CryptoService({
    get: () => ({ encryptionKey: key }),
  } as unknown as ConfigService<never, true>);

describe('CryptoService', () => {
  const service = withKey(randomBytes(32));

  it('round-trips a cookie jar', () => {
    const jar = JSON.stringify({
      cookies: [{ key: 'clal', value: 'a'.repeat(64) }],
    });

    expect(service.decrypt(service.encrypt(jar))).toBe(jar);
  });

  it('produces a different ciphertext each time', () => {
    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('rejects a tampered payload', () => {
    const encrypted = service.encrypt('secret');
    const raw = Buffer.from(encrypted, 'base64');

    // Flip a bit in the ciphertext body.
    raw[raw.length - 1] ^= 0x01;

    expect(() => service.decrypt(raw.toString('base64'))).toThrow();
  });

  it('rejects a payload encrypted under another key', () => {
    const other = withKey(randomBytes(32));

    expect(() => other.decrypt(service.encrypt('secret'))).toThrow();
  });

  it('refuses to start with a wrong-sized key', () => {
    expect(() => withKey(randomBytes(16)).onModuleInit()).toThrow(
      /must decode to 32 bytes/,
    );
  });

  it('compares in constant time without leaking length mismatches', () => {
    expect(CryptoService.safeEqual('123456', '123456')).toBe(true);
    expect(CryptoService.safeEqual('123456', '123457')).toBe(false);
    expect(CryptoService.safeEqual('123456', '1234')).toBe(false);
  });
});
