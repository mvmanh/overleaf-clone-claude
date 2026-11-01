import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CreateLabelRequest,
  type HistoryLabel,
  type HistoryListResponse,
  type HistoryVersionDetail,
  type RestoreVersionResponse,
  type SessionUser,
} from '@latex-cloud/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { contentDisposition } from '../common/content-disposition';
import { ZodPipe } from '../common/zod.pipe';
import { HistoryService } from './history.service';

@Controller('projects/:projectId/history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Query('before') before?: string,
    @Query('file') fileId?: string,
  ): Promise<HistoryListResponse> {
    return this.history.list(user.id, projectId, { before, fileId });
  }

  @Get('export.zip')
  async exportZip(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Res() res: Response,
    @Query('version') versionId?: string,
    @Query('label') labelId?: string,
  ): Promise<void> {
    const { stream, name } = await this.history.exportAt(user.id, projectId, {
      versionId,
      labelId,
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition('attachment', `${name}.zip`));
    res.setHeader('Cache-Control', 'private, no-store');
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  @Get('versions/:versionId')
  detail(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ): Promise<HistoryVersionDetail> {
    return this.history.detail(user.id, projectId, versionId);
  }

  @Post('versions/:versionId/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ): Promise<RestoreVersionResponse> {
    return this.history.restore(user.id, projectId, versionId);
  }

  @Post('labels')
  createLabel(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(CreateLabelRequest)) body: CreateLabelRequest,
  ): Promise<HistoryLabel> {
    return this.history.createLabel(user.id, projectId, body.name);
  }

  @Delete('labels/:labelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLabel(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('labelId') labelId: string,
  ): Promise<void> {
    return this.history.deleteLabel(user.id, projectId, labelId);
  }
}
