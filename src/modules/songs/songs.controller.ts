import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { SongsService } from './songs.service';

/**
 * Song data is public: none of it depends on who is asking, and keeping it
 * unauthenticated means the search box works before a player links an account.
 */
@ApiTags('songs')
@Controller()
export class SongsController {
  constructor(private readonly songs: SongsService) {}

  @Get('songs/search')
  @ApiOperation({
    summary:
      'Search and filter songs by title, artist, genre, version, difficulty, constant, bpm, and region',
  })
  search(
    @Query('q') query?: string,
    @Query('genre') genre?: string,
    @Query('version') version?: string,
    @Query('difficulty') difficulty?: string,
    @Query('region') region?: 'all' | 'intl' | 'jp',
    @Query('minConst') minConst?: string,
    @Query('maxConst') maxConst?: string,
    @Query('minBpm') minBpm?: string,
    @Query('maxBpm') maxBpm?: string,
    @Query('charter') charter?: string,
    @Query('hideRemoved') hideRemoved?: string,
    @Query('sortBy') sortBy?: 'default' | 'title' | 'const' | 'release' | 'bpm',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit?: number,
    @Query('available') available?: string,
  ) {
    const parseNum = (val?: string) =>
      val !== undefined && val !== '' && !isNaN(Number(val))
        ? Number(val)
        : undefined;

    const resolvedRegion = region || (available === 'true' ? 'intl' : 'all');

    return this.songs.searchWithOptions({
      query: query || '',
      genre,
      version,
      difficulty,
      region: resolvedRegion,
      minConst: parseNum(minConst),
      maxConst: parseNum(maxConst),
      minBpm: parseNum(minBpm),
      maxBpm: parseNum(maxBpm),
      charter,
      hideRemoved: hideRemoved === 'true',
      sortBy,
      sortOrder,
      page: Math.max(page || 1, 1),
      limit: Math.min(Math.max(limit || 30, 1), 500),
    });
  }

  @Get('songs/random')
  @ApiOperation({ summary: 'Pick random charts from a level or constant band' })
  @ApiQuery({ name: 'level', description: '14+, 14.5, or 13.5-13.8' })
  @ApiQuery({ name: 'count', required: false, type: Number })
  random(
    @Query('level') level: string,
    @Query('count', new DefaultValuePipe(3), ParseIntPipe) count: number,
  ) {
    return this.songs.randomCharts(level, Math.min(Math.max(count, 1), 10));
  }

  @Get('charts')
  @ApiOperation({ summary: 'List charts in a level or chart constant band' })
  @ApiQuery({ name: 'level', description: '14+, 14.5, or 13.5-13.8' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'available', required: false, type: Boolean })
  charts(
    @Query('level') level: string,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
    @Query('available', new DefaultValuePipe(true), ParseBoolPipe)
    available: boolean,
  ) {
    return this.songs.findCharts(level, available, Math.min(limit, 500));
  }

  @Get('courses')
  @ApiOperation({ summary: 'All courses with their track lists' })
  courses() {
    return this.songs.listCourses();
  }

  // Declared last so `/songs/search` and `/songs/random` are not swallowed by
  // the `:id` parameter.
  @Get('songs/:id')
  @ApiOperation({ summary: 'One song with every chart, alias and chart link' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.songs.findById(id);
  }
}
