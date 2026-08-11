import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';

import type { AppConfig } from '../../config';
import { DatabaseService } from '../../shared/database/database.service';
import type { CatalogueRefreshResult, CatalogueSong } from './catalogue.types';
import { fetchChunirecConstants } from './sources/chunirec-constants';
import { fetchSegaMusicList } from './sources/sega-music-list';

/**
 * Keeps the song catalogue current from first-party and documented sources.
 *
 * Two upstreams, because neither is complete on its own:
 *
 *   SEGA      — identity. Song id, title, artist, genre, jacket, printed
 *               level, WORLD'S END markings, and the reading that makes
 *               romaji search work.
 *   chunirec  — the chart constant, which the game never publishes, plus BPM,
 *               release date and note totals.
 *
 * SEGA wins every field they both carry. It assigns the ids the rest of this
 * database is keyed on, so letting a second feed rename or re-genre a song
 * would only introduce disagreement with the game the player is looking at.
 */

/** Marks these rows in `app.seed_refreshes`. */
const SOURCE_NAME = 'sega+chunirec';

/**
 * `app.song_aliases.source` is constrained to 'seed' or 'user'. Readings load
 * as 'seed' — the catalogue-supplied set, as opposed to the ones players add,
 * which a refresh must never delete.
 */
const ALIAS_SOURCE = 'seed';

