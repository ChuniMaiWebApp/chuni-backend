import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  calculateMaxOverpowerMilli,
  calculatePlayOverpowerMilli,
} from '../../shared/calculation/overpower';
import { calculateRating } from '../../shared/calculation/rating';
import {
  ClearLamp,
  ComboLamp,
  DIFFICULTY_SHORT,
  Difficulty,
  Rank,
  rankFromScore,
  rankLabel,
} from '../../shared/chunithm-net/chunithm-net.types';
import { AuthService } from '../auth/auth.service';
import { jacketUrl } from '../songs/song-links';
import { parseLevelQuery } from '../songs/songs.service';
import {
  RecordsRepository,
  type ScoreFilter,
  type StoredScoreRow,
} from './records.repository';

export interface StoredScoreView {
  song: {
    id: number;
    title: string;
    jacketUrl: string | null;
    genre: string;
    version: string;
  };
  chart: {
    difficulty: Difficulty;
    difficultyName: string;
    level: string;
    const: number | null;
    maxCombo: number | null;
  };
  score: number;
  rank: Rank;
  rankName: string;
  clearLamp: ClearLamp | null;
  comboLamp: ComboLamp | null;
  chainLamp: number | null;
  judgements: {
    justiceCritical: number;
    justice: number;
    attack: number;
    miss: number;
  } | null;
  maxCombo: number | null;
  achievedAt: string | null;
  rating: number | null;
  overpower: number | null;
  maxOverpower: number | null;
}

export type SortKey =
  | 'rating'
  | 'score'
  | 'overpower'
  | 'overpowerPercent'
  | 'comboLamp'
  | 'clearLamp'
  | 'mistakes';

const DIFFICULTY_FROM_SHORT: Record<string, Difficulty> = Object.fromEntries(
  Object.entries(DIFFICULTY_SHORT).map(([value, short]) => [
    short,
    Number(value),
  ]),
);

@Injectable()
export class RecordsService {
  private readonly logger = new Logger(RecordsService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly repository: RecordsRepository,
  ) {}

  /**
   * Turns a stored row into an API score, recomputing rating and OVER POWER
   * from the chart constant that is current right now rather than from a
   * cached value that a rebalance would have invalidated.
   */
  private toView(row: StoredScoreRow): StoredScoreView {
    const difficulty =
      DIFFICULTY_FROM_SHORT[row.difficulty] ?? Difficulty.MASTER;
    const chartConst =
      row.chart_const === null ? null : Number(row.chart_const);
    const rank = rankFromScore(row.score);

    const hasJudgements =
      row.justice_critical !== null &&
      row.justice !== null &&
      row.attack !== null &&
      row.miss !== null;

    return {
      song: {
        id: row.song_id,
        title: row.title,
        jacketUrl: jacketUrl(row.jacket),
        genre: row.genre,
        version: row.version,
      },
      chart: {
        difficulty,
        difficultyName: row.difficulty,
        level: row.level,
        const: chartConst,
        maxCombo: row.chart_max_combo,
      },
      score: row.score,
      rank,
      rankName: rankLabel(rank),
      clearLamp: row.clear_lamp,
      comboLamp: row.combo_lamp,
      chainLamp: row.chain_lamp,
      judgements: hasJudgements
        ? {
            justiceCritical: row.justice_critical!,
            justice: row.justice!,
            attack: row.attack!,
            miss: row.miss!,
          }
        : null,
      maxCombo: row.max_combo,
      achievedAt: row.achieved_at ? row.achieved_at.toISOString() : null,
      rating:
        chartConst === null ? null : calculateRating(row.score, chartConst),
      // Without a lamp the bonus is unknown, so OP would be understated.
      overpower:
        chartConst === null || row.combo_lamp === null
          ? null
          : calculatePlayOverpowerMilli(row.score, chartConst, row.combo_lamp) /
            1000,
      maxOverpower:
        chartConst === null
          ? null
          : calculateMaxOverpowerMilli(chartConst) / 1000,
    };
  }

