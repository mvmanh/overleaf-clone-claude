import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import {
  LoginRequest,
  type MeResponse,
  SESSION_COOKIE_NAME,
  type SessionUser,
} from '@latex-cloud/shared';
import { ApiException } from '../common/api-exception';
import { Public } from '../common/public.decorator';
import { FixedWindowRateLimiter } from '../common/rate-limiter';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { AUTH_PROVIDER, type AuthProvider } from './auth-provider';
import { CurrentUser } from './current-user.decorator';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  private readonly emailLimiter: FixedWindowRateLimiter;
  private readonly ipLimiter: FixedWindowRateLimiter;

  constructor(
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    const window = 15 * 60_000;
    this.emailLimiter = new FixedWindowRateLimiter(config.LOGIN_RATE_LIMIT_PER_15M, window);
    // Shared NATs/offices: the per-IP budget is deliberately looser than per-account.
    this.ipLimiter = new FixedWindowRateLimiter(config.LOGIN_RATE_LIMIT_PER_15M * 10, window);
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodPipe(LoginRequest)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const ipOk = this.ipLimiter.hit(req.ip ?? 'unknown');
    const emailOk = this.emailLimiter.hit(body.email);
    if (!ipOk || !emailOk) {
      throw new ApiException(
        'RATE_LIMITED',
        'Too many sign-in attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.provider.authenticate(body);
    if (!user) {
      throw new ApiException(
        'INVALID_CREDENTIALS',
        'Email or password is incorrect.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.emailLimiter.reset(body.email);

    const { token, expiresAt } = await this.sessions.create(user.id, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });
    res.cookie(SESSION_COOKIE_NAME, token, { ...this.cookieOptions(), expires: expiresAt });
    return { user };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(
      (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME],
    );
    res.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions());
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser): MeResponse {
    return { user };
  }
}
