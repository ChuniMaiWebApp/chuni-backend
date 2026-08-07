import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class RenameDto {
  @ApiProperty({
    description:
      'New in-game player name. CHUNITHM allows up to 8 characters and only ' +
      'a limited set of symbols; SEGA rejects anything else.',
    example: 'Seele',
    maxLength: 8,
  })
  @IsString()
  @Length(1, 8)
  name: string;
}
