import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'SEGA ID. Never stored — it is forwarded to SEGA and dropped.',
    example: 'player@example.com',
  })
  @IsString()
  @Length(1, 128)
  username: string;

  @ApiProperty({
    description:
      'SEGA ID password. Used for a single request to SEGA and never persisted or logged.',
    format: 'password',
  })
  @IsString()
  @Length(1, 128)
  password: string;
}

export class LinkAccountDto {
  @ApiProperty({
    description:
      'The clal cookie from CHUNITHM-NET. 64 lowercase letters and digits, with or without the "clal=" prefix.',
    example:
      'clal=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  })
  @IsString()
  @Length(64, 69)
  clal: string;
}

export class CompleteLoginDto {
  @ApiProperty({ description: 'The 6-digit code shown on the login page.' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code: string;

  @ApiProperty({ description: 'The clal cookie read by the bookmarklet.' })
  @IsString()
  @Length(64, 69)
  clal: string;
}

export class UnlinkDto {
  @ApiPropertyOptional({
    description:
      'Also sign out of CHUNITHM-NET, which invalidates the token everywhere. Leave false if the same token is linked to other tools.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  invalidateRemote?: boolean;
}

export class SessionUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: '♪Ｓｅｅｌｅ♪' })
  displayName: string;

  @ApiProperty({ nullable: true, example: '1234567890123' })
  friendCode: string | null;
}

export class LoginCodeDto {
  @ApiProperty({
    example: '481502',
    description: 'Type this into the bookmarklet.',
  })
  code: string;

  @ApiProperty({
    description: 'Opaque token this browser polls with. Keep it private.',
  })
  pollToken: string;

  @ApiProperty({ example: 300 })
  expiresInSeconds: number;
}
