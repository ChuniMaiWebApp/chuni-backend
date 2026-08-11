/**
 * Domain model for data scraped from CHUNITHM-NET International.
 *
 * Enum numeric values are meaningful: they are ordered so that a higher value
 * is a strictly better result, which lets us merge personal bests with a plain
 * `MAX()` when persisting.
 */

export enum Difficulty {
  BASIC = 0,
  ADVANCED = 1,
  EXPERT = 2,
  MASTER = 3,
  ULTIMA = 4,
  WORLDS_END = 5,
}

export const DIFFICULTY_SHORT: Record<Difficulty, string> = {
  [Difficulty.BASIC]: 'BAS',
  [Difficulty.ADVANCED]: 'ADV',
  [Difficulty.EXPERT]: 'EXP',
  [Difficulty.MASTER]: 'MAS',
  [Difficulty.ULTIMA]: 'ULT',
  [Difficulty.WORLDS_END]: 'WE',
};

export enum Rank {
  D = 0,
  C = 1,
  B = 2,
  BB = 3,
  BBB = 4,
  A = 5,
  AA = 6,
  AAA = 7,
  S = 8,
  SP = 9,
  SS = 10,
  SSP = 11,
  SSS = 12,
  SSSP = 13,
}

/** Minimum score required for each rank, indexed by `Rank`. */
const RANK_THRESHOLDS: ReadonlyArray<readonly [Rank, number]> = [
  [Rank.SSSP, 1_009_000],
  [Rank.SSS, 1_007_500],
  [Rank.SSP, 1_005_000],
  [Rank.SS, 1_000_000],
  [Rank.SP, 990_000],
  [Rank.S, 975_000],
  [Rank.AAA, 950_000],
  [Rank.AA, 925_000],
  [Rank.A, 900_000],
  [Rank.BBB, 800_000],
  [Rank.BB, 700_000],
  [Rank.B, 600_000],
  [Rank.C, 500_000],
];

export function rankFromScore(score: number): Rank {
  for (const [rank, threshold] of RANK_THRESHOLDS) {
    if (score >= threshold) return rank;
  }

  return Rank.D;
}

export function rankLabel(rank: Rank): string {
  return Rank[rank].replace('P', '+');
}

/**
 * Gaps in the numbering are intentional — they mirror the values CHUNITHM-NET
 * uses, and leave room for lamps introduced between CLEAR and HARD.
 */
export enum ClearLamp {
  FAILED = 0,
  CLEAR = 1,
  HARD = 4,
  BRAVE = 5,
  ABSOLUTE = 6,
  CATASTROPHY = 7,
}

export const CLEAR_LAMP_SHORT: Record<ClearLamp, string> = {
  [ClearLamp.FAILED]: 'FAILED',
  [ClearLamp.CLEAR]: 'CLR',
  [ClearLamp.HARD]: 'HRD',
  [ClearLamp.BRAVE]: 'BRV',
  [ClearLamp.ABSOLUTE]: 'ABS',
  [ClearLamp.CATASTROPHY]: 'CTS',
};

export enum ComboLamp {
  NONE = 0,
  FULL_COMBO = 1,
  ALL_JUSTICE = 2,
  ALL_JUSTICE_CRITICAL = 3,
}

export const COMBO_LAMP_SHORT: Record<ComboLamp, string> = {
  [ComboLamp.NONE]: 'NONE',
  [ComboLamp.FULL_COMBO]: 'FC',
  [ComboLamp.ALL_JUSTICE]: 'AJ',
  [ComboLamp.ALL_JUSTICE_CRITICAL]: 'AJC',
};

/**
 * FULL CHAIN was added to the game after FULL CHAIN+, so the "better" lamp has
 * the lower value. Kept identical to CHUNITHM-NET rather than reordered, so the
 * numbers stay comparable with other tools.
 */
