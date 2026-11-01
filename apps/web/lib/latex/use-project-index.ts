'use client';

import { useEffect, useMemo, useRef } from 'react';
import { type ProjectFile, ProjectTextContentsResponse } from '@latex-cloud/shared';
import { apiFetch } from '../api';
import { ProjectIndex } from './project-index';

/**
 * Keeps a ProjectIndex in sync with the server's files. Contents are fetched
 * in one request, then only files whose hash changed are re-read. The file
 * open in the editor is indexed from its live buffer instead (see SourceEditor).
 */
export function useProjectIndex(
  projectId: string,
  files: ProjectFile[] | null,
  openPath: string | null,
): ProjectIndex {
  const index = useMemo(() => new ProjectIndex(), []);
  const known = useRef(new Map<string, string>());
  const openRef = useRef(openPath);
  openRef.current = openPath;

  useEffect(() => {
    if (!files) return;
    index.setFiles(files.map((f) => f.path));
    const stale = files.filter(
      (f) =>
        f.kind === 'text' && known.current.get(f.path) !== f.sha256 && f.path !== openRef.current,
    );
    for (const p of [...known.current.keys()])
      if (!files.some((f) => f.path === p)) known.current.delete(p);
    if (!stale.length) return;
    const timer = setTimeout(() => {
      void apiFetch(`/api/v1/projects/${projectId}/files/contents`, ProjectTextContentsResponse)
        .then((r) => {
          for (const f of r.files) {
            if (known.current.get(f.path) === f.sha256 || f.path === openRef.current) continue;
            known.current.set(f.path, f.sha256);
            index.update(f.path, f.content);
          }
        })
        .catch(() => undefined); // suggestions degrade gracefully
    }, 150);
    return () => clearTimeout(timer);
  }, [files, index, projectId]);

  return index;
}
