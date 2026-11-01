import type { S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { createRedis, createS3, REDIS, S3 } from '../health/dependencies';

/** Process-wide clients for Redis and object storage, shared by every module. */
@Global()
@Module({
  providers: [
    { provide: REDIS, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createRedis(c) },
    { provide: S3, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createS3(c) },
  ],
  exports: [REDIS, S3],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  onApplicationShutdown(): void {
    this.redis.disconnect();
    this.s3.destroy();
  }
}
