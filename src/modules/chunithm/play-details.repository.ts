import { Injectable } from '@nestjs/common';

import {
  DIFFICULTY_SHORT,
  type Difficulty,
  type RecentScore,
} from '../../shared/chunithm-net/chunithm-net.types';
import { DatabaseService } from '../../shared/database/database.service';

/**
 * Judgement breakdowns kept past the end of the playlog window.
 *
 * See migrations/0010_play_details.sql for why this exists at all. In short:
 * CHUNITHM-NET serves judgements only for the last 50 tracks, so anything not
 * written down while it is in the window is gone for good.
 */

export interface PlayDetailRow {
  song_id: number;
  difficulty: string;
  score: number;
  justice_critical: number;
  justice: number;
  attack: number;
  miss: number;
  max_combo: number | null;
  pct_tap: string | null;
  pct_hold: string | null;
  pct_slide: string | null;
  pct_air: string | null;
  pct_flick: string | null;
  achieved_at: Date | null;
  captured_at: Date;
}

@Injectable()
export class PlayDetailsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Records one play's breakdown.
   *
   * Silently does nothing for a play we cannot key — a chart missing from the
   * song database has no id, and a play without judgements has nothing worth
   * storing.
   */
  async save(userId: string, play: RecentScore): Promise<boolean> {
    if (play.song.id === null || !play.judgements) return false;

    const difficulty = DIFFICULTY_SHORT[play.chart.difficulty];

    if (!difficulty) return false;

    const percentage = play.notePercentage;

    await this.db.query(
      `insert into app.play_details (
         user_id, song_id, difficulty, score,
         justice_critical, justice, attack, miss, max_combo,
         pct_tap, pct_hold, pct_slide, pct_air, pct_flick,
         achieved_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       on conflict (user_id, song_id, difficulty, score) do update set
         justice_critical = excluded.justice_critical,
         justice          = excluded.justice,
         attack           = excluded.attack,
         miss             = excluded.miss,
         max_combo        = excluded.max_combo,
         pct_tap          = excluded.pct_tap,
         pct_hold         = excluded.pct_hold,
         pct_slide        = excluded.pct_slide,
         pct_air          = excluded.pct_air,
         pct_flick        = excluded.pct_flick,
         achieved_at      = coalesce(excluded.achieved_at, app.play_details.achieved_at)`,
      [
        userId,
        play.song.id,
        difficulty,
        play.score,
        play.judgements.justiceCritical,
        play.judgements.justice,
        play.judgements.attack,
        play.judgements.miss,
        play.maxCombo,
        percentage?.tap ?? null,
        percentage?.hold ?? null,
        percentage?.slide ?? null,
        percentage?.air ?? null,
        percentage?.flick ?? null,
        play.achievedAt,
      ],
    );

    return true;
  }

  /** Saves a batch, reporting how many were actually storable. */
  async saveMany(userId: string, plays: RecentScore[]): Promise<number> {
    let stored = 0;

    for (const play of plays) {
      if (await this.save(userId, play)) stored += 1;
    }

    return stored;
  }

  /** The highest-scoring captured run on one chart. */
  findBestForChart(userId: string, songId: number, difficulty: Difficulty) {
    return this.db.queryOne<PlayDetailRow>(
      `select * from app.play_details
        where user_id = $1 and song_id = $2 and difficulty = $3
        order by score desc limit 1`,
      [userId, songId, DIFFICULTY_SHORT[difficulty]],
    );
  }

  /** Which of these charts already have a capture at this exact score. */
  async findCapturedScores(
    userId: string,
    charts: Array<{ songId: number; difficulty: string; score: number }>,
  ): Promise<Set<string>> {
    if (charts.length === 0) return new Set();

    const rows = await this.db.query<{
      song_id: number;
      difficulty: string;
      score: number;
    }>(
      `select song_id, difficulty, score from app.play_details
        where user_id = $1
          and (song_id, difficulty, score) in (
            select * from unnest($2::int[], $3::text[], $4::int[])
          )`,
      [
        userId,
        charts.map((chart) => chart.songId),
        charts.map((chart) => chart.difficulty),
        charts.map((chart) => chart.score),
      ],
    );

    return new Set(
      rows.map((row) => `${row.song_id}:${row.difficulty}:${row.score}`),
    );
  }

  async countForUser(userId: string): Promise<number> {
    const row = await this.db.queryOne<{ count: number }>(
      'select count(*)::int as count from app.play_details where user_id = $1',
      [userId],
    );

    return row?.count ?? 0;
  }
}
