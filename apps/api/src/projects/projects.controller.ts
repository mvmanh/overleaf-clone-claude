import { Controller, Get, Param } from '@nestjs/common';
import type { ProjectListResponse, ProjectSummary, SessionUser } from '@latex-cloud/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProjectAccessService } from './project-access.service';
import { ProjectsService } from './projects.service';

/** Read-only in PR 1; create/update/delete and membership management land in PR 2. */
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser): Promise<ProjectListResponse> {
    return { projects: await this.projects.listForUser(user.id) };
  }

  @Get(':projectId')
  async get(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectSummary> {
    await this.access.requireRole(user.id, projectId, 'viewer');
    return this.projects.getForUser(user.id, projectId);
  }
}
