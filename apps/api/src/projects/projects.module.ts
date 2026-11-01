import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { ProjectAccessService } from './project-access.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController, FilesController],
  providers: [ProjectsService, ProjectAccessService, FilesService],
  exports: [ProjectAccessService],
})
export class ProjectsModule {}
