import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { API_PREFIX } from '@latex-cloud/shared';
import type { AppConfig } from './config/env';

/** Shared HTTP setup for the real server and integration tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  // Text files are capped at 2 MB of UTF-8; JSON escaping can inflate that.
  app.useBodyParser('json', { limit: '6mb' });
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));
  app.enableShutdownHooks();
}
