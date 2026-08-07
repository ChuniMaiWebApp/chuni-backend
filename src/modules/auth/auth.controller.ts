import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import type { AppConfig } from '../../config';
import { Environment } from '../../config';
import { AuthService, type LoginStatus } from './auth.service';
import {
  CompleteLoginDto,
  LinkAccountDto,
  LoginCodeDto,
  LoginDto,
  SessionUserDto,
  UnlinkDto,
} from './dto/auth.dto';
import { CurrentUser, JwtAuthGuard } from './jwt-auth.guard';
import { LoginThrottleGuard } from './login-throttle.guard';

const SESSION_COOKIE = 'session';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * The token is set as an httpOnly cookie so page scripts cannot read it, and
   * also returned in the body for non-browser clients.
   */
  private setSessionCookie(response: Response, token: string): void {
    const isProduction =
      this.config.get('env', { infer: true }) === Environment.Production;

    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  @Post('login')
  @UseGuards(LoginThrottleGuard)
  @ApiOperation({
    summary: 'Sign in with a SEGA ID',
    description:
      'Forwards the credentials to SEGA once and keeps only the resulting session cookie. ' +
      'Accounts with two-factor authentication cannot use this route — link a CHUNITHM-NET cookie instead.',
  })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ token: string; user: SessionUserDto }> {
    const result = await this.authService.loginWithCredentials(
      body.username,
      body.password,
    );

    this.setSessionCookie(response, result.token);

    return result;
  }

  @Post('link')
  @ApiOperation({
    summary: 'Link a CHUNITHM-NET account with a clal cookie',
    description:
      'For players who already have their cookie. The bookmarklet flow calls /auth/login/complete instead.',
  })
  async link(
    @Body() body: LinkAccountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ token: string; user: SessionUserDto }> {
    const result = await this.authService.linkAccount(body.clal);

    this.setSessionCookie(response, result.token);

    return result;
  }

  @Post('login/code')
  @ApiOperation({
    summary: 'Start a bookmarklet login',
    description:
      'Returns a short code for the player to type into the bookmarklet, plus a private token to poll with.',
  })
  @ApiOkResponse({ type: LoginCodeDto })
  createLoginCode(): Promise<LoginCodeDto> {
    return this.authService.createLoginCode();
  }

  /**
   * Called by the bookmarklet from SEGA's origin.
   *
   * It is a urlencoded POST on purpose: that is a CORS "simple request", so it
   * needs no preflight and works even though this API only allows the app's
   * own origin.
   */
  @Post('login/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Submit a clal cookie against a login code' })
  async completeLogin(@Body() body: CompleteLoginDto): Promise<void> {
    await this.authService.completeLoginCode(body.code, body.clal);
  }

  @Get('login/status')
  @ApiOperation({
    summary: 'Poll a bookmarklet login',
    description:
      'Returns pending until the bookmarklet reports in. The result can only be read once.',
  })
  async loginStatus(
    @Query('pollToken') pollToken: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginStatus> {
    const status = await this.authService.getLoginStatus(pollToken);

    if (status.status === 'linked') {
      this.setSessionCookie(response, status.token);
    }

    return status;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in player' })
  @ApiOkResponse({ type: SessionUserDto })
  me(@CurrentUser('sub') userId: string): Promise<SessionUserDto> {
    return this.authService.getUser(userId);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unlink the CHUNITHM-NET account and clear the session',
  })
  async logout(
    @CurrentUser('sub') userId: string,
    @Body() body: UnlinkDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.unlink(userId, body.invalidateRemote ?? false);

    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
