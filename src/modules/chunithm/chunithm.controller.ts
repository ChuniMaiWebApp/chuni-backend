import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  Get,
  Param,
  ParseFloatPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type {
  Difficulty,
  Profile,
  RatingBreakdown,
  RecentScore,
} from '../../shared/chunithm-net/chunithm-net.types';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChunithmService } from './chunithm.service';
import { RenameDto } from './dto/rename.dto';

@ApiTags('chunithm')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chunithm')
export class ChunithmController {
  constructor(private readonly chunithm: ChunithmService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Player card, rating, OVER POWER and play count' })
  getProfile(@CurrentUser('sub') userId: string): Promise<Profile> {
    return this.chunithm.getProfile(userId);
  }

  @Get('records/recent')
  @ApiOperation({
    summary: 'The 50 most recent plays',
    description:
      'Without judgements — those cost a request each, so they live on ' +
      '`/records/recent/{index}`.',
  })
  getRecent(@CurrentUser('sub') userId: string): Promise<RecentScore[]> {
    return this.chunithm.getRecentScores(userId);
  }

  @Get('records/recent/:index')
  @ApiOperation({
    summary: 'One recent play, with judgements and note accuracy',
    description:
      'Position in the playlog, 0 being the newest. The position shifts as ' +
      'soon as another track is played, so compare the song in the response ' +
      'against what you expected before trusting a saved link.',
  })
  getRecentPlay(
    @CurrentUser('sub') userId: string,
    @Param('index', ParseIntPipe) index: number,
  ): Promise<RecentScore> {
    return this.chunithm.getRecentPlay(userId, index);
  }

  @Post('records/capture')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Store the judgement breakdown of your recent plays',
    description:
      'CHUNITHM-NET serves judgements for the last 50 tracks only, so a ' +
      'personal best loses its breakdown once fifty more credits push it out. ' +
      'This walks the window and keeps what is there. Plays already captured ' +
      'at the same score are skipped, so running it after a session is cheap.',
  })
  captureRecent(@CurrentUser('sub') userId: string) {
    return this.chunithm.captureRecentDetails(userId);
  }

  @Get('records/chart/:songId/:difficulty')
  @ApiOperation({
    summary: 'Your record on one chart, with judgements where they exist',
    description:
      'CHUNITHM-NET publishes judgements only on the playlog, so this scans ' +
      'the last 50 tracks for a play on the chart. A record set longer ago ' +
      'comes back without them rather than with invented ones.',
  })
  getChartRecord(
    @CurrentUser('sub') userId: string,
    @Param('songId', ParseIntPipe) songId: number,
    @Param('difficulty', ParseIntPipe) difficulty: Difficulty,
  ) {
    return this.chunithm.getChartRecord(userId, songId, difficulty);
  }

  @Get('records/best50')
  @ApiOperation({
    summary: 'Rating breakdown: best 30 old scores plus new 20',
  })
  getBest50(@CurrentUser('sub') userId: string): Promise<RatingBreakdown> {
    return this.chunithm.getRatingBreakdown(userId);
  }

  @Get('login-bonus')
  @ApiOperation({
    summary: 'Login bonus progress: monthly, streak and weekday',
  })
  getLoginBonus(@CurrentUser('sub') userId: string) {
    return this.chunithm.getLoginBonus(userId);
  }

  @Get('linked-verse')
  @ApiOperation({ summary: 'Linked VERSE gate progress' })
  getLinkedVerse(@CurrentUser('sub') userId: string) {
    return this.chunithm.getLinkedVerse(userId);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: "A chart's leaderboard on CHUNITHM International" })
  @ApiQuery({ name: 'songId', type: Number })
  @ApiQuery({ name: 'difficulty', enum: [0, 1, 2, 3, 4, 5] })
  getLeaderboard(
    @CurrentUser('sub') userId: string,
    @Query('songId', ParseIntPipe) songId: number,
    @Query('difficulty', ParseIntPipe) difficulty: Difficulty,
  ) {
    return this.chunithm.getChartLeaderboard(userId, songId, difficulty);
  }

  @Get('what-if')
  @ApiOperation({
    summary: 'What a hypothetical play would do to your rating',
    description:
      'Pass `replacing` with the play rating you already hold on that chart — ' +
      'without it the gain is overstated, because a chart cannot occupy two ' +
      'rating slots.',
  })
  @ApiQuery({ name: 'playRating', type: Number })
  @ApiQuery({ name: 'replacing', required: false, type: Number })
  whatIf(
    @CurrentUser('sub') userId: string,
    @Query('playRating', ParseFloatPipe) playRating: number,
    @Query('replacing') replacing?: string,
  ) {
    return this.chunithm.whatIf(
      userId,
      playRating,
      replacing === undefined ? undefined : Number(replacing),
    );
  }

  @Get('ranking/rating')
  @ApiOperation({ summary: 'Site-wide rating ranking' })
  @ApiQuery({ name: 'scope', required: false, enum: ['global', 'friend'] })
  getRatingRanking(
    @CurrentUser('sub') userId: string,
    @Query('scope') scope: 'global' | 'friend' = 'global',
  ) {
    return this.chunithm.getRatingRanking(userId, scope);
  }

  @Get('ranking/score')
  @ApiOperation({ summary: 'Site-wide total high score ranking' })
  getScoreRanking(@CurrentUser('sub') userId: string) {
    return this.chunithm.getScoreRanking(userId);
  }

  @Get('ranking/currency')
  @ApiOperation({ summary: 'Site-wide total currency ranking' })
  getCurrencyRanking(@CurrentUser('sub') userId: string) {
    return this.chunithm.getCurrencyRanking(userId);
  }

  @Get('improve/reach')
  @ApiOperation({
    summary: 'What play rating every counted slot needs for a target rating',
  })
  @ApiQuery({ name: 'target', type: Number })
  reach(
    @CurrentUser('sub') userId: string,
    @Query('target', ParseFloatPipe) target: number,
  ) {
    return this.chunithm.reach(userId, target);
  }

  @Get('improve/recommend')
  @ApiOperation({
    summary: 'Charts worth attempting next, with the score each one needs',
    description:
      'Picked around your rating floor — charts below it cannot raise your ' +
      'rating however well they are played.',
  })
  @ApiQuery({ name: 'count', required: false, type: Number })
  recommend(
    @CurrentUser('sub') userId: string,
    @Query('count', new DefaultValuePipe(3), ParseIntPipe) count: number,
  ) {
    return this.chunithm.recommend(userId, Math.min(Math.max(count, 1), 10));
  }

  @Patch('profile/name')
  @ApiOperation({
    summary: 'Change your in-game player name',
    description: 'Writes to your CHUNITHM account. Maximum 8 characters.',
  })
  rename(@CurrentUser('sub') userId: string, @Body() body: RenameDto) {
    return this.chunithm.rename(userId, body.name);
  }
}
