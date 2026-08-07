import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseFloatPipe,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ComboLamp } from '../../shared/chunithm-net/chunithm-net.types';
import { ToolsService } from './tools.service';

/** Pure calculators — no player data involved, so no authentication. */
@ApiTags('tools')
@Controller('tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get('calculate')
  @ApiOperation({ summary: 'Play rating and OVER POWER for a score' })
  @ApiQuery({ name: 'score', type: Number })
  @ApiQuery({ name: 'const', type: Number, description: 'Chart constant' })
  @ApiQuery({
    name: 'lamp',
    required: false,
    enum: [0, 1, 2, 3],
    description: '0 none, 1 FULL COMBO, 2 ALL JUSTICE, 3 AJC',
  })
  calculate(
    @Query('score', ParseIntPipe) score: number,
    @Query('const', ParseFloatPipe) chartConst: number,
    @Query('lamp', new DefaultValuePipe(0), ParseIntPipe) lamp: ComboLamp,
  ) {
    return this.tools.calculate(score, chartConst, lamp);
  }

  @Get('const')
  @ApiOperation({
    summary: 'Rating and OVER POWER at every notable score on a chart constant',
  })
  @ApiQuery({ name: 'const', type: Number })
  constant(@Query('const', ParseFloatPipe) chartConst: number) {
    return this.tools.constantTable(chartConst);
  }

  @Get('rating')
  @ApiOperation({ summary: 'Score needed for a target rating, per constant' })
  @ApiQuery({ name: 'rating', type: Number })
  rating(@Query('rating', ParseFloatPipe) rating: number) {
    return this.tools.scoresForRating(rating);
  }

  @Get('border')
  @ApiOperation({
    summary: 'Permissible JUSTICE / ATTACK / MISS for each rank',
    description:
      'Pass a notecount, or a songId plus difficulty to look one up. ' +
      'The splits assume a realistic mix rather than an all-justice run.',
  })
  @ApiQuery({ name: 'notecount', required: false, type: Number })
  @ApiQuery({ name: 'songId', required: false, type: Number })
  @ApiQuery({
    name: 'difficulty',
    required: false,
    enum: ['BAS', 'ADV', 'EXP', 'MAS', 'ULT', 'WE'],
  })
  border(
    @Query('notecount') notecount?: string,
    @Query('songId') songId?: string,
    @Query('difficulty') difficulty?: string,
  ) {
    return this.tools.borders({
      notecount: notecount === undefined ? undefined : Number(notecount),
      songId: songId === undefined ? undefined : Number(songId),
      difficulty: difficulty?.toUpperCase(),
    });
  }

  @Get('anmitsu')
  @ApiOperation({
    summary: 'Whether two notes are close enough to hit as one',
    description:
      'Reports the gap between notes and how long they overlap inside the ' +
      'JUSTICE CRITICAL and JUSTICE windows.',
  })
  @ApiQuery({ name: 'bpm', type: Number })
  @ApiQuery({
    name: 'density',
    required: false,
    type: Number,
    description: 'Beat divisor; 16 means 1/16 notes.',
  })
  anmitsu(
    @Query('bpm', ParseFloatPipe) bpm: number,
    @Query('density', new DefaultValuePipe(16), ParseIntPipe) density: number,
  ) {
    return this.tools.anmitsu(bpm, density);
  }
}
