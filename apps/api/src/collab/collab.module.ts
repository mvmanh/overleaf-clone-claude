import { Global, Module } from '@nestjs/common';
import { CollabEvents } from './collab-events';
import { CollabTextService } from './collab-text.service';

/** Collaboration plumbing used by files, projects and compiles. */
@Global()
@Module({
  providers: [CollabEvents, CollabTextService],
  exports: [CollabEvents, CollabTextService],
})
export class CollabModule {}
