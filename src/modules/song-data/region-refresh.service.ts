import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../../shared/database/database.service';

/**
 * Records which charts are playable in which region.
 *
 * Source: arcade-songs (zetaraku), which merges SEGA's Japanese and
 * International music lists with CHUNITHM-NET and publishes a per-chart
 * `regions: { jp, intl }`, refreshed daily.
 *
 * Why this rather than the seeded `available` flag, SEGA's own lists, or the
 * player's scores — see migrations/0009_chart_regions.sql. Short version: the
 * flag disagrees with SEGA in both directions, SEGA's own lists omit every
 * song unlocked through a mission or a Linked VERSE gate, and scores can only
 * ever prove a song IS playable.
 *
 * Lives here rather than in a script so the scheduled refresh and the CLI run
 * the same code; two copies of this would drift and only one would be tested.
 */

export const REGION_SOURCE_URL =
  'https://dp4p6x0xfi5o9.cloudfront.net/chunithm/data.json';

/** Upstream difficulty names to the short codes this database uses. */
const DIFFICULTY: Record<string, string> = {
  basic: 'BAS',
  advanced: 'ADV',
  expert: 'EXP',
  master: 'MAS',
  ultima: 'ULT',
};

const WORLDS_END_CATEGORY = "WORLD'S END";

/** Song ids at or above this are the game's WORLD'S END entries. */
const WORLDS_END_ID_FLOOR = 8000;

/**
 * Below this many matched songs the upstream is treated as broken rather than
 * as news. A scheduled job must not quietly relabel the whole catalogue as
 * unknown because a CDN served an error page that happened to parse.
 */
const MIN_PLAUSIBLE_MATCHES = 1_000;

interface UpstreamNoteCounts {
  tap?: number | null;
  hold?: number | null;
  slide?: number | null;
  air?: number | null;
  flick?: number | null;
  total?: number | null;
}

interface UpstreamSheet {
  difficulty: string;
  level: string;
  levelValue?: number;
  internalLevel?: string;
  internalLevelValue?: number;
  noteDesigner?: string;
  noteCounts?: UpstreamNoteCounts;
  regions: { jp: boolean; intl: boolean };
}

interface UpstreamSong {
  songId?: string;
  title: string;
  artist?: string;
  category: string;
  bpm?: number;
  imageName?: string;
  version?: string;
  releaseDate?: string;
  sheets: UpstreamSheet[];
}

interface UpstreamData {
  updateTime?: string;
  songs?: UpstreamSong[];
}

export interface RegionRefreshResult {
  publishedAt: Date | null;
  upstreamSongs: number;
  matchedSongs: number;
  unmatchedSongs: number;
  chartsUpdated: number;
  /** Songs with no upstream entry that the game has not removed. */
  unexplainedMisses: Array<{ id: number; title: string }>;
}

/**
 * One title can name two songs — a normal one and a WORLD'S END arrangement —
 * so the key carries that distinction and nothing else.
 */
const songKey = (title: string, isWorldsEnd: boolean) =>
  `${title} ${isWorldsEnd ? 'WE' : 'STD'}`;

@Injectable()
export class RegionRefreshService {
  private readonly logger = new Logger(RegionRefreshService.name);

  constructor(private readonly db: DatabaseService) {}

