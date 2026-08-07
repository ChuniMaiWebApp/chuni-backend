import { Injectable } from '@nestjs/common';

import {
  calculateMaxOverpowerMilli,
  calculateOverpower,
} from '../../shared/calculation/overpower';
import { calculateJudgementLoss } from '../../shared/calculation/judgements';
import { calculateRating } from '../../shared/calculation/rating';
import {
  DIFFICULTY_SHORT,
  type Score,
} from '../../shared/chunithm-net/chunithm-net.types';
import { DatabaseService } from '../../shared/database/database.service';
import { jacketUrl } from '../songs/song-links';

interface ChartRow {
  song_id: number;
  title: string;
  jacket: string | null;
  difficulty: string;
  level: string;
  const: string | null;
  max_combo: number | null;
}

// Jacket URLs built from the song database use the shared helper, which points
// at the Japanese CDN — the International one 404s for songs not released
// there yet. Jackets that CHUNITHM-NET itself returned on a score are left
// alone, since those are by definition songs the player can play.

/**
 * Fills in everything CHUNITHM-NET does not tell us.
 *
 * The site returns a score and a difficulty but never the chart constant, so
 * play rating and OVER POWER have to be computed here against the seeded song
 * database. A chart we have no data for is left with nulls rather than a wrong
 * number.
 */
@Injectable()
export class ScoreEnricherService {
  constructor(private readonly db: DatabaseService) {}

  async enrich<T extends Score>(scores: T[]): Promise<T[]> {
    if (scores.length === 0) return scores;

    const songIds = [
      ...new Set(
        scores
          .map((score) => score.song.id)
          .filter((id): id is number => id !== null),
      ),
    ];
    const titles = [
      ...new Set(
        scores
          .filter((score) => score.song.id === null)
          .map((s) => s.song.title),
      ),
    ];

    const rows = await this.db.query<ChartRow>(
      `select c.song_id, s.title, s.jacket, c.difficulty, c.level,
              c.const::text as const, c.max_combo
         from app.charts c
         join app.songs s on s.id = c.song_id
        where c.song_id = any($1::int[])
           -- WORLD'S END charts share titles, so title matching is limited to
           -- the normal song id range.
           or (s.id < 8000 and s.title = any($2::text[]))`,
      [songIds, titles],
    );

    const byId = new Map<string, ChartRow>();
    const byTitle = new Map<string, ChartRow>();

    for (const row of rows) {
      byId.set(`${row.song_id}:${row.difficulty}`, row);
      byTitle.set(`${row.title}:${row.difficulty}`, row);
    }

    return scores.map((score) => {
      const difficulty = DIFFICULTY_SHORT[score.chart.difficulty];
      const row =
        (score.song.id !== null
          ? byId.get(`${score.song.id}:${difficulty}`)
          : undefined) ?? byTitle.get(`${score.song.title}:${difficulty}`);

      if (!row) return score;

      score.song.id ??= row.song_id;
      score.chart.level = row.level;
      score.chart.maxCombo = row.max_combo;

      // The chart's notecount is what turns a judgement count into the score
      // it cost; CHUNITHM-NET reports the counts but never the arithmetic.
      if (score.judgements) {
        score.judgementLoss = calculateJudgementLoss(
          score.judgements,
          row.max_combo,
        );
      }

      if (!score.song.jacketUrl && row.jacket) {
        score.song.jacketUrl = jacketUrl(row.jacket);
      }

      // numeric comes back as a string from pg to avoid float drift.
      const internalLevel = row.const === null ? null : Number(row.const);

      if (internalLevel === null) return score;

      score.chart.internalLevel = internalLevel;
      score.rating = calculateRating(score.score, internalLevel);
      score.maxOverpower = calculateMaxOverpowerMilli(internalLevel) / 1000;

      // OVER POWER includes a combo lamp bonus of up to 1.25, so without a
      // known lamp the honest answer is "unknown" rather than a number that
      // reads as authoritative but is short by up to 1.25.
      if (score.comboLamp !== null) {
        score.overpower = calculateOverpower(
          score.score,
          internalLevel,
          score.comboLamp,
        ).value;
      }

      return score;
    });
  }
}