/** Postgres caps a statement at 65535 parameters. */
const BATCH_SIZE = 500;

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
export class CatalogueRefreshService {
  private readonly logger = new Logger(CatalogueRefreshService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async refresh(force = false): Promise<CatalogueRefreshResult> {
    const songs = await fetchSegaMusicList();
    const { chunirecToken } = this.config.get('songData', { infer: true });

    let unmatchedSongs = 0;
    let chartsWithConstant = 0;

    if (chunirecToken) {
      const constants = await fetchChunirecConstants(chunirecToken);

      for (const song of songs) {
        const measured = constants.get(song.title);

        if (!measured) {
          // WORLD'S END arrangements and brand-new songs routinely have no
          // entry. Counted rather than logged one by one.
          unmatchedSongs += 1;
          continue;
        }

        song.bpm = measured.bpm;
        song.releaseDate = measured.releaseDate;

        for (const chart of song.charts) {
          const sheet = measured.charts.get(chart.difficulty);

          if (!sheet) continue;

          // SEGA's printed level already gave BASIC and ADVANCED a constant;
          // chunirec measures nothing there, so it must not overwrite with null.
          chart.constant = sheet.constant ?? chart.constant;
          chart.maxCombo = sheet.maxCombo ?? chart.maxCombo;
        }
      }
    } else {
      this.logger.warn(
        'CHUNIREC_TOKEN is not set — song data will load without chart ' +
          'constants, and play rating cannot be computed without them.',
      );
      unmatchedSongs = songs.length;
    }

    chartsWithConstant = songs.reduce(
      (total, song) =>
        total + song.charts.filter((chart) => chart.constant !== null).length,
      0,
    );

    const chartCount = songs.reduce(
      (total, song) => total + song.charts.length,
      0,
    );

    const contentHash = hash(JSON.stringify(songs));
    const newestRelease = songs.reduce<string | null>(
      (newest, song) =>
        song.releaseDate && (!newest || song.releaseDate > newest)
          ? song.releaseDate
          : newest,
      null,
    );

    const unchanged = !force && (await this.isUnchanged(contentHash));

    if (unchanged) {
      await this.recordRefresh({
        contentHash,
        songCount: songs.length,
        chartCount,
        newestRelease,
        changed: false,
      });

      this.logger.log(
        `Catalogue unchanged upstream (${songs.length} songs, newest release ${newestRelease ?? 'unknown'})`,
      );

      return {
        changed: false,
        songCount: songs.length,
        chartCount,
        chartsWithConstant,
        unmatchedSongs,
        newestRelease,
      };
    }

    await this.store(songs);
    await this.recordRefresh({
      contentHash,
      songCount: songs.length,
      chartCount,
      newestRelease,
      changed: true,
    });

    this.logger.log(
      `Catalogue loaded: ${songs.length} songs, ${chartCount} charts, ` +
        `${chartsWithConstant} with a constant, newest release ${newestRelease ?? 'unknown'}`,
    );

    return {
      changed: true,
      songCount: songs.length,
      chartCount,
      chartsWithConstant,
      unmatchedSongs,
      newestRelease,
    };
  }

  private async isUnchanged(contentHash: string): Promise<boolean> {
    const rows = await this.db.query<{ content_hash: string }>(
      `select content_hash
         from app.seed_refreshes
        where source = $1 and changed
        order by fetched_at desc
        limit 1`,
      [SOURCE_NAME],
    );

    return rows[0]?.content_hash === contentHash;
  }

  private async recordRefresh(entry: {
    contentHash: string;
    songCount: number;
    chartCount: number;
    newestRelease: string | null;
    changed: boolean;
  }): Promise<void> {
    await this.db.query(
      `insert into app.seed_refreshes
         (source, content_hash, song_count, chart_count, newest_release, changed)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        SOURCE_NAME,
        entry.contentHash,
        entry.songCount,
        entry.chartCount,
        entry.newestRelease,
        entry.changed,
      ],
    );
  }

  private async store(songs: CatalogueSong[]): Promise<void> {
    await this.db.transaction(async (client) => {
      const songRows = songs.map((song) => [
        song.id,
        song.title,
        song.artist,
        song.genre,
        song.releaseDate,
        song.bpm,
        song.jacket,
      ]);

      // Only the columns these two upstreams actually know about are listed.
      // `version`, `duration_ms`, `removed` and the region flags are owned
      // elsewhere; naming them here would reset each of them to null on every
      // refresh — the same trap that region data already had to be rescued
      // from once.
      await insertBatched(
        client,
        (values) => `
          insert into app.songs (
            id, title, artist, genre, release_date, bpm, jacket
          ) values ${values}
          on conflict (id) do update set
            title        = excluded.title,
            artist       = excluded.artist,
            genre        = excluded.genre,
            release_date = coalesce(excluded.release_date, app.songs.release_date),
            bpm          = coalesce(excluded.bpm, app.songs.bpm),
            jacket       = coalesce(excluded.jacket, app.songs.jacket)
        `,
        songRows,
      );

      const chartRows = songs.flatMap((song) =>
        song.charts.map((chart) => [
          song.id,
          chart.difficulty,
          chart.displayLevel,
          chart.constant,
          chart.maxCombo,
        ]),
      );

      // Note counts by type, charter and the chart-view ids are deliberately
      // absent: no first-party source publishes them, so they are left as
      // whatever is already stored rather than blanked.
      await insertBatched(
        client,
        (values) => `
          insert into app.charts (
            song_id, difficulty, level, const, max_combo
          ) values ${values}
          on conflict (song_id, difficulty) do update set
            level     = excluded.level,
            const     = coalesce(excluded.const, app.charts.const),
            max_combo = coalesce(excluded.max_combo, app.charts.max_combo)
        `,
        chartRows,
      );

      // SEGA's reading is what lets a search for "tentai kansoku" reach
      // 天体観測. Replaced wholesale each time so a corrected reading does not
      // leave the old one behind as a second match.
      await client.query(
        `delete from app.song_aliases
          where song_id = any($1::int[]) and source = $2`,
        [songs.map((song) => song.id), ALIAS_SOURCE],
      );

      const aliasRows = songs.flatMap((song) =>
        song.reading ? [[song.id, song.reading, ALIAS_SOURCE]] : [],
      );

      await insertBatched(
        client,
        (values) => `
          insert into app.song_aliases (song_id, alias, source)
          values ${values}
          on conflict do nothing
        `,
        aliasRows,
      );
    });
  }
}
