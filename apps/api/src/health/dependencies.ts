import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { AppConfig } from '../config/env';

export const REDIS = Symbol('REDIS');
export const S3 = Symbol('S3');

export function createRedis(config: AppConfig): Redis {
  const logger = new Logger('Redis');
  let lastLogged = 0;
  const client = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(times * 500, 5_000),
  });
  // Without a listener ioredis reports every reconnect failure as unhandled.
  client.on('error', (err: Error) => {
    if (Date.now() - lastLogged > 60_000) {
      lastLogged = Date.now();
      logger.warn(`redis unavailable: ${err.message}`);
    }
  });
  return client;
}

export function createS3(config: AppConfig): S3Client {
  return new S3Client({
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    maxAttempts: 1,
  });
}

export { HeadBucketCommand };
