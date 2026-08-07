import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';

import type { AppConfig } from '../../config';
import {
  ChunithmNetAuthError,
  ChunithmNetNoAccessCodeError,
  ChunithmNetService,
  normalizeClal,
  type ChunithmNetSession,
  type Profile,
} from '../../shared/chunithm-net';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { RedisService } from '../../shared/redis/redis.service';
import { AuthRepository, type UserRow } from './auth.repository';

export interface SessionUser {
  id: string;
  displayName: string;
  friendCode: string | null;
}

export interface LoginCode {
  code: string;
  pollToken: string;
  expiresInSeconds: number;
}

export type LoginStatus =
  | { status: 'pending' }
  | { status: 'linked'; token: string; user: SessionUser }
  | { status: 'failed'; error: string }
  | { status: 'expired' };

/** How long a player has to run the bookmarklet after starting a login. */
const LOGIN_CODE_TTL_SECONDS = 300;
/** The result lingers a little longer so slow polling still picks it up. */
const LOGIN_RESULT_TTL_SECONDS = 120;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repository: AuthRepository,
    private readonly crypto: CryptoService,
    private readonly chunithmNet: ChunithmNetService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private toSessionUser(user: UserRow): SessionUser {
    return {
      id: user.id,
      displayName: user.display_name,
      friendCode: user.friend_code,
    };
  }

  private issueToken(user: UserRow): string {
    return this.jwt.sign({ sub: user.id, name: user.display_name });
  }

  /**
   * Validates a `clal` cookie against CHUNITHM-NET and links it to a player.
   *
   * The password is never involved: the player authenticates on SEGA's own
   * site and only the resulting session cookie reaches us.
   */
  async linkAccount(
    rawClal: string,
  ): Promise<{ token: string; user: SessionUser }> {
    const clal = normalizeClal(rawClal);

    if (!clal) {
      throw new BadRequestException(
        'That does not look like a clal cookie: expected 64 lowercase letters and digits.',
      );
    }

    const session = this.chunithmNet.createSession({ clal });

    let profile: Profile;
    try {
      // Doubles as validation — a bad cookie cannot get past the SSO.
      profile = await session.getProfile();
    } catch (error) {
      if (error instanceof ChunithmNetAuthError) {
        throw new UnauthorizedException(error.message);
      }

      throw error;
    }

    const user = await this.repository.linkAccount({
      friendCode: profile.friendCode,
      displayName: profile.username,
      encryptedJar: this.crypto.encrypt(session.serializeCookies()),
    });

    this.logger.log(`Linked CHUNITHM-NET account for ${profile.username}`);

    return { token: this.issueToken(user), user: this.toSessionUser(user) };
  }

  /**
   * Signs in with a SEGA ID and links the resulting CHUNITHM-NET session.
   *
   * The password is passed straight through to SEGA and dropped: it is never
   * written to the database, never logged, and never leaves this method. What
   * is persisted is the cookie jar SEGA hands back, encrypted at rest.
   */
  async loginWithCredentials(
    username: string,
    password: string,
  ): Promise<{ token: string; user: SessionUser }> {
    const session = this.chunithmNet.createSession({});

    try {
      await session.loginWithCredentials(username, password);
    } catch (error) {
      if (
        error instanceof ChunithmNetAuthError ||
        error instanceof ChunithmNetNoAccessCodeError
      ) {
        throw new UnauthorizedException(error.message);
      }

      throw error;
    }

    const profile = await session.getProfile();

    const user = await this.repository.linkAccount({
      friendCode: profile.friendCode,
      displayName: profile.username,
      encryptedJar: this.crypto.encrypt(session.serializeCookies()),
    });

    // Deliberately logs the CHUNITHM name, never the SEGA ID.
    this.logger.log(`Signed in CHUNITHM-NET account for ${profile.username}`);

    return { token: this.issueToken(user), user: this.toSessionUser(user) };
  }

  /**
   * Starts a bookmarklet login.
   *
   * The 6-digit code is what the player types into the bookmarklet, so it has
   * to stay short. Polling therefore uses a separate 32-byte token that is
   * never shown outside this browser, which keeps the short code from being
   * something an attacker could guess their way into.
   */
  async createLoginCode(): Promise<LoginCode> {
    const code = String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(
      6,
      '0',
    );
    const pollToken = randomBytes(32).toString('base64url');

    await this.redis.client.set(
      `login:code:${code}`,
      pollToken,
      'EX',
      LOGIN_CODE_TTL_SECONDS,
    );
    await this.redis.client.set(
      `login:session:${pollToken}`,
      JSON.stringify({ status: 'pending' }),
      'EX',
      LOGIN_CODE_TTL_SECONDS,
    );

    return { code, pollToken, expiresInSeconds: LOGIN_CODE_TTL_SECONDS };
  }

  /** Called by the bookmarklet running on SEGA's domain. */
  async completeLoginCode(code: string, rawClal: string): Promise<void> {
    const pollToken = await this.redis.client.get(`login:code:${code}`);

    if (!pollToken) {
      throw new BadRequestException('That login code has expired.');
    }

    // One code, one use.
    await this.redis.client.del(`login:code:${code}`);

    try {
      const result = await this.linkAccount(rawClal);

      await this.redis.client.set(
        `login:session:${pollToken}`,
        JSON.stringify({ status: 'linked', ...result }),
        'EX',
        LOGIN_RESULT_TTL_SECONDS,
      );
    } catch (error) {
      await this.redis.client.set(
        `login:session:${pollToken}`,
        JSON.stringify({
          status: 'failed',
          error: (error as Error).message,
        }),
        'EX',
        LOGIN_RESULT_TTL_SECONDS,
      );

      throw error;
    }
  }

  async getLoginStatus(pollToken: string): Promise<LoginStatus> {
    const raw = await this.redis.client.get(`login:session:${pollToken}`);

    if (!raw) return { status: 'expired' };

    // Consume the result so a leaked poll token cannot mint a second token.
    const parsed = JSON.parse(raw) as LoginStatus;

    if (parsed.status !== 'pending') {
      await this.redis.client.del(`login:session:${pollToken}`);
    }

    return parsed;
  }

  async getUser(userId: string): Promise<SessionUser> {
    const user = await this.repository.findUserById(userId);

    if (!user)
      throw new UnauthorizedException('This account no longer exists.');

    return this.toSessionUser(user);
  }

  /**
   * Opens a CHUNITHM-NET session for a linked player and persists the refreshed
   * cookie jar afterwards.
   *
   * Every route that touches CHUNITHM-NET goes through here, so credential
   * handling lives in exactly one place.
   */
  async withChunithmSession<T>(
    userId: string,
    fn: (session: ChunithmNetSession) => Promise<T>,
  ): Promise<T> {
    const link = await this.repository.findLink(userId);

    if (!link) {
      throw new UnauthorizedException(
        'No CHUNITHM-NET account is linked. Please link one first.',
      );
    }

    if (link.invalidated_at) {
      throw new UnauthorizedException(
        'Your CHUNITHM-NET token expired. Please link your account again.',
      );
    }

    const session = this.chunithmNet.createSession({
      cookieJar: this.crypto.decrypt(link.cookie_jar),
    });

    try {
      const result = await fn(session);

      // The jar picks up a refreshed session cookie on almost every call.
      await this.repository.saveCookieJar(
        userId,
        this.crypto.encrypt(session.serializeCookies()),
      );

      return result;
    } catch (error) {
      if (error instanceof ChunithmNetAuthError) {
        await this.repository.invalidateLink(userId, error.message);

        throw new UnauthorizedException(
          'Your CHUNITHM-NET token expired. Please link your account again.',
        );
      }

      throw error;
    }
  }

  /**
   * Unlinks the account. The CHUNITHM-NET side is only signed out when asked,
   * because invalidating the token breaks any other tool the player linked
   * with the same cookie.
   */
  async unlink(userId: string, invalidateRemote: boolean): Promise<void> {
    if (invalidateRemote) {
      try {
        await this.withChunithmSession(userId, (session) => session.logout());
      } catch (error) {
        this.logger.warn(
          `Could not sign out of CHUNITHM-NET: ${(error as Error).message}`,
        );
      }
    }

    await this.repository.deleteLink(userId);
  }
}
