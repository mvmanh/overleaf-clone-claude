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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  CreateFileRequest,
  type ProjectFile,
  type ProjectFileListResponse,
  type ProjectFileWithContent,
  RenameFileRequest,
  MAX_UPLOAD_BYTES,
  ProjectPath,
  SaveFileRequest,
  type SessionUser,
  type UploadFileResponse,
} from '@latex-cloud/shared';
import { ApiException } from '../common/api-exception';
import { contentDisposition } from '../common/content-disposition';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { FilesService } from './files.service';

const UploadFields = z.object({
  path: ProjectPath,
  overwrite: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

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

  /** Multipart: `file`, `path` (target project path) and optional `overwrite=true`. */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
      // Browsers send UTF-8 file names; busboy defaults to latin1.
      defParamCharset: 'utf8',
    }),
  )
  upload(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<UploadFileResponse> {
    if (!file)
      throw new ApiException('VALIDATION_FAILED', 'Attach a file.', HttpStatus.BAD_REQUEST);
    const parsed = UploadFields.safeParse({
      path: body.path ?? file.originalname,
      overwrite: body.overwrite,
    });
    if (!parsed.success) {
      throw new ApiException(
        'VALIDATION_FAILED',
        parsed.error.issues[0]?.message ?? 'Invalid file path.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.files.upload(
      user.id,
      projectId,
      parsed.data.path,
      file.buffer,
      parsed.data.overwrite,
    );
  }

  /**
   * Raw file bytes. Uploaded content is untrusted: sandboxed CSP, no sniffing,
   * and only images/PDFs are ever served inline.
   */
  @Get(':fileId/raw')
  async raw(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    const f = await this.files.raw(user.id, projectId, fileId);
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Content-Length', String(f.size));
    res.setHeader(
      'Content-Disposition',
      contentDisposition(f.inline ? 'inline' : 'attachment', f.path.split('/').pop()!),
    );
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag(f.sha256));
    if (Buffer.isBuffer(f.body)) {
      res.end(f.body);
      return;
    }
    f.body.on('error', () => res.destroy());
    f.body.pipe(res);
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
