import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SESSION_COOKIE_NAME } from '@latex-cloud/shared';
import { unauthenticated } from '../common/api-exception';
import { IS_PUBLIC } from '../common/public.decorator';
import { SessionService } from './session.service';

/** Global guard: every route requires a valid session unless marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
    const user = await this.sessions.resolve(token);
    if (!user) throw unauthenticated();
    req.user = user;
    return true;
  }
}
