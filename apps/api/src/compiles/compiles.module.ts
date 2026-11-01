import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { BLOB_STORAGE, S3BlobStorage } from './blob-storage';
import { BullCompileQueue, COMPILE_QUEUE } from './compile-queue';
import { CompilesController } from './compiles.controller';
import { CompilesService } from './compiles.service';

@Module({
  imports: [ProjectsModule],
  controllers: [CompilesController],
  providers: [
    CompilesService,
    { provide: BLOB_STORAGE, useClass: S3BlobStorage },
    { provide: COMPILE_QUEUE, useClass: BullCompileQueue },
  ],
})
export class CompilesModule {}
