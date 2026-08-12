import { Difficulty } from '../../shared/chunithm-net/chunithm-net.types';
import type { AuthService } from '../auth/auth.service';
import type { SongsService } from '../songs/songs.service';
import { ChunithmService } from './chunithm.service';
import type { PlayDetailsRepository } from './play-details.repository';
import type { ScoreEnricherService } from './score-enricher.service';

/**
 * The two ways a personal best can carry judgements, and the one way it
 * cannot.
 *
 * CHUNITHM-NET serves judgements for the last 50 tracks only, so this is the
 * branch that decides whether a months-old Best 50 entry shows a breakdown or
 * honestly says it has none. It cannot be exercised by hand: everything this
 * app has captured is, by definition, still in the playlog window today.
 */

const CHART = {
  difficulty: Difficulty.MASTER,
  difficultyName: 'MAS',
  level: '15+',
  const: 15.6,
  maxCombo: 2999,
  notes: { tap: 1, hold: 1, slide: 1, air: 1, flick: 1 },
  charter: null,
  version: null,
  available: true,
  availableIntl: true,
  availableJp: true,
  sdvxinUrl: null,
  youtubeUrl: 'https://example.test',
};

const play = (score: number) => ({
  song: { id: 42, title: 'Test Song', jacketUrl: null },
  chart: {
    difficulty: Difficulty.MASTER,
    level: '15+',
    internalLevel: 15.6,
    maxCombo: 2999,
  },
  score,
  rank: 9,
  clearLamp: 1,
  comboLamp: 0,
  chainLamp: 0,
  maxCombo: 400,
  judgements: { justiceCritical: 2565, justice: 338, attack: 52, miss: 44 },
  notePercentage: null,
  achievedAt: null,
  rating: null,
  overpower: null,
  maxOverpower: null,
  judgementLoss: null,
  trackNo: 1,
  isNewRecord: false,
  character: null,
  skill: null,
  skillResult: null,
  playlogIndex: 7,
});

const build = (options: {
  playlog?: ReturnType<typeof play>[];
  capturedRow?: Record<string, unknown> | null;
}) => {
  const playlog = options.playlog ?? [];

  const save = jest.fn(() => Promise.resolve(true));
  const findBestForChart = jest.fn(() =>
    Promise.resolve(options.capturedRow ?? null),
  );

  const service = new ChunithmService(
    {
      withChunithmSession: (
        _userId: string,
        fn: (session: unknown) => unknown,
      ) =>
        fn({
          getRecentScores: () => Promise.resolve(playlog),
          getRecentScoreDetail: () => Promise.resolve(playlog[0]),
        }),
    } as unknown as AuthService,
    {
      enrich: (scores: unknown[]) => Promise.resolve(scores),
    } as unknown as ScoreEnricherService,
    {
      findById: () =>
        Promise.resolve({
          id: 42,
          title: 'Test Song',
          artist: 'A',
          genre: 'G',
          version: 'V',
          jacketUrl: null,
          charts: [CHART],
        }),
    } as unknown as SongsService,
    { save, findBestForChart } as unknown as PlayDetailsRepository,
  );

  return { service, save, findBestForChart };
};

describe('getChartRecord', () => {
  it('uses the live playlog when the chart is still in the window', async () => {
    const { service, save, findBestForChart } = build({
      playlog: [play(985211)],
    });

    const record = await service.getChartRecord('user', 42, Difficulty.MASTER);

    expect(record.play?.score).toBe(985211);
    expect(record.captured).toBeNull();
    // The live detail is written down on the way past, which is the whole
    // reason a later lookup can succeed at all.
    expect(save).toHaveBeenCalledTimes(1);
    expect(findBestForChart).not.toHaveBeenCalled();
  });

  it('falls back to a capture once the playlog has rolled past the run', async () => {
    const { service } = build({
      playlog: [],
      capturedRow: {
        score: 985211,
        max_combo: 437,
        justice_critical: 2565,
        justice: 338,
        attack: 52,
        miss: 44,
        pct_tap: '97.17',
        pct_hold: '100.41',
        pct_slide: '100.78',
        pct_air: '100.99',
        pct_flick: '95.86',
        achieved_at: new Date('2026-08-04T12:26:00Z'),
        captured_at: new Date('2026-08-07T18:00:00Z'),
      },
    });

    const record = await service.getChartRecord('user', 42, Difficulty.MASTER);

    expect(record.play).toBeNull();
    expect(record.captured?.score).toBe(985211);
    expect(record.captured?.judgements.miss).toBe(44);
    // Percentages come back from pg as strings; sending those to the client
    // would break every numeric comparison downstream.
    expect(record.captured?.notePercentage.tap).toBe(97.17);
    // The loss is recomputed against the chart's notecount, so a rebalance
    // does not leave a stale figure stored next to the judgement counts.
    expect(record.captured?.judgementLoss).toEqual({
      justice: 1127.04,
      attack: 8842.94,
      miss: 14818.27,
      total: 24788.25,
    });
  });

  it('reports no breakdown at all when the run was never captured', async () => {
    const { service } = build({ playlog: [], capturedRow: null });

    const record = await service.getChartRecord('user', 42, Difficulty.MASTER);

    expect(record.play).toBeNull();
    expect(record.captured).toBeNull();
  });

  it('ignores plays on other difficulties of the same song', async () => {
    const other = {
      ...play(999999),
      chart: { ...play(0).chart, difficulty: Difficulty.EXPERT },
    };
    const { service } = build({ playlog: [other] });

    const record = await service.getChartRecord('user', 42, Difficulty.MASTER);

    expect(record.play).toBeNull();
  });
});
