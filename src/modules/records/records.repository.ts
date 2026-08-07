import { Injectable } from '@nestjs/common';

import type { PersonalBest } from '../../shared/chunithm-net/chunithm-net.types';
import { DIFFICULTY_SHORT } from '../../shared/chunithm-net/chunithm-net.types';
import { DatabaseService } from '../../shared/database/database.service';

export interface StoredScoreRow {
  song_id: number;
  difficulty: string;
  score: number;
  clear_lamp: number | null;
  combo_lamp: number | null;
  chain_lamp: number | null;
  justice_critical: number | null;
  justice: number | null;
  attack: number | null;
  miss: number | null;
  max_combo: number | null;
  achieved_at: Date | null;
  title: string;
  jacket: string | null;
  genre: string;
  version: string;
  level: string;
  chart_const: string | null;
  chart_max_combo: number | null;
}

export interface SyncRunRow {
  started_at: Date;
  finished_at: Date | null;
  score_count: number | null;
  error: string | null;
}

export interface ChartTotalsRow {
  total_charts: number;
  played_charts: number;
}

export interface ScoreFilter {
  level?: string;
  minConst?: number;
  maxConst?: number;
  difficulty?: string;
  genre?: string;
  version?: string;
}

@Injectable()
export class RecordsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Merges freshly fetched scores into the cache.
   *
   * Everything is upserted with `greatest()` so a partial sync can never move
   * a personal best backwards. Judgement columns follow the score: they only
   * change when the score itself improves, otherwise a detail-less list fetch
   * would wipe judgements learned from the playlog.
   */
  async upsertScores(
    userId: string,
    scores: PersonalBest[],
  ): Promise<{ stored: number; skipped: string[] }> {
    if (scores.length === 0) return { stored: 0, skipped: [] };

    // Charts the seed does not know about cannot be stored — the composite
    // foreign key would reject them and abort the batch.
    const known = new Set(
      (
        await this.db.query<{ song_id: number; difficulty: string }>(
          'select song_id, difficulty from app.charts',
        )
      ).map((row) => `${row.song_id}:${row.difficulty}`),
    );

    // Charts the dataset has never heard of cannot be stored — the composite
    // foreign key would reject them. They are reported rather than dropped in
    // silence: the usual cause is a song released after the dataset snapshot,
    // and a player losing scores without being told is worse than a stale
    // number.
    const skipped: string[] = [];
    const playable = scores.filter((score) => {
      const key = `${score.song.id}:${DIFFICULTY_SHORT[score.chart.difficulty]}`;

      if (score.song.id !== null && known.has(key)) return true;

      skipped.push(
        `${score.song.title} [${DIFFICULTY_SHORT[score.chart.difficulty]}]`,
      );

      return false;
    });

    const rows = playable.map((score) => [
      userId,
      score.song.id,
      DIFFICULTY_SHORT[score.chart.difficulty],
      score.score,
      score.clearLamp,
      score.comboLamp,
      score.chainLamp,
      score.judgements?.justiceCritical ?? null,
      score.judgements?.justice ?? null,
      score.judgements?.attack ?? null,
      score.judgements?.miss ?? null,
      score.maxCombo,
      score.achievedAt,
    ]);

    if (rows.length === 0) return { stored: 0, skipped };

    const COLUMNS = 13;
    const BATCH = 400;

    for (let index = 0; index < rows.length; index += BATCH) {
      const batch = rows.slice(index, index + BATCH);
      const values = batch
        .map(
          (_, row) =>
            `(${Array.from(
              { length: COLUMNS },
              (__, column) => `$${row * COLUMNS + column + 1}`,
            ).join(', ')})`,
        )
        .join(', ');

      await this.db.query(
        `insert into app.personal_bests (
           user_id, song_id, difficulty, score,
           clear_lamp, combo_lamp, chain_lamp,
           justice_critical, justice, attack, miss, max_combo, achieved_at
         ) values ${values}
         on conflict (user_id, song_id, difficulty) do update set
           score      = greatest(app.personal_bests.score, excluded.score),
           clear_lamp = greatest(app.personal_bests.clear_lamp, excluded.clear_lamp),
           combo_lamp = greatest(app.personal_bests.combo_lamp, excluded.combo_lamp),
           chain_lamp = greatest(app.personal_bests.chain_lamp, excluded.chain_lamp),
           -- Judgements describe one specific run, so they only travel with a
           -- score that actually beats what is stored.
           justice_critical = case when excluded.score > app.personal_bests.score
                                   then excluded.justice_critical
                                   else coalesce(app.personal_bests.justice_critical,
                                                 excluded.justice_critical) end,
           justice    = case when excluded.score > app.personal_bests.score
                             then excluded.justice
                             else coalesce(app.personal_bests.justice, excluded.justice) end,
           attack     = case when excluded.score > app.personal_bests.score
                             then excluded.attack
                             else coalesce(app.personal_bests.attack, excluded.attack) end,
           miss       = case when excluded.score > app.personal_bests.score
                             then excluded.miss
                             else coalesce(app.personal_bests.miss, excluded.miss) end,
           max_combo  = greatest(app.personal_bests.max_combo, excluded.max_combo),
           achieved_at = coalesce(excluded.achieved_at, app.personal_bests.achieved_at),
           synced_at  = now()`,
        batch.flat(),
      );
    }

    return { stored: rows.length, skipped };
  }

  /** Stored scores with their chart data, for statistics and filtered views. */
  findScores(userId: string, filter: ScoreFilter, limit = 2000) {
    return this.db.query<StoredScoreRow>(
      `select p.song_id, p.difficulty, p.score,
              p.clear_lamp, p.combo_lamp, p.chain_lamp,
              p.justice_critical, p.justice, p.attack, p.miss, p.max_combo,
              p.achieved_at,
              s.title, s.jacket, s.genre, s.version,
              c.level, c.const::text as chart_const,
              c.max_combo as chart_max_combo
         from app.personal_bests p
         join app.charts c on c.song_id = p.song_id
                          and c.difficulty = p.difficulty
         join app.songs s on s.id = p.song_id
        where p.user_id = $1
          and ($2::text is null or c.level = $2)
          and ($3::numeric is null or c.const >= $3)
          and ($4::numeric is null or c.const <= $4)
          and ($5::text is null or p.difficulty = $5)
          and ($6::text is null or s.genre = $6)
          and ($7::text is null or s.version = $7)
        limit $8`,
      [
        userId,
        filter.level ?? null,
        filter.minConst ?? null,
        filter.maxConst ?? null,
        filter.difficulty ?? null,
        filter.genre ?? null,
        filter.version ?? null,
        limit,
      ],
    );
  }

  /**
   * How many charts match the filter in total, and how many the player has a
   * score on. Counting in SQL avoids pulling every chart into the API.
   *
   * A chart counts when it is not removed AND either the dataset says it is
   * available or the player already has a score on it. That second clause
   * matters: the dataset's `available` flag lags months behind for new
   * releases, and without it every score on a recent song silently vanished
   * from the totals. A score is proof the chart is playable.
   */
  countCharts(userId: string, filter: ScoreFilter) {
    return this.db.queryOne<ChartTotalsRow>(
      `select count(*)::int as total_charts,
              count(p.user_id)::int as played_charts
         from app.charts c
         join app.songs s on s.id = c.song_id
         left join app.personal_bests p
                on p.song_id = c.song_id
               and p.difficulty = c.difficulty
               and p.user_id = $1
        where s.removed = false
          and (
            (c.available = true and s.available = true)
            or p.user_id is not null
          )
          and c.difficulty <> 'WE'
          and ($2::text is null or c.level = $2)
          and ($3::numeric is null or c.const >= $3)
          and ($4::numeric is null or c.const <= $4)
          and ($5::text is null or c.difficulty = $5)
          and ($6::text is null or s.genre = $6)
          and ($7::text is null or s.version = $7)`,
      [
        userId,
        filter.level ?? null,
        filter.minConst ?? null,
        filter.maxConst ?? null,
        filter.difficulty ?? null,
        filter.genre ?? null,
        filter.version ?? null,
      ],
    );
  }

  /**
   * Maximum attainable OVER POWER across the charts matching a filter.
   *
   * `perSong` mirrors how the game totals OVER POWER on a profile: one entry
   * per song, its hardest chart. Summing every chart instead roughly triples
   * the denominator and makes the percentage incomparable with the one shown
   * in-game. Inside a level folder the game does count each chart, which is
   * what `perSong: false` is for.
   */
  sumMaxOverpower(userId: string, filter: ScoreFilter, perSong: boolean) {
    // Same playability rule as countCharts, so the earned and maximum figures
    // are drawn from the identical chart set.
    const conditions = `
        s.removed = false
          and (
            (c.available = true and s.available = true)
            or exists (select 1 from app.personal_bests p
                        where p.user_id = $7
                          and p.song_id = c.song_id
                          and p.difficulty = c.difficulty)
          )
          and c.difficulty <> 'WE'
          and c.const is not null
          and ($1::text is null or c.level = $1)
          and ($2::numeric is null or c.const >= $2)
          and ($3::numeric is null or c.const <= $3)
          and ($4::text is null or c.difficulty = $4)
          and ($5::text is null or s.genre = $5)
          and ($6::text is null or s.version = $6)`;

    const sql = perSong
      ? `select sum(song_max)::text as max_overpower
           from (select max(c.const * 5 + 15) as song_max
                   from app.charts c
                   join app.songs s on s.id = c.song_id
                  where ${conditions}
                  group by c.song_id) per_song`
      : `select sum(c.const * 5 + 15)::text as max_overpower
           from app.charts c
           join app.songs s on s.id = c.song_id
          where ${conditions}`;

    return this.db.queryOne<{ max_overpower: string | null }>(sql, [
      filter.level ?? null,
      filter.minConst ?? null,
      filter.maxConst ?? null,
      filter.difficulty ?? null,
      filter.genre ?? null,
      filter.version ?? null,
      userId,
    ]);
  }

  async startSyncRun(userId: string): Promise<void> {
    await this.db.query(
      `insert into app.sync_runs (user_id, started_at)
       values ($1, now())
       on conflict (user_id) do update
          set started_at = now(), finished_at = null, error = null`,
      [userId],
    );
  }

  async finishSyncRun(
    userId: string,
    scoreCount: number | null,
    error: string | null,
  ): Promise<void> {
    await this.db.query(
      `update app.sync_runs
          set finished_at = now(), score_count = $2, error = $3
        where user_id = $1`,
      [userId, scoreCount, error],
    );
  }

  /**
   * How old the song dataset is.
   *
   * Surfaced so the UI can say "this may be missing recent songs" instead of
   * quietly behaving as if the missing ones do not exist.
   */
  findSeedFreshness() {
    return this.db.queryOne<{
      fetched_at: Date;
      newest_release: string | null;
      song_count: number;
    }>(
      `select fetched_at, newest_release::text as newest_release, song_count
         from app.seed_refreshes order by fetched_at desc limit 1`,
    );
  }

  findSyncRun(userId: string) {
    return this.db.queryOne<SyncRunRow>(
      'select started_at, finished_at, score_count, error from app.sync_runs where user_id = $1',
      [userId],
    );
  }
}
