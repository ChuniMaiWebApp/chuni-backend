import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DatabaseService } from '../../shared/database/database.service';
import type { SeedCourse, SeedSong } from './seed.types';

/**
 * Keeps the song catalogue itself current.
 *
 * Region flags only describe songs we already know about, so without this a
 * song released last week is not "Japan only" — it simply does not exist, and
 * a player's score on it is silently dropped at sync time.
 *
 * Downloads straight into memory rather than via `data/*.json`. The files in
 * that directory are the bundled copy used for a first-time offline seed; a
 * scheduled job writing to them would need a writable checkout, which a
 * deployed container has no business having.
 */

const UPSTREAM =
  'https://raw.githubusercontent.com/beer-psi/chuni-penguin/develop/chuni_penguin/database/seeds';

/** Postgres caps a statement at 65535 parameters. */
const BATCH_SIZE = 500;

/**
 * A download smaller than this is treated as a broken fetch, not as the
 * catalogue having shrunk. Upserts cannot delete rows, but recording a bad
 * download as a successful refresh would hide the real staleness.
 */
const MIN_PLAUSIBLE_SONGS = 1_500;

export interface SeedRefreshResult {
  changed: boolean;
  songCount: number;
  chartCount: number;
  aliasCount: number;
  courseCount: number;
  newestRelease: string | null;
  /** Course tracks pointing at songs the dataset does not carry. */
  skippedTracks: number[];
}

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

function placeholders(rowCount: number, columnCount: number): string {
  return Array.from({ length: rowCount }, (_, row) => {
    const values = Array.from(
      { length: columnCount },
      (_, column) => `$${row * columnCount + column + 1}`,
    );

    return `(${values.join(', ')})`;
  }).join(', ');
}

async function insertBatched(
  client: PoolClient,
  sql: (values: string) => string,
  rows: unknown[][],
): Promise<void> {
  if (rows.length === 0) return;

  const columnCount = rows[0].length;

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);

    await client.query(
      sql(placeholders(batch.length, columnCount)),
      batch.flat(),
    );
  }
}

@Injectable()
export class SeedRefreshService {
  private readonly logger = new Logger(SeedRefreshService.name);

  constructor(private readonly db: DatabaseService) {}

