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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  CreateProjectRequest,
  type ImportProjectResponse,
  MAX_ZIP_BYTES,
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
import { ApiException } from '../common/api-exception';
import { contentDisposition } from '../common/content-disposition';
import { ZodPipe } from '../common/zod.pipe';
import { FilesService } from './files.service';
import { ProjectAccessService } from './project-access.service';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly access: ProjectAccessService,
    private readonly files: FilesService,
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

  /** Multipart: `file` (ZIP) and optional `name`. */
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ZIP_BYTES, files: 1, fields: 4 },
      // Browsers send UTF-8 file names; busboy defaults to latin1.
      defParamCharset: 'utf8',
    }),
  )
  importZip(
    @CurrentUser() user: SessionUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<ImportProjectResponse> {
    if (!file)
      throw new ApiException('VALIDATION_FAILED', 'Attach a .zip file.', HttpStatus.BAD_REQUEST);
    const name = typeof body.name === 'string' ? body.name : undefined;
    return this.projects.importZip(user.id, file.buffer, file.originalname, name);
  }

  @Get(':projectId/export.zip')
  async exportZip(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, name } = await this.files.exportZip(user.id, projectId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition('attachment', `${name}.zip`));
    res.setHeader('Cache-Control', 'private, no-store');
    stream.on('error', () => res.destroy());
    stream.pipe(res);
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
