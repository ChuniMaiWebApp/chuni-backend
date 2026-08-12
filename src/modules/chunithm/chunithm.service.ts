import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ratingFloor,
  ratingIfAllSlotsReach,
  whatIf,
  type WhatIfResult,
} from '../../shared/calculation/improvement';
import { calculateJudgementLoss } from '../../shared/calculation/judgements';
import { calculateScoreForRating } from '../../shared/calculation/rating';
import { ChunithmNetSiteError } from '../../shared/chunithm-net/chunithm-net.errors';
import {
  DIFFICULTY_SHORT,
  type Difficulty,
  type PersonalBest,
  type Profile,
  type RatingBreakdown,
  type RecentScore,
} from '../../shared/chunithm-net/chunithm-net.types';
import { AuthService } from '../auth/auth.service';
import { SongsService } from '../songs/songs.service';
import { PlayDetailsRepository } from './play-details.repository';
import { ScoreEnricherService } from './score-enricher.service';

/** pg returns numeric as a string so float drift never creeps into storage. */
const number = (value: string | null) =>
  value === null ? null : Number(value);

/** The game counts 30 old-version scores and 20 current-version ones. */
const BEST_SLOTS = 30;
const NEW_SLOTS = 20;

@Injectable()
export class ChunithmService {
  constructor(
    private readonly auth: AuthService,
    private readonly enricher: ScoreEnricherService,
    private readonly songs: SongsService,
    private readonly playDetails: PlayDetailsRepository,
  ) {}

  /** Includes the nameplate banner, which costs a second CHUNITHM-NET page. */
  getProfile(userId: string): Promise<Profile> {
    return this.auth.withChunithmSession(userId, (session) =>
      session.getFullProfile(),
    );
  }

  getLoginBonus(userId: string) {
    return this.auth.withChunithmSession(userId, (session) =>
      session.getLoginBonus(),
    );
  }

  /**
   * Progress through the Linked GATEs.
   *
   * Each gate comes back as the badge CHUNITHM-NET serves for it, and nothing
   * else. The artwork already shows the state; deriving a separate status from
   * the filename needed a hand-kept lookup that only ever managed to disagree
   * with it.
   */
  getLinkedVerse(userId: string) {
    return this.auth.withChunithmSession(userId, (session) =>
      session.getLinkedVerseProgress(),
    );
  }

  /**
   * Renames the player in-game.
   *
   * The only write this app makes to a CHUNITHM account, so it validates the
   * length client-side too rather than relying on SEGA's Japanese error.
   */
  async rename(userId: string, newName: string): Promise<{ username: string }> {
    const trimmed = newName.trim();

    if (trimmed.length === 0 || trimmed.length > 8) {
      throw new BadRequestException(
        'A player name is between 1 and 8 characters.',
      );
    }

    return this.auth.withChunithmSession(userId, async (session) => {
      await session.updateUsername(trimmed);

      // Read the name back rather than trusting the input — SEGA normalises
      // some characters to their full-width forms.
      const profile = await session.getHomePage();

      return { username: profile.username };
    });
  }

  /** A chart's leaderboard, fetched with the player's own session. */
  /**
   * A chart's top 100 on CHUNITHM International.
   *
   * Not every chart has a ranking page: asking for one the site does not
   * publish — a removed song, or a difficulty the song does not have — sends
   * it to its generic error page, which would otherwise surface as a 500.
   */
  async getChartLeaderboard(
    userId: string,
    songId: number,
    difficulty: Difficulty,
  ) {
    try {
      return await this.auth.withChunithmSession(userId, (session) =>
        session.getChartLeaderboard(songId, difficulty),
      );
    } catch (error) {
      if (
        error instanceof ChunithmNetSiteError &&
        !error.isRetryable &&
        error.code !== ChunithmNetSiteError.RATE_LIMIT_EXCEEDED
      ) {
        throw new NotFoundException(
          'CHUNITHM-NET does not publish a leaderboard for this chart. ' +
            'Songs removed from the game are the usual reason.',
        );
      }

      throw error;
    }
  }

