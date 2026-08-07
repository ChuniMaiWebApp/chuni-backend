/**
 * Shape of the chuni-penguin seed dataset.
 *
 * Chart constants, notecounts and BPM come from here — CHUNITHM-NET publishes
 * none of them, and play rating and OVER POWER are undefined without them.
 *
 * The `available` flag in this dataset is deliberately NOT used to decide
 * regional availability: it disagrees with SEGA in both directions. See
 * migrations/0009_chart_regions.sql.
 */

export interface SeedChart {
  difficulty: string;
  level: string;
  const: number | null;
  maxcombo: number | null;
  tap: number | null;
  hold: number | null;
  slide: number | null;
  air: number | null;
  flick: number | null;
  charter: string | null;
  version: string | null;
  available: boolean;
  sdvxin: { id: string; end_index: string } | null;
}

export interface SeedSong {
  id: number;
  title: string;
  artist: string;
  genre: string;
  version: string;
  release: string | null;
  bpm: number | null;
  min_bpm: number | null;
  max_bpm: number | null;
  jacket: string | null;
  duration: number | null;
  available: boolean;
  removed: boolean;
  is_hidden_on_chuninet: boolean;
  aliases: string[] | null;
  charts: SeedChart[];
}

export interface SeedCourse {
  id: number;
  cls: string;
  name: string;
  version: string;
  is_duplicate_track_allowed: boolean;
  life: number | null;
  recovery_life: number | null;
  clear_life: number | null;
  damage_miss: number | null;
  damage_attack: number | null;
  damage_justice: number | null;
  damage_jcrit: number | null;
  /**
   * A track either names charts, or — in the "Random" class courses — only a
   * level, leaving the cabinet to pick a chart at play time.
   */
  tracks: Array<{
    charts?: Array<{ song_id: number; difficulty: string }>;
    level?: string;
  }>;
}
