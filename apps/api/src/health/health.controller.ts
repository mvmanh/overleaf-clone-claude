import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { LivenessResponse, ReadinessResponse } from '@latex-cloud/shared';
import { Public } from '../common/public.decorator';
import { HealthService } from './health.service';

const startedAt = Date.now();

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is up. No dependency checks (avoid restart storms). */
  @Public()
  @Get()
  live(): LivenessResponse {
    return {
      status: 'ok',
      service: 'api',
      version: process.env.APP_VERSION ?? '0.1.0',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
  }

  /** Readiness: dependencies reachable and schema migrated. 503 when degraded. */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    res.status(result.status === 'ready' ? 200 : 503);
    return result;
  }
}
