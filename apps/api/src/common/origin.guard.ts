import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { forbidden } from './api-exception';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests: state-changing methods must
 * come from an allowed web origin. Complements SameSite=Lax cookies.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.allowed = new Set(config.WEB_ORIGIN.map((o) => new URL(o).origin));
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    const origin = req.header('origin') ?? originOf(req.header('referer'));
    if (origin && this.allowed.has(origin)) return true;
    throw forbidden('Cross-origin request rejected.');
  }
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
