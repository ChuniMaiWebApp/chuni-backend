import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../shared/database/database.service';

export interface SongRow {
  id: number;
  title: string;
  artist: string;
  genre: string;
  version: string;
  /**
   * Read as text, not as a Date.
   *
   * A DATE has no time zone, but pg turns it into a Date at local midnight;
   * converting that through `toISOString()` shifts it back a day for anyone
   * east of UTC. Phantom Crisis released 2026-03-19 and was being shown as
   * 2026-03-18 in Vietnam.
   */
  release_date: string | null;
  bpm: string | null;
  min_bpm: string | null;
  max_bpm: string | null;
  jacket: string | null;
  duration_ms: number | null;
  available: boolean;
  removed: boolean;
  /** Null when the regional dataset has no entry for this song. */
  available_intl: boolean | null;
  available_jp: boolean | null;
}

export interface ChartRow {
  song_id: number;
  difficulty: string;
  level: string;
  const: string | null;
  max_combo: number | null;
  tap: number | null;
  hold: number | null;
  slide: number | null;
  air: number | null;
  flick: number | null;
  charter: string | null;
  version: string | null;
  available: boolean;
  available_intl: boolean | null;
  available_jp: boolean | null;
  sdvxin_id: string | null;
  sdvxin_end_index: string | null;
}

export interface SearchRow extends SongRow {
  score: number;
  matched_alias: string | null;
}

export interface CourseRow {
  id: number;
  class: string;
  name: string;
  version: string;
  life: number | null;
  recovery_life: number | null;
  clear_life: number | null;
  damage_miss: number | null;
  damage_attack: number | null;
  damage_justice: number | null;
  damage_jcrit: number | null;
}

export interface CourseTrackRow {
  course_id: number;
  position: number;
  song_id: number | null;
  difficulty: string | null;
  level: string | null;
  title: string | null;
  jacket: string | null;
  chart_const: string | null;
}

@Injectable()
export class SongsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Fuzzy search over titles, artists and aliases.
   *
   * Trigram similarity rather than full-text search: titles are a mix of
   * Japanese, English and symbols, and players type approximate romanisations
   * that no dictionary-based stemmer would resolve.
   */
  search(query: string, limit: number, availableOnly: boolean) {
    return this.db.query<SearchRow>(
      `with matches as (
         select s.*, s.release_date::text as release_date,
                greatest(
                  similarity(lower(s.title), $1),
                  similarity(lower(s.artist), $1) * 0.8,
                  coalesce(max(similarity(lower(a.alias), $1)), 0)
                ) as score,
                (array_agg(a.alias order by similarity(lower(a.alias), $1) desc)
                   filter (where lower(a.alias) % $1))[1] as matched_alias
           from app.songs s
           left join app.song_aliases a on a.song_id = s.id
          where (lower(s.title) % $1
                 or lower(s.artist) % $1
                 or lower(a.alias) % $1
                 -- Substring match rescues very short queries, where trigram
                 -- similarity against a long title is always below threshold.
                 or lower(s.title) like '%' || $1 || '%')
            -- available_intl is the regional dataset's answer, not the seeded
            -- flag, which was wrong in both directions. "is not false" rather
            -- than "= true": a song we have no regional entry for is unknown,
            -- and hiding the unknown is the bug this replaced.
            and ($3 = false
                 or (s.removed = false and s.available_intl is not false))
          group by s.id
       )
       select * from matches order by score desc, title asc limit $2`,
      [query.toLowerCase(), limit, availableOnly],
    );
  }

  findSongById(id: number) {
    return this.db.queryOne<SongRow>(
      'select *, release_date::text as release_date from app.songs where id = $1',
      [id],
    );
  }

  findChartsBySongId(id: number) {
    return this.db.query<ChartRow>(
      `select * from app.charts
        where song_id = $1
        order by case difficulty
                   when 'BAS' then 0 when 'ADV' then 1 when 'EXP' then 2
                   when 'MAS' then 3 when 'ULT' then 4 else 5 end`,
      [id],
    );
  }

  /**
   * When the regional dataset was last pulled, and what the upstream's own
   * update time was.
   *
   * Availability is stated as of a date, not asserted flatly — "not on
   * International" from a month-old file is a different claim from the same
   * words backed by this morning's.
   */
  findRegionFreshness() {
    return this.db.queryOne<{
      source_url: string;
      published_at: Date | null;
      fetched_at: Date;
    }>(
      `select source_url, published_at, fetched_at
         from app.region_refreshes order by fetched_at desc limit 1`,
    );
  }

  findAliasesBySongId(id: number) {
    return this.db.query<{ alias: string }>(
      'select alias from app.song_aliases where song_id = $1 order by alias',
      [id],
    );
  }

  /**
   * Charts within a level band.
   *
   * `level` matches the displayed level ("14+"); `minConst`/`maxConst` match
   * the chart constant, which is what players actually compare.
   */
  findCharts(filter: {
    level?: string;
    minConst?: number;
    maxConst?: number;
    availableOnly: boolean;
    limit: number;
  }) {
    return this.db.query<ChartRow & { title: string; jacket: string | null }>(
      `select c.*, s.title, s.jacket
         from app.charts c
         join app.songs s on s.id = c.song_id
        where ($1::text is null or c.level = $1)
          and ($2::numeric is null or c.const >= $2)
          and ($3::numeric is null or c.const <= $3)
          -- Per chart: five songs ship on International without their ULTIMA.
          and ($4 = false
               or (s.removed = false and c.available_intl is not false))
        order by c.const desc nulls last, s.title asc
        limit $5`,
      [
        filter.level ?? null,
        filter.minConst ?? null,
        filter.maxConst ?? null,
        filter.availableOnly,
        filter.limit,
      ],
    );
  }

  /**
   * Random charts in a level band.
   *
   * `order by random()` sorts the whole matching set, which is fine here: the
   * candidate pool for one level is a few hundred rows at most.
   */
  randomCharts(filter: {
    level?: string;
    minConst?: number;
    maxConst?: number;
    count: number;
  }) {
    return this.db.query<ChartRow & { title: string; jacket: string | null }>(
      `select c.*, s.title, s.jacket
         from app.charts c
         join app.songs s on s.id = c.song_id
        where ($1::text is null or c.level = $1)
          and ($2::numeric is null or c.const >= $2)
          and ($3::numeric is null or c.const <= $3)
          and s.removed = false
          -- Never hand a player a chart they cannot select on their cabinet.
          and c.available_intl is not false
          and c.difficulty <> 'WE'
        order by random()
        limit $4`,
      [
        filter.level ?? null,
        filter.minConst ?? null,
        filter.maxConst ?? null,
        filter.count,
      ],
    );
  }

  listCourses() {
    return this.db.query<CourseRow>(
      `select * from app.courses
        order by case class
                   when 'i' then 1 when 'ii' then 2 when 'iii' then 3
                   when 'iv' then 4 when 'v' then 5 when 'infinite' then 6
                   else 7 end,
                 name`,
    );
  }

  /** Every track of every course, joined to song data, in one query. */
  listCourseTracks() {
    return this.db.query<CourseTrackRow>(
      `select t.course_id, t.position, t.song_id, t.difficulty, t.level,
              s.title, s.jacket, c.const::text as chart_const
         from app.course_tracks t
         left join app.songs s on s.id = t.song_id
         left join app.charts c
                on c.song_id = t.song_id and c.difficulty = t.difficulty
        order by t.course_id, t.position`,
    );
  }
}
