import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateProjectRequest,
  InviteMemberRequest,
  type ProjectListResponse,
  type ProjectMembersResponse,
  type ProjectSummary,
  type SessionUser,
  TransferOwnershipRequest,
  UpdateMemberRequest,
  UpdateProjectRequest,
} from '@latex-cloud/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectAccessService } from './project-access.service';
import { ProjectsService } from './projects.service';

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

  @Post()
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(CreateProjectRequest)) body: CreateProjectRequest,
  ): Promise<ProjectSummary> {
    return this.projects.create(user.id, body);
  }

  @Get(':projectId')
  async get(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectSummary> {
    await this.access.requireAction(user.id, projectId, 'project:read');
    return this.projects.getForUser(user.id, projectId);
  }

  @Patch(':projectId')
  update(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(UpdateProjectRequest)) body: UpdateProjectRequest,
  ): Promise<ProjectSummary> {
    return this.projects.update(user.id, projectId, body);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: SessionUser, @Param('projectId') projectId: string): Promise<void> {
    return this.projects.softDelete(user.id, projectId);
  }

  @Post(':projectId/transfer-ownership')
  @HttpCode(HttpStatus.OK)
  transfer(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(TransferOwnershipRequest)) body: TransferOwnershipRequest,
  ): Promise<ProjectSummary> {
    return this.projects.transferOwnership(user.id, projectId, body.userId);
  }

  @Get(':projectId/members')
  async members(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectMembersResponse> {
    return { members: await this.projects.listMembers(user.id, projectId) };
  }

  @Post(':projectId/members/invite')
  async invite(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(InviteMemberRequest)) body: InviteMemberRequest,
  ): Promise<ProjectMembersResponse> {
    return { members: await this.projects.invite(user.id, projectId, body) };
  }

  @Patch(':projectId/members/:userId')
  async changeRole(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body(new ZodPipe(UpdateMemberRequest)) body: UpdateMemberRequest,
  ): Promise<ProjectMembersResponse> {
    return { members: await this.projects.changeRole(user.id, projectId, userId, body.role) };
  }

  @Delete(':projectId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.projects.removeMember(user.id, projectId, userId);
  }
}