  async refresh(): Promise<RegionRefreshResult> {
    const response = await fetch(REGION_SOURCE_URL);

    if (!response.ok) {
      throw new Error(`${REGION_SOURCE_URL} responded ${response.status}`);
    }

    const data = (await response.json()) as UpstreamData;

    if (!Array.isArray(data.songs) || data.songs.length === 0) {
      throw new Error(
        `${REGION_SOURCE_URL} returned no songs; leaving the current data alone.`,
      );
    }

    const publishedAt = data.updateTime ? new Date(data.updateTime) : null;
    const upstream = new Map<string, UpstreamSong>();

    for (const song of data.songs) {
      upstream.set(
        songKey(song.title, song.category === WORLDS_END_CATEGORY),
        song,
      );
    }

    const songs = await this.db.query<{
      id: number;
      title: string;
      version: string;
      removed: boolean;
    }>('select id, title, version, removed from app.songs');

    const updates: Array<[number, string, boolean, boolean]> = [];
    const unmatched: Array<{ id: number; title: string; removed: boolean }> =
      [];
    const songVersionUpdates: [number, string][] = [];
    const matchedUpstreamKeys = new Set<string>();

    for (const song of songs) {
      const key = songKey(song.title, song.id >= WORLDS_END_ID_FLOOR);
      const match = upstream.get(key);

      if (!match) {
        unmatched.push(song);
        continue;
      }

      matchedUpstreamKeys.add(key);

      if (match.version && match.version !== song.version) {
        songVersionUpdates.push([song.id, match.version]);
      }

      for (const sheet of match.sheets) {
        // WORLD'S END sheets carry the kanji as their difficulty name, so
        // anything unmapped in that id range is still a WE chart.
        const difficulty =
          DIFFICULTY[sheet.difficulty] ??
          (song.id >= WORLDS_END_ID_FLOOR ? 'WE' : null);

        if (!difficulty) continue;

        updates.push([
          song.id,
          difficulty,
          sheet.regions.intl,
          sheet.regions.jp,
        ]);
      }
    }

    const missingUpstream: UpstreamSong[] = [];
    for (const [key, song] of upstream.entries()) {
      if (!matchedUpstreamKeys.has(key)) {
        missingUpstream.push(song);
      }
    }

    const matchedSongs = songs.length - unmatched.length;

    if (matchedSongs < MIN_PLAUSIBLE_MATCHES) {
      throw new Error(
        `Only ${matchedSongs} of ${songs.length} songs matched the upstream, ` +
          'which looks like a bad download rather than a real change. ' +
          'Existing region data left untouched.',
      );
    }

    await this.db.transaction(async (client) => {
      // Clean up duplicate synthetic songs if an official seed song now shares the exact same title
      await client.query(`
        delete from app.songs s1
         where s1.id >= 90000
           and exists (
             select 1 from app.songs s2
              where s2.id < 90000
                and s2.title = s1.title
           )
      `);

      // Synthesize missing songs from arcade-songs (zetaraku)
      if (missingUpstream.length > 0) {
        const maxIds = await client.query<{
          max_std: number | null;
          max_we: number | null;
        }>(`
          select max(case when id < 8000 then id end) as max_std,
                 max(case when id >= 8000 and id < 90000 then id end) as max_we
            from app.songs
        `);

        let nextStdId = Math.max(90000, (maxIds.rows[0]?.max_std ?? 3000) + 1);
        let nextWeId = Math.max(98000, (maxIds.rows[0]?.max_we ?? 8300) + 1);

        for (const missing of missingUpstream) {
          const isWe = missing.category === WORLDS_END_CATEGORY;
          const newId = isWe ? nextWeId++ : nextStdId++;

          await client.query(
            `insert into app.songs (
               id, title, artist, genre, version, release_date, bpm, min_bpm, max_bpm,
               jacket, available, removed, is_hidden_on_chuninet
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, false, false)
             on conflict (id) do update set
               title = excluded.title,
               artist = excluded.artist,
               genre = excluded.genre,
               version = excluded.version,
               release_date = excluded.release_date,
               bpm = excluded.bpm,
               min_bpm = excluded.min_bpm,
               max_bpm = excluded.max_bpm,
               jacket = excluded.jacket`,
            [
              newId,
              missing.title,
              missing.artist || 'Unknown',
              missing.category,
              missing.version || 'UNKNOWN',
              missing.releaseDate || null,
              missing.bpm || null,
              missing.bpm || null,
              missing.bpm || null,
              missing.imageName || null,
            ],
          );

          for (const sheet of missing.sheets) {
            const difficulty =
              DIFFICULTY[sheet.difficulty] ?? (isWe ? 'WE' : null);

            if (!difficulty) continue;

            const chartConst =
              sheet.internalLevelValue ?? sheet.levelValue ?? null;
            const noteDesigner =
              sheet.noteDesigner && sheet.noteDesigner !== '-'
                ? sheet.noteDesigner
                : null;

            await client.query(
              `insert into app.charts (
                 song_id, difficulty, level, const, max_combo,
                 tap, hold, slide, air, flick, charter, version, available,
                 available_intl, available_jp
               ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14)
               on conflict (song_id, difficulty) do update set
                 level = excluded.level,
                 const = excluded.const,
                 max_combo = excluded.max_combo,
                 tap = excluded.tap,
                 hold = excluded.hold,
                 slide = excluded.slide,
                 air = excluded.air,
                 flick = excluded.flick,
                 charter = excluded.charter,
                 version = excluded.version,
                 available_intl = excluded.available_intl,
                 available_jp = excluded.available_jp`,
              [
                newId,
                difficulty,
                sheet.level,
                chartConst,
                sheet.noteCounts?.total ?? null,
                sheet.noteCounts?.tap ?? null,
                sheet.noteCounts?.hold ?? null,
                sheet.noteCounts?.slide ?? null,
                sheet.noteCounts?.air ?? null,
                sheet.noteCounts?.flick ?? null,
                noteDesigner,
                missing.version || null,
                sheet.regions.intl,
                sheet.regions.jp,
              ],
            );

            updates.push([
              newId,
              difficulty,
              sheet.regions.intl,
              sheet.regions.jp,
            ]);
          }
        }
      }

      // A refresh replaces the whole picture, so stale rows must not survive
      // as a leftover `true` on a chart the upstream no longer lists.
      await client.query(
        'update app.charts set available_intl = null, available_jp = null',
      );

      for (const [songId, difficulty, intl, jp] of updates) {
        await client.query(
          `update app.charts
              set available_intl = $3, available_jp = $4
            where song_id = $1 and difficulty = $2`,
          [songId, difficulty, intl, jp],
        );
      }

      for (const [songId, newVersion] of songVersionUpdates) {
        await client.query(`update app.songs set version = $2 where id = $1`, [
          songId,
          newVersion,
        ]);
      }

      // Song level: available in a region when any of its charts is.
      await client.query(`
        update app.songs s
           set available_intl = c.intl, available_jp = c.jp
          from (select song_id,
                       bool_or(available_intl) as intl,
                       bool_or(available_jp) as jp
                  from app.charts group by song_id) c
         where c.song_id = s.id`);

      await client.query(
        `insert into app.region_refreshes
           (source_url, published_at, song_count, matched_songs, unmatched_songs)
         values ($1, $2, $3, $4, $5)`,
        [
          REGION_SOURCE_URL,
          publishedAt,
          data.songs!.length,
          matchedSongs,
          unmatched.length,
        ],
      );
    });

    // Removed songs dropping out of the upstream is expected; anything else is
    // a matching bug and worth seeing rather than shrugging off.
    const unexplainedMisses = unmatched
      .filter((song) => !song.removed)
      .map(({ id, title }) => ({ id, title }));

    this.logger.log(
      `Region data refreshed: ${matchedSongs} songs matched, ` +
        `${updates.length} charts updated, ${unmatched.length} unmatched`,
    );

    if (unexplainedMisses.length > 0) {
      this.logger.warn(
        `${unexplainedMisses.length} song(s) still in the game have no upstream entry: ` +
          unexplainedMisses
            .slice(0, 5)
            .map((song) => `${song.id} ${song.title}`)
            .join(', '),
      );
    }

    return {
      publishedAt,
      upstreamSongs: data.songs.length,
      matchedSongs,
      unmatchedSongs: unmatched.length,
      chartsUpdated: updates.length,
      unexplainedMisses,
    };
  }

  /** How the catalogue currently splits, for the CLI and for logging. */
  summary() {
    return this.db.query<{ state: string; count: string }>(`
      select case
               when removed then 'removed from the game'
               when available_intl then 'playable on International'
               when available_intl = false and available_jp then 'Japan only'
               when available_intl = false then 'in neither region'
               else 'unknown'
             end as state,
             count(*)::text
        from app.songs
       group by 1 order by 2 desc`);
  }
}
