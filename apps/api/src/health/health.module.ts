import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { createRedis, createS3, REDIS, S3 } from './dependencies';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    { provide: REDIS, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createRedis(c) },
    { provide: S3, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createS3(c) },
  ],
})
export class HealthModule {}