  /**
   * Pulls every personal best from CHUNITHM-NET into the local cache.
   *
   * Five requests, one per difficulty, so it is deliberately not something the
   * UI calls on every page view.
   */
  async sync(
    userId: string,
  ): Promise<{ scoreCount: number; skipped: string[] }> {
    await this.repository.startSyncRun(userId);

    try {
      const scores = await this.auth.withChunithmSession(userId, (session) =>
        session.getAllPersonalBests(),
      );

      const { stored, skipped } = await this.repository.upsertScores(
        userId,
        scores,
      );

      await this.repository.finishSyncRun(userId, stored, null);
      this.logger.log(`Synced ${stored} scores for user ${userId}`);

      if (skipped.length > 0) {
        // Almost always songs released after the dataset snapshot.
        this.logger.warn(
          `Skipped ${skipped.length} score(s) on charts missing from the song database: ${skipped.slice(0, 5).join(', ')}`,
        );
      }

      return { scoreCount: stored, skipped };
    } catch (error) {
      await this.repository.finishSyncRun(
        userId,
        null,
        (error as Error).message,
      );

      throw error;
    }
  }

  async getSyncStatus(userId: string) {
    const [run, seed] = await Promise.all([
      this.repository.findSyncRun(userId),
      this.repository.findSeedFreshness(),
    ]);

    // The song dataset is a third-party snapshot; a player whose recent songs
    // are missing deserves to see why rather than wonder where their scores
    // went.
    const dataset = seed
      ? {
          refreshedAt: seed.fetched_at.toISOString(),
          newestRelease: seed.newest_release,
          songCount: seed.song_count,
          ageDays: Math.floor(
            (Date.now() - seed.fetched_at.getTime()) / 86_400_000,
          ),
        }
      : null;

    if (!run) return { hasSynced: false, dataset } as const;

    return {
      hasSynced: run.finished_at !== null && run.error === null,
      startedAt: run.started_at.toISOString(),
      finishedAt: run.finished_at?.toISOString() ?? null,
      scoreCount: run.score_count,
      error: run.error,
      dataset,
    };
  }

  private static parseFilter(input: {
    level?: string;
    difficulty?: string;
    genre?: string;
    version?: string;
  }): ScoreFilter {
    const level = input.level ? parseLevelQuery(input.level) : {};

    return {
      ...level,
      difficulty: input.difficulty?.toUpperCase(),
      genre: input.genre,
      version: input.version,
    };
  }

  /** Filtered and sorted personal bests, read from the local cache. */
  async top(
    userId: string,
    input: {
      level?: string;
      difficulty?: string;
      genre?: string;
      version?: string;
      sort?: SortKey;
      order?: 'asc' | 'desc';
      limit?: number;
    },
  ): Promise<StoredScoreView[]> {
    const rows = await this.repository.findScores(
      userId,
      RecordsService.parseFilter(input),
    );
    const scores = rows.map((row) => this.toView(row));

    const metric = (score: StoredScoreView): number => {
      switch (input.sort ?? 'rating') {
        case 'score':
          return score.score;
        case 'overpower':
          return score.overpower ?? 0;
        case 'overpowerPercent':
          return score.overpower && score.maxOverpower
            ? (score.overpower / score.maxOverpower) * 100
            : 0;
        case 'comboLamp':
          return score.comboLamp ?? -1;
        case 'clearLamp':
          return score.clearLamp ?? -1;
        case 'mistakes':
          // Fewer mistakes is better, so negate to keep "higher is better".
          return score.judgements
            ? -(
                score.judgements.justice +
                score.judgements.attack +
                score.judgements.miss
              )
            : -Infinity;
        default:
          return score.rating ?? 0;
      }
    };

    scores.sort((a, b) => {
      const delta = metric(b) - metric(a);

      // Ties fall back to score so the order is stable and meaningful.
      return (input.order === 'asc' ? -delta : delta) || b.score - a.score;
    });

    return scores.slice(0, input.limit ?? 100);
  }

  /** Every stored score on one song. */
  async scoresForSong(userId: string, songId: number) {
    const rows = await this.repository.findScores(userId, {}, 10_000);
    const forSong = rows.filter((row) => row.song_id === songId);

    if (forSong.length === 0) {
      throw new NotFoundException(
        'No scores stored for that song. Run a sync first.',
      );
    }

    return forSong
      .map((row) => this.toView(row))
      .sort((a, b) => a.chart.difficulty - b.chart.difficulty);
  }