  private async download(name: string, required: boolean) {
    const url = `${UPSTREAM}/${name}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (required) throw new Error(`${url} responded ${response.status}`);

      this.logger.warn(
        `Skipping ${name}: upstream responded ${response.status}`,
      );

      return null;
    }

    return { url, body: await response.text() };
  }

  /** The newest release date present, the most useful staleness signal. */
  private static newestRelease(songs: SeedSong[]): string | null {
    return (
      songs
        .map((song) => song.release)
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1) ?? null
    );
  }

  /**
   * Downloads the dataset and loads it if it changed.
   *
   * An unchanged upstream still records a refresh row, so staleness reporting
   * can tell "nothing new upstream" from "nobody has checked in a month".
   */
  async refresh(options: { force?: boolean } = {}): Promise<SeedRefreshResult> {
    const songsFile = await this.download('songs.json', true);
    const coursesFile = await this.download('courses.json', false);

    const songs = JSON.parse(songsFile!.body) as SeedSong[];

    if (!Array.isArray(songs) || songs.length < MIN_PLAUSIBLE_SONGS) {
      throw new Error(
        `Upstream returned ${Array.isArray(songs) ? songs.length : 0} songs, ` +
          'which looks like a broken download. Catalogue left untouched.',
      );
    }

    const contentHash = hash(songsFile!.body);
    const previous = await this.db.queryOne<{ content_hash: string }>(
      'select content_hash from app.seed_refreshes order by fetched_at desc limit 1',
    );

    const changed = previous?.content_hash !== contentHash;
    const chartCount = songs.reduce(
      (total, song) => total + song.charts.length,
      0,
    );
    const newestRelease = SeedRefreshService.newestRelease(songs);

    let aliasCount = 0;
    let courseCount = 0;
    let skippedTracks: number[] = [];

    if (changed || options.force) {
      const courses = coursesFile
        ? (JSON.parse(coursesFile.body) as SeedCourse[])
        : [];
      const loaded = await this.load(songs, courses);

      aliasCount = loaded.aliasCount;
      courseCount = loaded.courseCount;
      skippedTracks = loaded.skippedTracks;
    }

    await this.db.query(
      `insert into app.seed_refreshes
         (source, content_hash, song_count, chart_count, newest_release, changed)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        songsFile!.url,
        contentHash,
        songs.length,
        chartCount,
        newestRelease,
        changed,
      ],
    );

    this.logger.log(
      changed || options.force
        ? `Song catalogue loaded: ${songs.length} songs, ${chartCount} charts, newest release ${newestRelease}`
        : `Song catalogue unchanged upstream (${songs.length} songs, newest release ${newestRelease})`,
    );

    return {
      changed,
      songCount: songs.length,
      chartCount,
      aliasCount,
      courseCount,
      newestRelease,
      skippedTracks,
    };
  }

  /**
   * Upserts songs, charts, aliases and courses in one transaction.
   *
   * Upsert rather than replace: a song vanishing from the upstream must not
   * take the player's scores with it, and aliases players added themselves are
   * never clobbered.
   */
  async load(
    songs: SeedSong[],
    courses: SeedCourse[],
  ): Promise<{
    aliasCount: number;
    courseCount: number;
    skippedTracks: number[];
  }> {
    return this.db.transaction(async (client) => {
      const songRows = songs.map((song) => [
        song.id,
        song.title,
        song.artist,
        song.genre,
        song.version,
        song.release,
        song.bpm,
        song.min_bpm,
        song.max_bpm,
        song.jacket,
        song.duration,
        song.available,
        song.removed,
        song.is_hidden_on_chuninet,
      ]);

      await insertBatched(
        client,
        (values) => `
          insert into app.songs (
            id, title, artist, genre, version, release_date,
            bpm, min_bpm, max_bpm, jacket, duration_ms,
            available, removed, is_hidden_on_chuninet
          ) values ${values}
          on conflict (id) do update set
            title                 = excluded.title,
            artist                = excluded.artist,
            genre                 = excluded.genre,
            version               = excluded.version,
            release_date          = excluded.release_date,
            bpm                   = excluded.bpm,
            min_bpm               = excluded.min_bpm,
            max_bpm               = excluded.max_bpm,
            jacket                = excluded.jacket,
            duration_ms           = excluded.duration_ms,
            available             = excluded.available,
            removed               = excluded.removed,
            is_hidden_on_chuninet = excluded.is_hidden_on_chuninet
        `,
        songRows,
      );

      const chartRows = songs.flatMap((song) =>
        song.charts.map((chart) => [
          song.id,
          chart.difficulty,
          chart.level,
          chart.const,
          chart.maxcombo,
          chart.tap,
          chart.hold,
          chart.slide,
          chart.air,
          chart.flick,
          chart.charter,
          chart.version,
          chart.available,
          chart.sdvxin?.id ?? null,
          chart.sdvxin?.end_index ?? null,
        ]),
      );

      // available_intl / available_jp are deliberately absent: they belong to
      // RegionRefreshService, and listing them here would reset them to null
      // on every seed load.
      await insertBatched(
        client,
        (values) => `
          insert into app.charts (
            song_id, difficulty, level, const, max_combo,
            tap, hold, slide, air, flick, charter, version, available,
            sdvxin_id, sdvxin_end_index
          ) values ${values}
          on conflict (song_id, difficulty) do update set
            level            = excluded.level,
            const            = excluded.const,
            max_combo        = excluded.max_combo,
            tap              = excluded.tap,
            hold             = excluded.hold,
            slide            = excluded.slide,
            air              = excluded.air,
            flick            = excluded.flick,
            charter          = excluded.charter,
            version          = excluded.version,
            available        = excluded.available,
            sdvxin_id        = excluded.sdvxin_id,
            sdvxin_end_index = excluded.sdvxin_end_index
        `,
        chartRows,
      );

      // Aliases are what let a search for "tentai kansoku" find 天体観測.
      const aliasRows = songs.flatMap((song) =>
        (song.aliases ?? []).map((alias) => [song.id, alias.trim()]),
      );

      await insertBatched(
        client,
        (values) => `
          insert into app.song_aliases (song_id, alias) values ${values}
          -- Never clobber aliases players added themselves.
          on conflict (song_id, alias) do nothing
        `,
        aliasRows,
      );

      const { courseCount, skippedTracks } =
        await SeedRefreshService.loadCourses(client, courses);

      return { aliasCount: aliasRows.length, courseCount, skippedTracks };
    });
  }

  /**
   * Courses reference songs, so they can only be inserted once the song rows
   * exist — hence the same transaction, after the songs.
   */
  private static async loadCourses(
    client: PoolClient,
    courses: SeedCourse[],
  ): Promise<{ courseCount: number; skippedTracks: number[] }> {
    if (courses.length === 0) return { courseCount: 0, skippedTracks: [] };

    const courseRows = courses.map((course) => [
      course.id,
      course.cls,
      course.name,
      course.version,
      course.is_duplicate_track_allowed,
      course.life,
      course.recovery_life,
      course.clear_life,
      course.damage_miss,
      course.damage_attack,
      course.damage_justice,
      course.damage_jcrit,
    ]);

    await insertBatched(
      client,
      (values) => `
        insert into app.courses (
          id, class, name, version, is_duplicate_track_allowed,
          life, recovery_life, clear_life,
          damage_miss, damage_attack, damage_justice, damage_jcrit
        ) values ${values}
        on conflict (id) do update set
          class                      = excluded.class,
          name                       = excluded.name,
          version                    = excluded.version,
          is_duplicate_track_allowed = excluded.is_duplicate_track_allowed,
          life                       = excluded.life,
          recovery_life              = excluded.recovery_life,
          clear_life                 = excluded.clear_life,
          damage_miss                = excluded.damage_miss,
          damage_attack              = excluded.damage_attack,
          damage_justice             = excluded.damage_justice,
          damage_jcrit               = excluded.damage_jcrit
      `,
      courseRows,
    );

    const known = await client.query<{ id: number }>(
      'select id from app.songs',
    );
    const knownSongs = new Set(known.rows.map((row) => row.id));

    const trackRows: unknown[][] = [];
    const skipped: number[] = [];

    for (const course of courses) {
      course.tracks.forEach((track, index) => {
        const chart = track.charts?.[0];

        if (chart) {
          // A course can reference a song the dataset does not carry; the
          // foreign key would abort the whole seed, so drop it and report.
          if (!knownSongs.has(chart.song_id)) {
            skipped.push(chart.song_id);

            return;
          }

          trackRows.push([
            course.id,
            index + 1,
            chart.song_id,
            chart.difficulty,
            null,
          ]);

          return;
        }

        if (track.level) {
          trackRows.push([course.id, index + 1, null, null, track.level]);
        }
      });
    }

    // Track lists are an ordered whole; replacing them avoids leaving stale
    // positions behind when a course is reshuffled.
    await client.query('delete from app.course_tracks');
    await insertBatched(
      client,
      (values) => `
        insert into app.course_tracks
          (course_id, position, song_id, difficulty, level)
        values ${values}
      `,
      trackRows,
    );

    return {
      courseCount: courseRows.length,
      skippedTracks: [...new Set(skipped)],
    };
  }

  /** Staleness report, for the CLI and the scheduler's boot check. */
  status() {
    return this.db.queryOne<{
      fetched_at: Date;
      newest_release: string | null;
      song_count: number;
      changed: boolean;
    }>(
      `select fetched_at, newest_release::text as newest_release,
              song_count, changed
         from app.seed_refreshes order by fetched_at desc limit 1`,
    );
  }
}
