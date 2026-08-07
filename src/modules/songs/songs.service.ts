import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DIFFICULTY_SHORT,
  Difficulty,
} from '../../shared/chunithm-net/chunithm-net.types';
import { deriveAvailability, type AvailabilityView } from './availability';
import { jacketUrl, sdvxinUrl, youtubeSearchUrl } from './song-links';
import {
  SongsRepository,
  type ChartRow,
  type SongRow,
} from './songs.repository';

export type { AvailabilityView };

export interface ChartView {
  difficulty: Difficulty;
  difficultyName: string;
  level: string;
  const: number | null;
  maxCombo: number | null;
  notes: {
    tap: number | null;
    hold: number | null;
    slide: number | null;
    air: number | null;
    flick: number | null;
  };
  charter: string | null;
  version: string | null;
  available: boolean;
  /** Null when the regional dataset has no entry for this chart. */
  availableIntl: boolean | null;
  availableJp: boolean | null;
  sdvxinUrl: string | null;
  youtubeUrl: string;
}

export interface SongView {
  id: number;
  title: string;
  artist: string;
  genre: string;
  version: string;
  releaseDate: string | null;
  bpm: { primary: number | null; min: number | null; max: number | null };
  durationSeconds: number | null;
  jacketUrl: string | null;
  available: boolean;
  removed: boolean;
  availableIntl: boolean | null;
  availableJp: boolean | null;
  aliases?: string[];
  charts?: ChartView[];
  availability?: AvailabilityView;
}

const DIFFICULTY_FROM_SHORT: Record<string, Difficulty> = Object.fromEntries(
  Object.entries(DIFFICULTY_SHORT).map(([value, short]) => [
    short,
    Number(value),
  ]),
);

/** Turns `14+` into the constant band it covers, or `13.7` into an exact one. */
export function parseLevelQuery(raw: string): {
  level?: string;
  minConst?: number;
  maxConst?: number;
} {
  const value = raw.trim();

  // Range: "13.5-13.8"
  const range = value.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);

  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);

    if (min > max) {
      throw new BadRequestException(
        `Invalid range: ${min} is higher than ${max}.`,
      );
    }

    return { minConst: min, maxConst: max };
  }

  // Displayed level: "14" or "14+"
  if (/^\d{1,2}\+?$/.test(value)) return { level: value };

  // Exact chart constant: "14.5"
  if (/^\d{1,2}\.\d$/.test(value)) {
    const exact = Number(value);

    return { minConst: exact, maxConst: exact };
  }

  throw new BadRequestException(
    `Could not read "${raw}" as a level (14+), a chart constant (14.5) or a range (13.5-13.8).`,
  );
}

@Injectable()
export class SongsService {
  constructor(private readonly repository: SongsRepository) {}

  private toSongView(row: SongRow): SongView {
    const number = (value: string | null) =>
      value === null ? null : Number(value);

    return {
      id: row.id,
      title: row.title,
      artist: row.artist,
      genre: row.genre,
      version: row.version,
      // Already a plain YYYY-MM-DD string from Postgres — deliberately not
      // routed through Date, which would shift it a day in non-UTC zones.
      releaseDate: row.release_date,
      bpm: {
        primary: number(row.bpm),
        min: number(row.min_bpm),
        max: number(row.max_bpm),
      },
      durationSeconds: row.duration_ms
        ? Math.round(row.duration_ms / 1000)
        : null,
      jacketUrl: jacketUrl(row.jacket),
      available: row.available,
      removed: row.removed,
      availableIntl: row.available_intl,
      availableJp: row.available_jp,
    };
  }