  /**
   * What a hypothetical play would do to the player's rating.
   *
   * Needs the current breakdown, so it costs the same CHUNITHM-NET round trip
   * as `/records/best50`.
   */
  async whatIf(
    userId: string,
    playRating: number,
    replacing?: number,
  ): Promise<
    WhatIfResult & { floor: { best: number | null; new: number | null } }
  > {
    const breakdown = await this.getRatingBreakdown(userId);

    const frames = {
      best: {
        ratings: breakdown.best.scores.map((score) => score.rating ?? 0),
        slots: breakdown.best.slots,
      },
      new: {
        ratings: breakdown.new.scores.map((score) => score.rating ?? 0),
        slots: breakdown.new.slots,
      },
    };

    // A play lands in whichever frame gives the bigger gain; the caller does
    // not know which version the chart belongs to.
    const candidates = [
      whatIf(frames.best, breakdown.rating, playRating, replacing),
      whatIf(frames.new, breakdown.rating, playRating, replacing),
    ];

    const better =
      candidates[0].delta >= candidates[1].delta
        ? candidates[0]
        : candidates[1];

    return {
      ...better,
      floor: {
        best: ratingFloor(frames.best),
        new: ratingFloor(frames.new),
      },
    };
  }

  getRatingRanking(userId: string, scope: 'global' | 'friend') {
    return this.auth.withChunithmSession(userId, (session) =>
      session.getRatingRanking(scope),
    );
  }

  getScoreRanking(userId: string) {
    return this.auth.withChunithmSession(userId, (session) =>
      session.getScoreRanking(),
    );
  }

  getCurrencyRanking(userId: string) {
    return this.auth.withChunithmSession(userId, (session) =>
      session.getCurrencyRanking(),
    );
  }

  /**
   * What it would take to reach a target rating.
   *
   * Reports the play rating every counted slot would have to hit. That is a
   * ceiling, not a plan — real players lift a few charts at a time — but it
   * answers "is this even close" honestly.
   */
  async reach(userId: string, target: number) {
    const breakdown = await this.getRatingBreakdown(userId);

    const frames = [
      {
        ratings: breakdown.best.scores.map((score) => score.rating ?? 0),
        slots: breakdown.best.slots,
      },
      {
        ratings: breakdown.new.scores.map((score) => score.rating ?? 0),
        slots: breakdown.new.slots,
      },
    ];

    if (target <= breakdown.rating) {
      return {
        currentRating: breakdown.rating,
        target,
        alreadyReached: true,
        requiredPlayRating: null,
        floors: { best: ratingFloor(frames[0]), new: ratingFloor(frames[1]) },
      };
    }

    // Binary search the uniform play rating that lands on the target. The
    // relationship is monotonic, so twenty iterations is far more precision
    // than a rating displayed to two decimals needs.
    let low = breakdown.rating;
    let high = 20;

    for (let i = 0; i < 20; i += 1) {
      const middle = (low + high) / 2;

      if (ratingIfAllSlotsReach(frames, middle) >= target) high = middle;
      else low = middle;
    }

    return {
      currentRating: breakdown.rating,
      target,
      alreadyReached: false,
      requiredPlayRating: Math.ceil(high * 100) / 100,
      floors: { best: ratingFloor(frames[0]), new: ratingFloor(frames[1]) },
    };
  }

