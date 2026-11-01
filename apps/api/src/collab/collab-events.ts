import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { COLLAB_EVENTS_CHANNEL, type CollabEvent } from '@latex-cloud/collab-protocol';
import { ensureRedisConnected, REDIS } from '../health/dependencies';

/**
 * Tells collab servers that something changed behind their back. Best-effort
 * by design: call it *after* the transaction commits; if Redis is down the
 * change is still durable and the collab server's periodic sweep catches up.
 */
@Injectable()
export class CollabEvents {
  private readonly logger = new Logger('CollabEvents');

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(event: CollabEvent): Promise<void> {
    try {
      await ensureRedisConnected(this.redis, 1_000);
      await this.redis.publish(COLLAB_EVENTS_CHANNEL, JSON.stringify(event));
    } catch (err) {
      this.logger.warn(`collab event ${event.type} not delivered: ${String(err)}`);
    }
  }
}