  private toChartView(row: ChartRow, title: string): ChartView {
    const difficulty =
      DIFFICULTY_FROM_SHORT[row.difficulty] ?? Difficulty.MASTER;

    return {
      difficulty,
      difficultyName: row.difficulty,
      level: row.level,
      const: row.const === null ? null : Number(row.const),
      maxCombo: row.max_combo,
      notes: {
        tap: row.tap,
        hold: row.hold,
        slide: row.slide,
        air: row.air,
        flick: row.flick,
      },
      charter: row.charter,
      version: row.version,
      available: row.available,
      availableIntl: row.available_intl,
      availableJp: row.available_jp,
      sdvxinUrl: row.sdvxin_id
        ? sdvxinUrl(row.sdvxin_id, difficulty, row.sdvxin_end_index)
        : null,
      youtubeUrl: youtubeSearchUrl(title, difficulty),
    };
  }

  async search(query: string, limit: number, availableOnly: boolean) {
    const trimmed = query.trim();

    if (trimmed.length === 0) {
      throw new BadRequestException('Search query cannot be empty.');
    }

    const rows = await this.repository.search(trimmed, limit, availableOnly);

    return rows.map((row) => ({
      ...this.toSongView(row),
      // Surfacing the alias that matched explains why a result is in the list.
      matchedAlias: row.matched_alias,
      score: Number(row.score),
    }));
  }

  async findById(id: number): Promise<SongView> {
    const song = await this.repository.findSongById(id);

    if (!song) throw new NotFoundException(`No song with id ${id}.`);

    const [charts, aliases, refresh] = await Promise.all([
      this.repository.findChartsBySongId(id),
      this.repository.findAliasesBySongId(id),
      this.repository.findRegionFreshness(),
    ]);

    return {
      ...this.toSongView(song),
      aliases: aliases.map((row) => row.alias),
      charts: charts.map((chart) => this.toChartView(chart, song.title)),
      availability: deriveAvailability(song, charts, refresh),
    };
  }

  async findCharts(levelQuery: string, availableOnly: boolean, limit: number) {
    const filter = parseLevelQuery(levelQuery);
    const rows = await this.repository.findCharts({
      ...filter,
      availableOnly,
      limit,
    });

    return rows.map((row) => ({
      ...this.toChartView(row, row.title),
      song: {
        id: row.song_id,
        title: row.title,
        jacketUrl: jacketUrl(row.jacket),
      },
    }));
  }

  async randomCharts(levelQuery: string, count: number) {
    const filter = parseLevelQuery(levelQuery);
    const rows = await this.repository.randomCharts({ ...filter, count });

    if (rows.length === 0) {
      throw new NotFoundException(`No available charts match "${levelQuery}".`);
    }

    return rows.map((row) => ({
      ...this.toChartView(row, row.title),
      song: {
        id: row.song_id,
        title: row.title,
        jacketUrl: jacketUrl(row.jacket),
      },
    }));
  }

  /**
   * Courses with their tracks.
   *
   * Both tables are read once and stitched in memory rather than issuing a
   * query per course, which would be a textbook N+1.
   */
  async listCourses() {
    const [courses, tracks] = await Promise.all([
      this.repository.listCourses(),
      this.repository.listCourseTracks(),
    ]);

    const byCourse = new Map<number, typeof tracks>();

    for (const track of tracks) {
      const list = byCourse.get(track.course_id) ?? [];

      list.push(track);
      byCourse.set(track.course_id, list);
    }

    return courses.map((course) => ({
      id: course.id,
      class: course.class,
      name: course.name,
      version: course.version,
      gauge: {
        life: course.life,
        recoveryLife: course.recovery_life,
        clearLife: course.clear_life,
        damageMiss: course.damage_miss,
        damageAttack: course.damage_attack,
        damageJustice: course.damage_justice,
        damageJusticeCritical: course.damage_jcrit,
      },
      tracks: (byCourse.get(course.id) ?? []).map((track) => ({
        position: track.position,
        // Random-class courses name a level and let the cabinet pick a chart.
        isRandom: track.song_id === null,
        level: track.level,
        song: track.song_id
          ? {
              id: track.song_id,
              title: track.title,
              jacketUrl: jacketUrl(track.jacket),
            }
          : null,
        difficulty: track.difficulty,
        const: track.chart_const === null ? null : Number(track.chart_const),
      })),
    }));
  }
}
