import { Module } from '@nestjs/common';
import { CollabController } from '../collab/collab.controller';
import { HistoryController } from '../history/history.controller';
import { HistoryService } from '../history/history.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { ProjectAccessService } from './project-access.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController, FilesController, CollabController, HistoryController],
  providers: [ProjectsService, ProjectAccessService, FilesService, HistoryService],
  exports: [ProjectAccessService],
})
export class ProjectsModule {}
