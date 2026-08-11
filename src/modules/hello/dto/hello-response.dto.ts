import { ApiProperty } from '@nestjs/swagger';

export class HelloResponseDto {
  @ApiProperty({ example: 'Hello World from ChunithmWebApp API 🐧' })
  message: string;

  @ApiProperty({ example: 'development' })
  environment: string;

  @ApiProperty({ example: '2026-08-06T12:34:56.789Z' })
  timestamp: string;
}
