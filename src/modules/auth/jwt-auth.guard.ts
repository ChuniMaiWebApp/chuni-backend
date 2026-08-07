import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface JwtPayload {
  sub: string;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/**
 * Accepts a session token from either an `Authorization: Bearer` header or the
 * `session` cookie, so the SPA can use the httpOnly cookie while scripts and
 * the API docs can use a header.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  private static extractToken(request: AuthenticatedRequest): string | null {
    const header = request.headers.authorization;

    if (header?.startsWith('Bearer ')) return header.slice(7);

    const cookie = request.headers.cookie;

    if (!cookie) return null;

    const match = cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('session='));

    return match ? decodeURIComponent(match.slice('session='.length)) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = JwtAuthGuard.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('You are not signed in.');
    }

    try {
      request.user = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException(
        'Your session expired. Please sign in again.',
      );
    }

    return true;
  }
}

/** Injects the authenticated player, or one of its fields. */
export const CurrentUser = createParamDecorator(
  (field: keyof JwtPayload | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) return undefined;

    return field ? user[field] : user;
  },
);
