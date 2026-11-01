import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '@latex-cloud/shared';
import { unauthenticated } from '../common/api-exception';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionUser => {
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user) throw unauthenticated();
    return user;
  },
);
