import { Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { type CollabTokenResponse, collabColorFor, type SessionUser } from '@latex-cloud/shared';
import { mintCollabToken } from '@latex-cloud/collab-protocol';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApiException } from '../common/api-exception';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { ProjectAccessService } from '../projects/project-access.service';

/**
 * Mints the short-lived WebSocket token for a project member. The browser
 * calls this (cookie-authenticated, same-origin) and hands the token to the
 * collab server, which never sees the session cookie.
 */
@Controller('projects/:projectId/collab')
export class CollabController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly access: ProjectAccessService,
  ) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  async token(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ): Promise<CollabTokenResponse> {
    const role = await this.access.requireAction(user.id, projectId, 'files:read');
    const secret = this.config.COLLAB_TOKEN_SECRET;
    if (!secret) {
      throw new ApiException(
        'COLLAB_DISABLED',
        'Real-time collaboration is not configured on this server.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const { token, claims } = mintCollabToken(secret, { userId: user.id, projectId });
    return {
      token,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      url: this.config.COLLAB_PUBLIC_URL,
      role,
      user: { id: user.id, name: user.displayName, ...collabColorFor(user.id) },
    };
  }
}
