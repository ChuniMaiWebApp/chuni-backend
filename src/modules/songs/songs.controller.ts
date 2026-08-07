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
    summary: 'Fuzzy search songs by title, artist or alias',
    description:
      'Tolerant of typos and romanisations — "tentai kansoku" finds 天体観測.',
  })
  @ApiQuery({ name: 'q', description: 'Search text' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'available',
    required: false,
    type: Boolean,
    description: 'Restrict to songs playable on CHUNITHM International.',
  })
  search(
    @Query('q') query: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('available', new DefaultValuePipe(false), ParseBoolPipe)
    available: boolean,
  ) {
    return this.songs.search(query, Math.min(limit, 50), available);
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
