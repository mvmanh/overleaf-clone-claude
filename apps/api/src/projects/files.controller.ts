import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CreateFileRequest,
  type ProjectFile,
  type ProjectFileListResponse,
  type ProjectFileWithContent,
  RenameFileRequest,
  SaveFileRequest,
  type SessionUser,
} from '@latex-cloud/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { FilesService } from './files.service';

/** Strong ETag from the content hash; accepts quoted or bare values in If-Match. */
const etag = (sha256: string) => `"${sha256}"`;
const parseIfMatch = (v: string | undefined) =>
  v
    ?.trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1') || undefined;

@Controller('projects/:projectId/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectFileListResponse> {
    return this.files.list(user.id, projectId);
  }

  @Post()
  create(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(CreateFileRequest)) body: CreateFileRequest,
  ): Promise<ProjectFile> {
    return this.files.create(user.id, projectId, body);
  }

  @Get(':fileId')
  async get(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProjectFileWithContent> {
    const file = await this.files.get(user.id, projectId, fileId);
    res.setHeader('ETag', etag(file.sha256));
    res.setHeader('Cache-Control', 'private, no-store');
    return file;
  }

  @Put(':fileId/content')
  async save(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodPipe(SaveFileRequest)) body: SaveFileRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProjectFile> {
    const file = await this.files.save(
      user.id,
      projectId,
      fileId,
      body.content,
      parseIfMatch(ifMatch),
    );
    res.setHeader('ETag', etag(file.sha256));
    return file;
  }

  @Patch(':fileId')
  rename(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
    @Body(new ZodPipe(RenameFileRequest)) body: RenameFileRequest,
  ): Promise<ProjectFile> {
    return this.files.rename(user.id, projectId, fileId, body.path);
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
  ): Promise<void> {
    return this.files.remove(user.id, projectId, fileId);
  }
}
