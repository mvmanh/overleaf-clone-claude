import { Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  CompileArtifactKind,
  type CompileJob,
  type LatestCompilesResponse,
  type SessionUser,
} from '@latex-cloud/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { notFound } from '../common/api-exception';
import { CompilesService } from './compiles.service';

const CONTENT_TYPES: Record<CompileArtifactKind, string> = {
  pdf: 'application/pdf',
  log: 'text/plain; charset=utf-8',
  synctex: 'application/gzip',
};

@Controller()
export class CompilesController {
  constructor(private readonly compiles: CompilesService) {}

  @Post('projects/:projectId/compiles')
  @HttpCode(HttpStatus.ACCEPTED)
  request(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ): Promise<CompileJob> {
    return this.compiles.request(user.id, projectId);
  }

  @Get('projects/:projectId/compiles/latest')
  latest(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ): Promise<LatestCompilesResponse> {
    return this.compiles.latest(user.id, projectId);
  }

  @Get('compiles/:jobId')
  get(@CurrentUser() user: SessionUser, @Param('jobId') jobId: string): Promise<CompileJob> {
    return this.compiles.get(user.id, jobId);
  }

  /**
   * Streams an artifact through the API (authorization on every request).
   * Artifacts are immutable per job, so they are cacheable privately. PDFs
   * are untrusted output: sandboxed CSP, no sniffing.
   */
  @Get('compiles/:jobId/artifacts/:kind')
  async artifact(
    @CurrentUser() user: SessionUser,
    @Param('jobId') jobId: string,
    @Param('kind') kindParam: string,
    @Res() res: Response,
  ): Promise<void> {
    const kind = CompileArtifactKind.safeParse(kindParam);
    if (!kind.success) throw notFound('Artifact');
    const { stream, size, fileName } = await this.compiles.artifact(user.id, jobId, kind.data);
    res.setHeader('Content-Type', CONTENT_TYPES[kind.data]);
    if (size !== undefined) res.setHeader('Content-Length', String(size));
    res.setHeader(
      'Content-Disposition',
      `${kind.data === 'synctex' ? 'attachment' : 'inline'}; filename="${fileName.replace(/[^\w.-]/g, '_')}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