export enum ChainLamp {
  NONE = 0,
  FULL_CHAIN_PLUS = 1,
  FULL_CHAIN = 2,
}

export enum SkillClass {
  I = 1,
  II = 2,
  III = 3,
  IV = 4,
  V = 5,
  INFINITE = 6,
}

export enum Possession {
  NONE = 'normal',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platina',
  RAINBOW = 'rainbow',
}

export interface Title {
  /** Empty for collaboration titles, whose wording exists only in `imageUrl`. */
  content: string;

  /**
   * Plate to draw `content` on, from the background filename. `special` for a
   * collaboration title, which comes as finished artwork instead of a plate.
   */
  rarity: string;

  /**
   * The finished image, for titles the game draws rather than composes.
   * Null for ordinary titles, which are a plate plus text.
   */
  imageUrl: string | null;
}

export interface Team {
  name: string;
  emblem: string;
}

export interface OverPower {
  value: number;
  percentage: number;
}

export interface Profile {
  username: string;
  level: number | null;
  reincarnationStars: number;
  rating: number;
  overPower: OverPower | null;
  titles: Title[];
  team: Team | null;
  possession: Possession;
  medal: SkillClass | null;
  emblem: SkillClass | null;
  profilePicture: string | null;
  profilePictureFrame: string | null;
  banner: string | null;
  friendCode: string | null;
  currency: { owned: number; total: number } | null;
  totalCredits: number | null;
  lastPlayed: string | null;
}

export interface Judgements {
  justiceCritical: number;
  justice: number;
  attack: number;
  miss: number;
}

export interface NotePercentage {
  tap: number;
  hold: number;
  slide: number;
  air: number;
  flick: number;
}

export interface SongRef {
  /** CHUNITHM-NET internal song id. `null` when only the title is known. */
  id: number | null;
  title: string;
  jacketUrl: string | null;
}

export interface ChartRef {
  difficulty: Difficulty;
  level: string | null;
  internalLevel: number | null;
  maxCombo: number | null;
}

export interface Score {
  song: SongRef;
  chart: ChartRef;
  score: number;
  rank: Rank;

  /**
   * Lamps are `null` when the source page carries no badge information at all
   * — the rating detail pages list only title, difficulty and score.
   *
   * `null` means "unknown", which is different from `FAILED`/`NONE`: inside a
   * badge block, a missing clear icon really does mean the play failed.
   */
  clearLamp: ClearLamp | null;
  comboLamp: ComboLamp | null;
  chainLamp: ChainLamp | null;
  maxCombo: number | null;
  judgements: Judgements | null;
  notePercentage: NotePercentage | null;
  achievedAt: string | null;
  /** Filled in by the enrichment step once the chart constant is known. */
  rating: number | null;
  overpower: number | null;
  maxOverpower: number | null;
  /**
   * Score lost to each imperfect judgement, once the notecount is known.
   *
   * Null when there are no judgements to break down, or when the chart is
   * missing from the song database so the per-note value is unknown.
   */
  judgementLoss: JudgementLoss | null;
}

/** Score lost to each imperfect judgement. See shared/calculation/judgements. */
export interface JudgementLoss {
  justice: number;
  attack: number;
  miss: number;
  total: number;
}

export interface RecentScore extends Score {
  trackNo: number | null;
  isNewRecord: boolean;
  character: string | null;
  skill: { name: string; grade: number | null } | null;
  skillResult: number | null;
  /**
   * Playlog index used by `POST /mobile/record/playlog/sendPlaylogDetail/`.
   * Only valid for the current playlog page — it shifts as new plays come in.
   */
  playlogIndex: number | null;
}

export interface PersonalBest extends Score {
  playCount: number | null;
  ajcCount: number | null;
}

export interface RatingBreakdown {
  /** Rating as reported by the game itself, not recomputed. */
  rating: number;
  best: { slots: number; scores: PersonalBest[] };
  new: { slots: number; scores: PersonalBest[] };
}
