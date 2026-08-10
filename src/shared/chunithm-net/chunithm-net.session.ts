import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { load } from 'cheerio';
import { HttpCookieAgent, HttpsCookieAgent } from 'http-cookie-agent/http';
import { Cookie, CookieJar, type SerializedCookieJar } from 'tough-cookie';

import {
  ChunithmNetAuthError,
  ChunithmNetError,
  ChunithmNetMaintenanceError,
  ChunithmNetNoAccessCodeError,
  ChunithmNetSiteError,
} from './chunithm-net.errors';
import {
  Difficulty,
  type PersonalBest,
  type Profile,
  type RecentScore,
} from './chunithm-net.types';
import { parseLoginBonus, type LoginBonus } from './parsing/login-bonus.parser';
import {
  parseCollectionCustomise,
  parseHomePage,
  parsePlayerData,
  type PlayerCollections,
} from './parsing/profile.parser';
import {
  parseLeaderboard,
  parseLinkedVerse,
  parseRanking,
  readRatingFromImages,
  type Leaderboard,
} from './parsing/ranking.parser';
import { chuniInt } from './parsing/utils';
import {
  parseMusicList,
  parseMusicRecordDetail,
  parsePlaylog,
  parsePlaylogDetail,
} from './parsing/record.parser';
import type { RateLimiter } from './rate-limiter';

const BASE_URL = 'https://chunithm-net-eng.com';
const AIME_HOST = 'https://lng-tgk-aime-gw.am-all.net';

/** Landing the SEGA SSO uses to hand a session back to CHUNITHM-NET. */
const AUTH_URL =
  `${AIME_HOST}/common_auth/login` +
  `?site_id=chuniex` +
  `&redirect_url=${BASE_URL}/mobile/` +
  `&back_url=https://chunithm.sega.com/`;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface ChunithmNetSessionOptions {
  /** Serialized tough-cookie jar from a previous session, if any. */
  cookieJar?: string;
  /** The raw `clal` value, used to bootstrap a jar on first login. */
  clal?: string;
  limiter: RateLimiter;
}

/**
 * One authenticated CHUNITHM-NET session, backed by its own cookie jar.
 *
 * Instances are cheap and intentionally short lived: create one per request,
 * persist {@link serializeCookies} afterwards so the SSO round trip is skipped
 * next time.
 */
export class ChunithmNetSession {
  private readonly jar: CookieJar;
  private readonly http: AxiosInstance;
  private readonly limiter: RateLimiter;

  /**
   * Tail of the in-flight request chain.
   *
   * CHUNITHM-NET rotates its `_t` token on every response, so two requests on
   * one session race: the second sends a token the first already replaced and
   * SEGA answers with error 100001 ("please login again"). Everything is
   * therefore queued, which makes it safe for callers to use `Promise.all`
   * even though the work ends up sequential.
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: ChunithmNetSessionOptions) {
    this.limiter = options.limiter;
    this.jar = options.cookieJar
      ? CookieJar.deserializeSync(
          JSON.parse(options.cookieJar) as SerializedCookieJar,
        )
      : new CookieJar();

    if (options.clal) this.setClal(options.clal);

    // The jar is attached at the agent level so it survives the SSO redirect
    // chain across chunithm-net-eng.com and am-all.net.
    const cookies = { jar: this.jar };

    this.http = axios.create({
      baseURL: BASE_URL,
      httpAgent: new HttpCookieAgent({ cookies }),
      httpsAgent: new HttpsCookieAgent({ cookies }),
      timeout: 30_000,
      maxRedirects: 10,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `${BASE_URL}/mobile/`,
      },
      // Redirects to the error page still carry useful bodies.
      validateStatus: (status) => status < 500,
    });
  }

  /** Seeds the jar with a `clal` cookie scoped exactly as SEGA sets it. */
  private setClal(clal: string): void {
    const value = clal.startsWith('clal=') ? clal.slice(5) : clal;

    this.jar.setCookieSync(
      new Cookie({
        key: 'clal',
        value,
        domain: 'lng-tgk-aime-gw.am-all.net',
        path: '/common_auth',
        httpOnly: false,
        secure: true,
        // SEGA issues these effectively forever; mirror that so tough-cookie
        // does not drop it as a session cookie when serialized.
        expires: new Date('2099-01-01T00:00:00Z'),
      }),
      `${AIME_HOST}/common_auth`,
    );
  }

  /** Snapshot of the jar, to be stored (encrypted) against the user. */
  serializeCookies(): string {
    return JSON.stringify(this.jar.serializeSync());
  }

