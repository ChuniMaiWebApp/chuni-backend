/** Base class for every failure that originates from CHUNITHM-NET. */
export class ChunithmNetError extends Error {}

/**
 * The stored `clal` cookie no longer authenticates. The user has to link their
 * account again.
 */
export class ChunithmNetAuthError extends ChunithmNetError {}

/**
 * The SEGA ID authenticated, but the account has no access code (Aime card)
 * registered, so it has no CHUNITHM profile to read.
 */
export class ChunithmNetNoAccessCodeError extends ChunithmNetError {
  constructor() {
    super(
      'This SEGA ID has no access code registered. Register one at https://my-aime.net first.',
    );
  }
}

/** CHUNITHM-NET is in its nightly maintenance window. */
export class ChunithmNetMaintenanceError extends ChunithmNetError {
  constructor() {
    super('CHUNITHM-NET is under maintenance. Try again later.');
  }
}

/**
 * CHUNITHM-NET redirected to `/mobile/error/`. The site encodes the reason as
 * a numeric code on that page.
 */
export class ChunithmNetSiteError extends ChunithmNetError {
  static readonly GENERIC = 100_001;
  static readonly LOGIN_FAILURE = 100_101;
  static readonly OLD_GAME_PROFILE = 100_106;
  static readonly INVALID_ACCESS = 120_202;
  static readonly RATE_LIMIT_EXCEEDED = 200_001;
  static readonly CONNECTION_EXPIRED = 200_002;
  static readonly INVALID_SESSION = 200_004;
  static readonly PROFILE_BANNED = 200_012;
  static readonly NOT_FOUND = 200_020;

  /** Codes that mean "your session went stale", i.e. worth re-authenticating. */
  static readonly RETRYABLE = new Set([
    ChunithmNetSiteError.CONNECTION_EXPIRED,
    ChunithmNetSiteError.INVALID_SESSION,
  ]);

  constructor(
    readonly code: number,
    readonly description: string,
  ) {
    super(`CHUNITHM-NET error ${code}: ${description}`);
  }

  get isRetryable(): boolean {
    return ChunithmNetSiteError.RETRYABLE.has(this.code);
  }
}