  /**
   * Folder statistics: play coverage, rank and lamp tallies, OVER POWER.
   *
   * Read entirely from the cache, so the numbers are only as fresh as the last
   * sync — which is why the response says when that was.
   */
  async statistics(input: {
    userId: string;
    level?: string;
    difficulty?: string;
    genre?: string;
    version?: string;
  }) {
    const filter = RecordsService.parseFilter(input);

    // Without a level filter the game totals OVER POWER one entry per song,
    // taking its hardest chart. Inside a level folder it counts every chart.
    const perSong = input.level === undefined;

    const [rows, totals, maxOp, syncStatus] = await Promise.all([
      this.repository.findScores(input.userId, filter, 10_000),
      this.repository.countCharts(input.userId, filter),
      this.repository.sumMaxOverpower(input.userId, filter, perSong),
      this.getSyncStatus(input.userId),
    ]);

    const scores = rows.map((row) => this.toView(row));

    const rankCounts: Record<string, number> = {};
    const comboCounts: Record<string, number> = {};
    const clearCounts: Record<string, number> = {};
    // Earned OVER POWER has to be aggregated the same way as the maximum,
    // otherwise the percentage compares two different things.
    const overpowerBySong = new Map<number, number>();
    let scoreTotal = 0;
    let ajc99 = 0;

    for (const score of scores) {
      scoreTotal += score.score;

      const earned = score.overpower ?? 0;
      const current = overpowerBySong.get(score.song.id) ?? 0;

      overpowerBySong.set(
        score.song.id,
        perSong ? Math.max(current, earned) : current + earned,
      );

      // Ranks and lamps are cumulative: an SSS also counts towards SS.
      for (const rank of [
        Rank.S,
        Rank.SP,
        Rank.SS,
        Rank.SSP,
        Rank.SSS,
        Rank.SSSP,
      ]) {
        if (score.rank >= rank) {
          rankCounts[rankLabel(rank)] = (rankCounts[rankLabel(rank)] ?? 0) + 1;
        }
      }

      if (score.comboLamp !== null) {
        for (const lamp of [
          ComboLamp.FULL_COMBO,
          ComboLamp.ALL_JUSTICE,
          ComboLamp.ALL_JUSTICE_CRITICAL,
        ]) {
          if (score.comboLamp >= lamp) {
            comboCounts[ComboLamp[lamp]] =
              (comboCounts[ComboLamp[lamp]] ?? 0) + 1;
          }
        }

        if (
          score.score >= 1_009_900 &&
          score.comboLamp >= ComboLamp.ALL_JUSTICE
        ) {
          ajc99 += 1;
        }
      }

      if (score.clearLamp !== null && score.clearLamp > ClearLamp.FAILED) {
        clearCounts[ClearLamp[score.clearLamp]] =
          (clearCounts[ClearLamp[score.clearLamp]] ?? 0) + 1;
      }
    }

    const totalCharts = totals?.total_charts ?? 0;
    const playedCharts = totals?.played_charts ?? 0;
    const maxOverpower = maxOp?.max_overpower ? Number(maxOp.max_overpower) : 0;
    const overpower = [...overpowerBySong.values()].reduce(
      (total, value) => total + value,
      0,
    );

    return {
      filter: {
        level: input.level ?? null,
        difficulty: input.difficulty ?? null,
        genre: input.genre ?? null,
        version: input.version ?? null,
      },
      sync: syncStatus,
      coverage: {
        played: playedCharts,
        total: totalCharts,
        percentage:
          totalCharts === 0
            ? 0
            : Math.floor((playedCharts / totalCharts) * 10_000) / 100,
      },
      overpower: {
        value: Math.floor(overpower * 100) / 100,
        max: Math.floor(maxOverpower * 100) / 100,
        percentage:
          maxOverpower === 0
            ? 0
            : Math.floor((overpower / maxOverpower) * 10_000) / 100,
      },
      averageScore: {
        played:
          scores.length === 0 ? 0 : Math.round(scoreTotal / scores.length),
        overAllCharts:
          totalCharts === 0 ? 0 : Math.round(scoreTotal / totalCharts),
      },
      counts: {
        '99AJ': ajc99,
        ranks: rankCounts,
        comboLamps: comboCounts,
        clearLamps: clearCounts,
      },
      best: scores.length > 0 ? this.pickExtreme(scores, 'max') : null,
      worst: scores.length > 0 ? this.pickExtreme(scores, 'min') : null,
    };
  }

  private pickExtreme(scores: StoredScoreView[], which: 'max' | 'min') {
    return scores.reduce((chosen, score) =>
      which === 'max'
        ? score.score > chosen.score
          ? score
          : chosen
        : score.score < chosen.score
          ? score
          : chosen,
    );
  }
}