  /**
   * Charts worth attempting next, with the score each one needs.
   *
   * Picked at random around the player's current rating floor: anything below
   * it cannot improve the rating no matter how well it is played, and anything
   * far above is not realistically clearable at that level.
   */
  async recommend(userId: string, count: number) {
    const breakdown = await this.getRatingBreakdown(userId);
    const floor =
      ratingFloor({
        ratings: breakdown.best.scores.map((score) => score.rating ?? 0),
        slots: breakdown.best.slots,
      }) ?? breakdown.rating;

    // A play must beat the floor to count, and SS+ (1,005,000) is a realistic
    // target, which is worth constant + 1.5. So charts from floor-1.5 upwards
    // are the ones that can actually pay off.
    const target = Math.floor((floor + 0.01) * 100) / 100;
    const charts = await this.songs.randomCharts(
      `${Math.max(target - 1.5, 1).toFixed(1)}-${Math.min(target + 0.5, 16).toFixed(1)}`,
      count * 3,
    );

    const recommendations = charts
      .map((chart) => {
        if (chart.const === null) return null;

        const required = calculateScoreForRating(target, chart.const);

        if (required === null || required > 1_010_000) return null;

        return {
          song: chart.song,
          difficulty: chart.difficulty,
          difficultyName: chart.difficultyName,
          level: chart.level,
          const: chart.const,
          sdvxinUrl: chart.sdvxinUrl,
          requiredScore: required,
          targetPlayRating: target,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .slice(0, count);

    return {
      currentRating: breakdown.rating,
      ratingFloor: floor,
      recommendations,
    };
  }

  /**
   * One recent play, with judgements and note accuracy.
   *
   * Takes a list position rather than CHUNITHM-NET's own `idx` because the
   * caller can only learn an `idx` by fetching the playlog first — and both
   * are positional anyway, so neither survives the player finishing another
   * track. The response carries the song it actually landed on, so a saved
   * link can tell it has drifted rather than silently showing another play.
   */
  async getRecentPlay(userId: string, index: number): Promise<RecentScore> {
    const play = await this.auth.withChunithmSession(
      userId,
      async (session) => {
        const recents = await session.getRecentScores();
        const target = recents[index];

        if (!target || target.playlogIndex === null) {
          throw new NotFoundException(`No recent play at position ${index}.`);
        }

        const detailed = await session.getRecentScoreDetail(
          target.playlogIndex,
        );

        return { ...target, ...detailed };
      },
    );

    const [enriched] = await this.enricher.enrich([play]);

    // Every detail fetched is one CHUNITHM-NET will stop serving in fifty
    // tracks' time, so it is written down on the way past.
    await this.playDetails.save(userId, enriched);

    return enriched;
  }

  /**
   * Captures the judgement breakdown of every recent play worth keeping.
   *
   * CHUNITHM-NET serves judgements for the last 50 tracks and nothing else, so
   * a personal best loses its breakdown the moment fifty more credits push it
   * out. Walking the window and storing what is there makes that permanent.
   *
   * Plays already captured at the same score are skipped, so running this
   * after every session costs only the new tracks.
   */
  async captureRecentDetails(userId: string): Promise<{
    scanned: number;
    fetched: number;
    stored: number;
    alreadyKnown: number;
  }> {
    const recents = await this.enricher.enrich(
      await this.auth.withChunithmSession(userId, (session) =>
        session.getRecentScores(),
      ),
    );

    const identifiable = recents.filter(
      (play) => play.song.id !== null && play.playlogIndex !== null,
    );

    const known = await this.playDetails.findCapturedScores(
      userId,
      identifiable.map((play) => ({
        songId: play.song.id!,
        difficulty: DIFFICULTY_SHORT[play.chart.difficulty],
        score: play.score,
      })),
    );

    const missing = identifiable.filter(
      (play) =>
        !known.has(
          `${play.song.id}:${DIFFICULTY_SHORT[play.chart.difficulty]}:${play.score}`,
        ),
    );

    // One session for the lot: the rate limiter paces them, and re-authenticating
    // per play would be both slower and more traffic to SEGA.
    const details = await this.auth.withChunithmSession(
      userId,
      async (session) => {
        const fetched: RecentScore[] = [];

        for (const play of missing) {
          fetched.push({
            ...play,
            ...(await session.getRecentScoreDetail(play.playlogIndex!)),
          });
        }

        return fetched;
      },
    );

    const stored = await this.playDetails.saveMany(
      userId,
      await this.enricher.enrich(details),
    );

    return {
      scanned: recents.length,
      fetched: details.length,
      stored,
      alreadyKnown: identifiable.length - missing.length,
    };
  }

  /**
   * Everything known about one player's record on one chart.
   *
   * CHUNITHM-NET publishes judgements only on the playlog, never on the music
   * record pages — which is why a bot answering one command at a time cannot
   * show them for a personal best. Two sources are tried: the live playlog,
   * and anything this app captured while earlier plays were still in it.
   */
  async getChartRecord(userId: string, songId: number, difficulty: Difficulty) {
    const song = await this.songs.findById(songId);
    const chart = song.charts?.find((entry) => entry.difficulty === difficulty);

    if (!chart) {
      throw new NotFoundException(
        `${song.title} has no ${DIFFICULTY_SHORT[difficulty]} chart.`,
      );
    }

    const play = await this.auth.withChunithmSession(
      userId,
      async (session) => {
        const recents = await session.getRecentScores();

        // Best score first: a chart played several times in the window should
        // report the run that actually stands as the record.
        const matches = recents
          .filter(
            (entry) =>
              entry.chart.difficulty === difficulty &&
              (entry.song.id === songId || entry.song.title === song.title),
          )
          .sort((a, b) => b.score - a.score);

        const best = matches[0];

        if (!best || best.playlogIndex === null) return null;

        return {
          ...best,
          ...(await session.getRecentScoreDetail(best.playlogIndex)),
        };
      },
    );

    const enriched = play ? (await this.enricher.enrich([play]))[0] : null;

    if (enriched) await this.playDetails.save(userId, enriched);

    // Falls back to a run captured before the playlog rolled past it, which is
    // the only way a months-old personal best can still have a breakdown.
    const captured = enriched
      ? null
      : await this.playDetails.findBestForChart(userId, songId, difficulty);

    return {
      song: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        genre: song.genre,
        version: song.version,
        jacketUrl: song.jacketUrl,
        availability: song.availability,
      },
      chart,
      /** The best play found in the last 50 tracks, or null if none is. */
      play: enriched,
      /** A breakdown captured earlier, for a run the playlog has forgotten. */
      captured: captured
        ? {
            score: captured.score,
            maxCombo: captured.max_combo,
            achievedAt: captured.achieved_at?.toISOString() ?? null,
            capturedAt: captured.captured_at.toISOString(),
            judgements: {
              justiceCritical: captured.justice_critical,
              justice: captured.justice,
              attack: captured.attack,
              miss: captured.miss,
            },
            notePercentage: {
              tap: number(captured.pct_tap),
              hold: number(captured.pct_hold),
              slide: number(captured.pct_slide),
              air: number(captured.pct_air),
              flick: number(captured.pct_flick),
            },
            judgementLoss: calculateJudgementLoss(
              {
                justiceCritical: captured.justice_critical,
                justice: captured.justice,
                attack: captured.attack,
                miss: captured.miss,
              },
              chart.maxCombo,
            ),
          }
        : null,
    };
  }

  /**
   * The 50 most recent plays, without judgements.
   *
   * Judgements are a second CHUNITHM-NET request each, so they belong to the
   * per-play endpoint rather than being fetched for a list nobody has asked
   * to drill into.
   */
  async getRecentScores(userId: string): Promise<RecentScore[]> {
    const scores = await this.auth.withChunithmSession(userId, (session) =>
      session.getRecentScores(),
    );

    return this.enricher.enrich(scores);
  }

  /**
   * Rating breakdown as the game computes it: best 30 old + new 20.
   *
   * The rating value itself is read from the profile rather than recomputed,
   * so it always agrees with what the cabinet shows even when our chart
   * constants lag behind a rebalance.
   *
   * The rating detail pages list only title, difficulty and score — no badges
   * at all. Lamps therefore have to be fetched separately from the per
   * difficulty record lists, which is not just cosmetic: FULL COMBO and ALL
   * JUSTICE add up to 1.25 to OVER POWER, so without them every OP here would
   * be silently understated.
   */
  async getRatingBreakdown(userId: string): Promise<RatingBreakdown> {
    const { profile, best, recent } = await this.auth.withChunithmSession(
      userId,
      async (session) => {
        const [profileData, bestData, recentData] = await Promise.all([
          session.getProfile(),
          session.getBest30(),
          session.getNew20(),
        ]);

        const rated = [...bestData, ...recentData];
        const difficulties = [
          ...new Set(rated.map((score) => score.chart.difficulty)),
        ];

        // One request per difficulty actually present, usually two or three.
        const lists = await Promise.all(
          difficulties.map((difficulty) =>
            session.getPersonalBestsByDifficulty(difficulty),
          ),
        );

        const lamps = new Map<string, PersonalBest>();

        for (const entry of lists.flat()) {
          if (entry.song.id === null) continue;

          lamps.set(`${entry.song.id}:${entry.chart.difficulty}`, entry);
        }

        for (const score of rated) {
          const match = lamps.get(`${score.song.id}:${score.chart.difficulty}`);

          // Only trust the badges when both pages agree on the score; a play
          // finished between the two requests would otherwise mismatch.
          if (!match || match.score !== score.score) continue;

          score.clearLamp = match.clearLamp;
          score.comboLamp = match.comboLamp;
          score.chainLamp = match.chainLamp;
        }

        return { profile: profileData, best: bestData, recent: recentData };
      },
    );

    const [bestScores, newScores] = await Promise.all([
      this.enricher.enrich(best),
      this.enricher.enrich(recent),
    ]);

    const byRating = (a: PersonalBest, b: PersonalBest) =>
      (b.rating ?? 0) - (a.rating ?? 0) || b.score - a.score;

    return {
      rating: profile.rating,
      best: { slots: BEST_SLOTS, scores: bestScores.sort(byRating) },
      new: { slots: NEW_SLOTS, scores: newScores.sort(byRating) },
    };
  }
}
