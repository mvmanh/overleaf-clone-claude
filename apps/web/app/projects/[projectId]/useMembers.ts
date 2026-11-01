'use client';

import { useCallback, useEffect, useState } from 'react';
import { ProjectMembersResponse, type ProjectMember } from '@latex-cloud/shared';
import { ApiError, apiFetch } from '../../../lib/api';

export type MembersState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; members: ProjectMember[] };

export function useMembers(projectId: string, enabled: boolean) {
  const [state, setState] = useState<MembersState>({ kind: 'loading' });

  const reload = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/members`, ProjectMembersResponse)
      .then((r) => setState({ kind: 'ready', members: r.members }))
      .catch((e: unknown) =>
        setState({
          kind: 'error',
          message: e instanceof ApiError ? e.message : 'Could not load members.',
        }),
      );
  }, [projectId]);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  return { state, setState, reload };
}
