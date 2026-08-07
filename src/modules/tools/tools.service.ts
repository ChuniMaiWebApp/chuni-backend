import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  calculateAnmitsu,
  calculateBorders,
  calculateScoreDeduction,
} from '../../shared/calculation/border';
import {
  calculateMaxOverpowerMilli,
  calculateOverpower,
} from '../../shared/calculation/overpower';
import {
  calculateRating,
  calculateScoreForRating,
} from '../../shared/calculation/rating';
import {
  ComboLamp,
  DIFFICULTY_SHORT,
  Difficulty,
  rankFromScore,
  rankLabel,
} from '../../shared/chunithm-net/chunithm-net.types';
import { DatabaseService } from '../../shared/database/database.service';

/** Score thresholds worth quoting when exploring a chart constant. */
const NOTABLE_SCORES: Array<{ label: string; score: number }> = [
  { label: 'MAX', score: 1_010_000 },
  { label: '99AJ', score: 1_009_900 },
  { label: 'SSS+', score: 1_009_000 },
  { label: 'SSS', score: 1_007_500 },
  { label: 'SS+', score: 1_005_000 },
  { label: 'SS', score: 1_000_000 },
  { label: 'S+', score: 990_000 },
  { label: 'S', score: 975_000 },
  { label: 'AAA', score: 950_000 },
];

/** Chart constants a player is realistically choosing between. */
const CONST_RANGE = { min: 1, max: 16.5 };

@Injectable()
export class ToolsService {
  constructor(private readonly db: DatabaseService) {}

  private static assertConst(value: number): void {
    if (
      Number.isNaN(value) ||
      value < CONST_RANGE.min ||
      value > CONST_RANGE.max
    ) {
      throw new BadRequestException(
        `Chart constant must be between ${CONST_RANGE.min} and ${CONST_RANGE.max}.`,
      );
    }
  }

  private static assertScore(value: number): void {
    if (Number.isNaN(value) || value < 0 || value > 1_010_000) {
      throw new BadRequestException('Score must be between 0 and 1010000.');
    }
  }

  /** Play rating and OVER POWER for one score on one chart. */
  calculate(score: number, chartConst: number, comboLamp: ComboLamp) {
    ToolsService.assertScore(score);
    ToolsService.assertConst(chartConst);

    const overpower = calculateOverpower(score, chartConst, comboLamp);
    const rank = rankFromScore(score);

    return {
      score,
      chartConst,
      rank,
      rankName: rankLabel(rank),
      rating: calculateRating(score, chartConst),
      overpower,
      // What the same score would be worth with a better lamp, so a player can
      // see whether chasing the lamp beats chasing points.
      lampUpgrades: [
        ComboLamp.FULL_COMBO,
        ComboLamp.ALL_JUSTICE,
        ComboLamp.ALL_JUSTICE_CRITICAL,
      ]
        .filter((lamp) => lamp > comboLamp)
        .map((lamp) => ({
          comboLamp: lamp,
          overpower: calculateOverpower(score, chartConst, lamp),
        })),
    };
  }

  /** The rating and OP earned at each notable score on a given constant. */
  constantTable(chartConst: number) {
    ToolsService.assertConst(chartConst);

    return {
      chartConst,
      maxOverpower: calculateMaxOverpowerMilli(chartConst) / 1000,
      rows: NOTABLE_SCORES.map(({ label, score }) => ({
        label,
        score,
        rating: calculateRating(score, chartConst),
        overpower: calculateOverpower(score, chartConst, ComboLamp.NONE).value,
        overpowerAllJustice: calculateOverpower(
          score,
          chartConst,
          ComboLamp.ALL_JUSTICE,
        ).value,
      })),
    };
  }

  /**
   * Scores needed to reach a target play rating, per chart constant.
   *
   * Constants where the target is unreachable are omitted rather than listed
   * with a null, since an unreachable row is noise when picking a chart.
   */
  scoresForRating(targetRating: number) {
    if (Number.isNaN(targetRating) || targetRating <= 0 || targetRating > 20) {
      throw new BadRequestException('Rating must be between 0 and 20.');
    }

    const rows: Array<{ chartConst: number; score: number; rank: string }> = [];

    for (
      let value = CONST_RANGE.max * 10;
      value >= CONST_RANGE.min * 10;
      value -= 1
    ) {
      const chartConst = value / 10;
      const score = calculateScoreForRating(targetRating, chartConst);

      if (score === null || score > 1_010_000) continue;

      rows.push({
        chartConst,
        score,
        rank: rankLabel(rankFromScore(score)),
      });
    }

    return { targetRating, rows };
  }

  /**
   * Judgement borders for a chart.
   *
   * Takes a notecount directly, or a chart to look one up from — the Discord
   * bot accepts both and the notecount is rarely something a player knows.
   */
  async borders(input: {
    notecount?: number;
    songId?: number;
    difficulty?: string;
  }) {
    let notecount = input.notecount;
    let chart: { title: string; difficulty: string; level: string } | null =
      null;

    if (notecount === undefined) {
      if (input.songId === undefined || input.difficulty === undefined) {
        throw new BadRequestException(
          'Provide either a notecount, or a songId and difficulty.',
        );
      }

      const row = await this.db.queryOne<{
        max_combo: number | null;
        title: string;
        difficulty: string;
        level: string;
      }>(
        `select c.max_combo, c.difficulty, c.level, s.title
           from app.charts c
           join app.songs s on s.id = c.song_id
          where c.song_id = $1 and c.difficulty = $2`,
        [input.songId, input.difficulty],
      );

      if (!row) {
        throw new NotFoundException('No such chart.');
      }

      if (row.max_combo === null) {
        throw new NotFoundException(
          `Notecount is unknown for ${row.title} [${row.difficulty}].`,
        );
      }

      notecount = row.max_combo;
      chart = {
        title: row.title,
        difficulty: row.difficulty,
        level: row.level,
      };
    }

    if (notecount <= 0) {
      throw new BadRequestException('Notecount must be positive.');
    }

    return {
      notecount,
      chart,
      deduction: calculateScoreDeduction(notecount),
      borders: calculateBorders(notecount).map((border) => ({
        ...border,
        label: border.key === '99AJ' ? '99AJ' : rankLabel(border.key),
      })),
    };
  }

  anmitsu(bpm: number, noteDensity: number) {
    if (Number.isNaN(bpm) || bpm <= 0 || bpm > 100_000) {
      throw new BadRequestException('BPM must be between 1 and 100000.');
    }

    if (
      Number.isNaN(noteDensity) ||
      noteDensity < 1 ||
      noteDensity > 1024 ||
      !Number.isInteger(noteDensity)
    ) {
      throw new BadRequestException(
        'Note density must be a whole number between 1 and 1024.',
      );
    }

    return { bpm, noteDensity, ...calculateAnmitsu(bpm, noteDensity) };
  }

  /** Difficulty names accepted by the border lookup. */
  static readonly DIFFICULTIES = Object.values(DIFFICULTY_SHORT);

  static toDifficulty(short: string): Difficulty {
    const entry = Object.entries(DIFFICULTY_SHORT).find(
      ([, value]) => value === short.toUpperCase(),
    );

    if (!entry) {
      throw new BadRequestException(
        `Unknown difficulty "${short}". Expected one of ${ToolsService.DIFFICULTIES.join(', ')}.`,
      );
    }

    return Number(entry[0]);
  }
}
