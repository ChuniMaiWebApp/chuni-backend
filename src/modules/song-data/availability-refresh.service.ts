import { Injectable, Logger } from '@nestjs/common';

import { ChunithmNetService } from '../../shared/chunithm-net/chunithm-net.service';
import { Difficulty } from '../../shared/chunithm-net/chunithm-net.types';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { DatabaseService } from '../../shared/database/database.service';
import { fetchSegaMusicList } from './sources/sega-music-list';
import type { ChartDifficulty } from './catalogue.types';

/**
 * Records which charts each region actually has.
 *
 * Both answers come from the party that owns them:
 *
 *   Japan          — SEGA's own music list, which is the Japanese cabinet's
 *                    catalogue by definition.
 *   International  — the signed-in CHUNITHM-NET music list, which is the
 *                    International server's own inventory.
 *
 * The International side has to be read while signed in because no published
 * list is complete. SEGA's International music page is a periodic snapshot —
 * the one read on 2026-08-07 had been published on 2026-04-09 — and neither
 * regional page lists songs unlocked through a mission or a Linked VERSE gate,
 * which is why Phantom Crisis and Melodiniq were missing from both. The
 * signed-in list has no such gap: it is the server describing itself, gates
 * and all.
 *
 * Any linked account will do. The inventory belongs to the server, not to the
 * player reading it — the account only supplies a session.
 */

/** Difficulty codes as stored, indexed by the game's own difficulty number. */
const STORED_DIFFICULTY: Partial<Record<Difficulty, ChartDifficulty>> = {
  [Difficulty.BASIC]: 'BAS',
  [Difficulty.ADVANCED]: 'ADV',
  [Difficulty.EXPERT]: 'EXP',
  [Difficulty.MASTER]: 'MAS',
  [Difficulty.ULTIMA]: 'ULT',
  [Difficulty.WORLDS_END]: 'WE',
};

/**
 * Below this the International read is treated as broken rather than as the
 * region having shrunk. A session that has silently signed out returns pages
 * that parse to nothing, and writing that result would mark the entire
 * catalogue as unavailable.
 */
const MIN_PLAUSIBLE_INTL_CHARTS = 2_000;

/** Same guard for the Japanese list. */
const MIN_PLAUSIBLE_JP_CHARTS = 2_000;

export interface AvailabilityRefreshResult {
  intlCharts: number;
  jpCharts: number;
  /** Charts listed by a region that this database has no row for. */
  unknownCharts: number;
  updatedCharts: number;
}

@Injectable()
export class AvailabilityRefreshService {
  private readonly logger = new Logger(AvailabilityRefreshService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly chunithmNet: ChunithmNetService,
  ) {}

  async refresh(): Promise<AvailabilityRefreshResult> {
    const intl = await this.readInternational();
    const jp = await this.readJapan();

    if (intl.size < MIN_PLAUSIBLE_INTL_CHARTS) {
      throw new Error(
        `International list returned only ${intl.size} charts, expected at least ${MIN_PLAUSIBLE_INTL_CHARTS}`,
      );
    }

    if (jp.size < MIN_PLAUSIBLE_JP_CHARTS) {
      throw new Error(
        `Japanese list returned only ${jp.size} charts, expected at least ${MIN_PLAUSIBLE_JP_CHARTS}`,
      );
    }

    return this.store(intl, jp);
  }

  /** `songId:difficulty` for every chart CHUNITHM-NET International lists. */
  private async readInternational(): Promise<Set<string>> {
    const rows = await this.db.query<{ cookie_jar: string }>(
      `select cookie_jar
         from app.chunithm_links
        where invalidated_at is null
        order by last_used_at desc nulls last
        limit 1`,
    );

    if (rows.length === 0) {
      throw new Error(
        'No linked CHUNITHM-NET account, so International availability cannot be read.',
      );
    }

    const session = this.chunithmNet.createSession({
      cookieJar: this.crypto.decrypt(rows[0].cookie_jar),
    });

    const charts = await session.getMusicCatalogue();
    const listed = new Set<string>();

    for (const chart of charts) {
      const difficulty = STORED_DIFFICULTY[chart.difficulty];

      if (difficulty) listed.add(`${chart.songId}:${difficulty}`);
    }

    return listed;
  }

  /** `songId:difficulty` for every chart SEGA's Japanese list carries. */
  private async readJapan(): Promise<Set<string>> {
    const songs = await fetchSegaMusicList();
    const listed = new Set<string>();

    for (const song of songs) {
      for (const chart of song.charts) {
        listed.add(`${song.id}:${chart.difficulty}`);
      }
    }

    return listed;
  }

  private async store(
    intl: Set<string>,
    jp: Set<string>,
  ): Promise<AvailabilityRefreshResult> {
    return this.db.transaction(async (client) => {
      const existing = await client.query<{
        song_id: number;
        difficulty: string;
      }>('select song_id, difficulty from app.charts');

      const known = new Set(
        existing.rows.map((row) => `${row.song_id}:${row.difficulty}`),
      );

      // Null rather than false for anything neither region lists: "no entry"
      // and "not in that region" are different claims, and a removed song is
      // the bulk of the first.
      await client.query(
        'update app.charts set available_intl = null, available_jp = null',
      );

      const rows = [...new Set([...intl, ...jp])]
        .filter((key) => known.has(key))
        .map((key) => {
          const [songId, difficulty] = key.split(':');

          return [
            Number(songId),
            difficulty,
            intl.has(key),
            jp.has(key),
          ] as const;
        });

      for (const [songId, difficulty, hasIntl, hasJp] of rows) {
        await client.query(
          `update app.charts
              set available_intl = $3, available_jp = $4
            where song_id = $1 and difficulty = $2`,
          [songId, difficulty, hasIntl, hasJp],
        );
      }

      // A chart a region lists but this database has never heard of is a song
      // released since the last catalogue refresh. Counted, not invented —
      // creating a row here would mean a song with no title or constant.
      const unknownCharts = [...new Set([...intl, ...jp])].filter(
        (key) => !known.has(key),
      ).length;

      // Records the run. Two things read this table and both would otherwise
      // freeze: the boot catch-up decides staleness from the newest row, and
      // the songs API states availability "as of" it rather than flatly —
      // "not on International" is a different claim from a month-old file
      // than from this morning's.
      //
      // `published_at` is null on purpose. The old upstream was a file with
      // its own publication date, which could be days behind the fetch; these
      // sources are read live, so the fetch time *is* the accuracy date and
      // inventing a second one would only overstate precision.
      await client.query(
        `insert into app.region_refreshes
           (source_url, published_at, song_count, matched_songs, unmatched_songs)
         values ($1, null, $2, $3, $4)`,
        [
          'chunithm-net-eng.com + chunithm.sega.jp',
          intl.size + jp.size,
          rows.length,
          unknownCharts,
        ],
      );

      this.logger.log(
        `Availability updated: ${rows.length} charts (${intl.size} international, ${jp.size} Japanese)` +
          (unknownCharts > 0
            ? `, ${unknownCharts} listed chart(s) not yet in the catalogue`
            : ''),
      );

      return {
        intlCharts: intl.size,
        jpCharts: jp.size,
        unknownCharts,
        updatedCharts: rows.length,
      };
    });
  }
}
