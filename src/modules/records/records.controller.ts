import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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

import { CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RecordsService, type SortKey } from './records.service';

@ApiTags('records')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('records')
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pull every personal best from CHUNITHM-NET into the cache',
    description:
      'Five requests to SEGA, one per difficulty. Statistics and filtered ' +
      'views read from this cache, so run it after a play session.',
  })
  sync(@CurrentUser('sub') userId: string) {
    return this.records.sync(userId);
  }

  @Get('sync')
  @ApiOperation({ summary: 'When the cache was last filled' })
  syncStatus(@CurrentUser('sub') userId: string) {
    return this.records.getSyncStatus(userId);
  }

  @Get('top')
  @ApiOperation({
    summary: 'Filtered and sorted personal bests',
    description: 'Reads the local cache — run a sync first.',
  })
  @ApiQuery({
    name: 'level',
    required: false,
    description: '14+, 14.5 or 13.5-13.8',
  })
  @ApiQuery({
    name: 'difficulty',
    required: false,
    enum: ['BAS', 'ADV', 'EXP', 'MAS', 'ULT'],
  })
  @ApiQuery({ name: 'genre', required: false })
  @ApiQuery({ name: 'version', required: false })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: [
      'rating',
      'score',
      'overpower',
      'overpowerPercent',
      'comboLamp',
      'clearLamp',
      'mistakes',
    ],
  })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  top(
    @CurrentUser('sub') userId: string,
    @Query('level') level?: string,
    @Query('difficulty') difficulty?: string,
    @Query('genre') genre?: string,
    @Query('version') version?: string,
    @Query('sort') sort?: SortKey,
    @Query('order') order?: 'asc' | 'desc',
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
  ) {
    return this.records.top(userId, {
      level,
      difficulty,
      genre,
      version,
      sort,
      order,
      limit: Math.min(limit ?? 100, 500),
    });
  }

  @Get('statistics')
  @ApiOperation({
    summary: 'Folder statistics: coverage, ranks, lamps and OVER POWER',
  })
  @ApiQuery({ name: 'level', required: false })
  @ApiQuery({ name: 'difficulty', required: false })
  @ApiQuery({ name: 'genre', required: false })
  @ApiQuery({ name: 'version', required: false })
  statistics(
    @CurrentUser('sub') userId: string,
    @Query('level') level?: string,
    @Query('difficulty') difficulty?: string,
    @Query('genre') genre?: string,
    @Query('version') version?: string,
  ) {
    return this.records.statistics({
      userId,
      level,
      difficulty,
      genre,
      version,
    });
  }

  @Get('songs/:songId')
  @ApiOperation({ summary: 'Your stored scores on one song' })
  scoresForSong(
    @CurrentUser('sub') userId: string,
    @Param('songId', ParseIntPipe) songId: number,
  ) {
    return this.records.scoresForSong(userId, songId);
  }
}