  /** CSRF-ish token CHUNITHM-NET requires on every POST. */
  private get token(): string {
    const cookies = this.jar.getCookiesSync(BASE_URL);

    return cookies.find((cookie) => cookie.key === '_t')?.value ?? '';
  }

  private static finalUrl(response: AxiosResponse): string {
    const request = response.request as { res?: { responseUrl?: string } };

    return request?.res?.responseUrl ?? '';
  }

  /**
   * Detects the two ways CHUNITHM-NET signals a dead session: a redirect back
   * to `/mobile/`, or a redirect to `/mobile/error/` with a code.
   */
  private static inspect(response: AxiosResponse): {
    needsAuth: boolean;
    error?: ChunithmNetSiteError;
  } {
    const url = ChunithmNetSession.finalUrl(response);
    const path = url ? new URL(url).pathname : '';

    if (path === '/mobile/' || path === '/mobile') {
      return { needsAuth: true };
    }

    if (path !== '/mobile/error/') return { needsAuth: false };

    const $ = load(String(response.data));
    const blocks = $('.block.text_l .font_small');
    const code = Number.parseInt(
      ($(blocks[0]).text().split(': ')[1] ?? '0').trim(),
      10,
    );
    const description = blocks.length > 1 ? $(blocks[1]).text() : '';
    const error = new ChunithmNetSiteError(code, description);

    return { needsAuth: error.isRetryable, error };
  }

  /**
   * Walks the SEGA SSO with the `clal` cookie to mint a fresh CHUNITHM-NET
   * session. Throws if the cookie is no longer good.
   */
  private async authenticate(): Promise<void> {
    await this.limiter.acquire();

    const response = await this.http.get(AUTH_URL, { baseURL: undefined });
    const url = ChunithmNetSession.finalUrl(response);

    // Being left on the SSO host means the cookie was rejected.
    if (!url || new URL(url).host === new URL(AIME_HOST).host) {
      throw new ChunithmNetAuthError(
        'The stored CHUNITHM-NET token is no longer valid. Please link your account again.',
      );
    }
  }

  /**
   * Signs in with a SEGA ID and exchanges it for a CHUNITHM-NET session.
   *
   * The password is used for exactly one request and is never retained: what
   * survives is the cookie jar, which the caller stores encrypted. SEGA has no
   * OAuth for this, so there is no way to avoid handling the password at all.
   *
   * Accounts with TOTP enabled cannot complete this flow — SEGA answers with
   * the same "invalid credentials" page, so the two are indistinguishable here.
   */
  loginWithCredentials(username: string, password: string): Promise<void> {
    // Two dependent requests: queue them as one unit so nothing slips between
    // establishing the SSO context and submitting the credentials.
    return this.serialize(() => this.performLogin(username, password));
  }

