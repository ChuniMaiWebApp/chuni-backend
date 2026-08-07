import { ApiProperty } from '@nestjs/swagger';

export type DependencyStatus = 'up' | 'down';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'], example: 'ok' })
  status: 'ok' | 'degraded';

  @ApiProperty({ example: 12.34, description: 'Process uptime in seconds' })
  uptime: number;

  @ApiProperty({ example: '2026-08-06T12:34:56.789Z' })
  timestamp: string;

  @ApiProperty({
    example: { redis: 'up', supabase: 'up' },
    description: 'Reachability of each external dependency',
  })
  dependencies: Record<string, DependencyStatus>;
}