  private async performLogin(
    username: string,
    password: string,
  ): Promise<void> {
    // The SSO needs to know which title is being authenticated for before it
    // will accept credentials, so establish that context first.
    await this.limiter.acquire();
    await this.http.get(AUTH_URL, { baseURL: undefined });

    await this.limiter.acquire();
    const response = await this.http.post(
      `${AIME_HOST}/common_auth/login/sid`,
      new URLSearchParams({
        retention: '1', // ask for a long-lived clal cookie
        sid: username,
        password,
      }),
      {
        baseURL: undefined,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    const url = ChunithmNetSession.finalUrl(response);

    if (!url) {
      throw new ChunithmNetAuthError('SEGA did not respond to the sign-in.');
    }

    const target = new URL(url);
    const isAimeHost = target.host === new URL(AIME_HOST).host;

    // Bounced back to the login form.
    if (isAimeHost && target.pathname.startsWith('/common_auth/login')) {
      throw new ChunithmNetAuthError(
        'Wrong SEGA ID or password. If the account uses two-factor authentication, ' +
          'sign in with a CHUNITHM-NET cookie instead.',
      );
    }

    // Authenticated, but SEGA wants an access code registered first.
    if (
      String(response.data).includes(
        'https://common-access.am-all.net/access/code/add',
      )
    ) {
      throw new ChunithmNetNoAccessCodeError();
    }

    if (isAimeHost) {
      throw new ChunithmNetAuthError(
        'SEGA rejected the sign-in for an unknown reason.',
      );
    }

    if (!this.hasSessionCookie()) {
      throw new ChunithmNetAuthError(
        'Signed in, but SEGA did not issue a CHUNITHM-NET session.',
      );
    }
  }

  /** True once the SSO has handed us a reusable `clal`. */
  private hasSessionCookie(): boolean {
    return this.jar
      .getCookiesSync(`${AIME_HOST}/common_auth`)
      .some((cookie) => cookie.key === 'clal' && cookie.value.length > 0);
  }

  /** Runs `fn` after every previously queued operation on this session. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    // Chain off a settled copy so one failure does not poison the queue.
    const result = this.chain.then(fn, fn);

    this.chain = result.catch(() => undefined);

    return result;
  }

  private request(
    method: 'GET' | 'POST',
    path: string,
    data?: Record<string, string | string[]>,
  ): Promise<string> {
    // The whole operation — including any re-auth and retry — holds the queue,
    // so a token refresh can never interleave with another request.
    return this.serialize(() => this.performRequest(method, path, data, false));
  }

  private async performRequest(
    method: 'GET' | 'POST',
    path: string,
    data?: Record<string, string | string[]>,
    isRetry = false,
  ): Promise<string> {
    await this.limiter.acquire();

    const body = data
      ? new URLSearchParams(
          Object.entries({ ...data, token: this.token }).flatMap(
            ([key, value]) =>
              Array.isArray(value)
                ? value.map((item) => [key, item] as [string, string])
                : [[key, value] as [string, string]],
          ),
        )
      : undefined;

    const response = await this.http.request({
      method,
      url: path,
      data: body,
      headers: data
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : undefined,
    });

    if (response.status === 405 && path.startsWith('mobile/ranking/')) {
      throw new ChunithmNetMaintenanceError();
    }

    const { needsAuth, error } = ChunithmNetSession.inspect(response);

    if (needsAuth) {
      if (isRetry) {
        throw (
          error ??
          new ChunithmNetAuthError(
            'CHUNITHM-NET kept redirecting to the login page.',
          )
        );
      }

      await this.authenticate();

      return this.performRequest(method, path, data, true);
    }

    if (error) throw error;

    return String(response.data);
  }

  /**
   * Cheap probe that both validates the session and returns the player card.
   * Used at link time to reject a bad `clal` immediately.
   */
  async getHomePage(): Promise<Profile> {
    return parseHomePage(await this.request('GET', 'mobile/home/'));
  }

  async getProfile(): Promise<Profile> {
    return parsePlayerData(await this.request('GET', 'mobile/home/playerData'));
  }

  /**
   * The player's equipped cosmetics.
   *
   * Separate page from the player data, so asking for the nameplate banner
   * costs a second request.
   */
  async getCollections(): Promise<PlayerCollections> {
    return parseCollectionCustomise(
      await this.request('GET', 'mobile/collection/customise'),
    );
  }

  /** Player data plus the nameplate banner, which lives on another page. */
  async getFullProfile(): Promise<Profile> {
    const [profile, collections] = await Promise.all([
      this.getProfile(),
      this.getCollections(),
    ]);

    profile.banner = collections.nameplate;

    return profile;
  }

  async getRecentScores(): Promise<RecentScore[]> {
    return parsePlaylog(await this.request('GET', 'mobile/record/playlog'));
  }

  /**
   * Fetches judgements and note accuracy for one playlog entry.
   *
   * `playlogIndex` is positional and shifts as new plays are recorded, so it
   * must come from a playlog fetched moments earlier.
   */
  async getRecentScoreDetail(playlogIndex: number): Promise<RecentScore> {
    return parsePlaylogDetail(
      await this.request('POST', 'mobile/record/playlog/sendPlaylogDetail/', {
        idx: String(playlogIndex),
      }),
    );
  }

  /**
   * Every personal best on one difficulty, across all genres.
   *
   * Unlike the rating detail pages this one carries badge icons, so it is the
   * only way to learn clear/combo lamps for a chart — which OVER POWER needs,
   * since FULL COMBO and ALL JUSTICE add a bonus.
   */
  async getPersonalBestsByDifficulty(
    difficulty: Difficulty,
  ): Promise<PersonalBest[]> {
    if (difficulty === Difficulty.WORLDS_END) {
      return parseMusicList(
        await this.request('GET', 'mobile/record/worldsEndList'),
      );
    }

    // sendBasic / sendAdvanced / sendExpert / sendMaster / sendUltima
    const name = Difficulty[difficulty];
    const endpoint = `send${name.charAt(0)}${name.slice(1).toLowerCase()}`;

    return parseMusicList(
      await this.request('POST', `mobile/record/musicGenre/${endpoint}`, {
        genre: '99', // all genres
      }),
    );
  }

  /**
   * High scores and exact Play Count for all difficulties of a specific song.
   */
  async getMusicRecordDetail(songId: number): Promise<PersonalBest[]> {
    return parseMusicRecordDetail(
      await this.request('POST', 'mobile/record/musicGenre/sendMusicDetail/', {
        idx: String(songId),
      }),
    );
  }

  /**
   * Every personal best the player has, across all difficulties.
   *
   * Costs one request per difficulty. Runs sequentially on purpose: firing all
   * five at once would burst straight through the shared rate limit and is the
   * kind of traffic that gets an instance blocked.
   */
  async getAllPersonalBests(): Promise<PersonalBest[]> {
    const all: PersonalBest[] = [];

    for (const difficulty of [
      Difficulty.BASIC,
      Difficulty.ADVANCED,
      Difficulty.EXPERT,
      Difficulty.MASTER,
      Difficulty.ULTIMA,
    ]) {
      all.push(...(await this.getPersonalBestsByDifficulty(difficulty)));
    }

    return all;
  }

  /** The 30 old-version scores the game itself counts towards rating. */
  async getBest30(): Promise<PersonalBest[]> {
    return parseMusicList(
      await this.request('GET', 'mobile/home/playerData/ratingDetailBest/'),
    );
  }

  /** The 20 current-version scores counted towards rating. */
  async getNew20(): Promise<PersonalBest[]> {
    return parseMusicList(
      await this.request('GET', 'mobile/home/playerData/ratingDetailRecent/'),
    );
  }

  /**
   * A chart's leaderboard.
   *
   * Any signed-in session can read this, so it uses the player's own session
   * rather than needing a service account like the Discord bot does.
   */
  async getChartLeaderboard(
    songId: number,
    difficulty: Difficulty,
  ): Promise<Leaderboard> {
    if (difficulty === Difficulty.WORLDS_END) {
      return parseLeaderboard(
        await this.request(
          'POST',
          'mobile/ranking/worldsEnd/sendWorldsEndRankingDetail/',
          { idx: String(songId) },
        ),
      );
    }

    return parseLeaderboard(
      await this.request('POST', 'mobile/ranking/sendRankingDetail/', {
        diff: String(difficulty),
        idx: String(songId),
        genre: '99',
      }),
    );
  }

  /**
   * Site-wide rating ranking.
   *
   * `friend` needs a POST because CHUNITHM-NET treats it as a filtered search
   * rather than a page of its own.
   */
  async getRatingRanking(scope: 'global' | 'friend' = 'global') {
    const html =
      scope === 'global'
        ? await this.request('GET', 'mobile/ranking/rating/')
        : await this.request('POST', 'mobile/ranking/rating/sendSearch/', {
            category: '3',
          });

    return parseRanking(html, '.rank_block_rating_num', readRatingFromImages);
  }

  /** Site-wide total high score ranking. */
  async getScoreRanking() {
    return parseRanking(
      await this.request('GET', 'mobile/ranking/totalHighScore/'),
      '.rank_block_num_s',
      (text) => chuniInt(text),
    );
  }

  /** Site-wide total currency ranking. */
  async getCurrencyRanking() {
    return parseRanking(
      await this.request('GET', 'mobile/ranking/totalPoint/'),
      '.rank_block_num_s',
      (text) => chuniInt(text),
    );
  }

  async getLoginBonus(): Promise<LoginBonus> {
    return parseLoginBonus(await this.request('GET', 'mobile/loginBonus/'));
  }

  async getLinkedVerseProgress() {
    return parseLinkedVerse(
      await this.request('GET', 'mobile/home/linkedVerse/'),
    );
  }

  /**
   * Changes the player's in-game name.
   *
   * This is the only write this app makes to a player's account, so failures
   * are surfaced verbatim rather than swallowed.
   */
  async updateUsername(newName: string): Promise<void> {
    const html = await this.request(
      'POST',
      'mobile/home/userOption/updateUserName/update/',
      { userName: newName },
    );

    const $ = load(html);
    const error = $('.text_red').first().text().trim();

    if (error) {
      // SEGA answers in Japanese; translate the one players actually hit.
      throw new ChunithmNetError(
        error === '文字数が多すぎます。'
          ? 'That name is too long — 8 characters maximum.'
          : error,
      );
    }
  }

  async logout(): Promise<void> {
    await this.request('GET', 'mobile/home/userOption/logout/');
  }
}
