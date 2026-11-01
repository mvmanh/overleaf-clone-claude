'use client';

import { extensionOf, type ProjectFile } from '@latex-cloud/shared';
import { EmptyState } from '@latex-cloud/ui';
import { PdfViewer } from './PdfViewer';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Read-only view of an uploaded (binary) file. */
export function AssetPreview({ projectId, file }: { projectId: string; file: ProjectFile }) {
  const url = `/api/v1/projects/${projectId}/files/${file.id}/raw?v=${file.sha256.slice(0, 12)}`;
  const name = file.path.split('/').pop()!;
  const ext = extensionOf(file.path);
  const download = (
    <a className="lc-button" data-size="sm" href={url} download={name}>
      Download
    </a>
  );

  if (ext === 'pdf') return <PdfViewer url={url} fileName={name} />;
  if (['png', 'jpg', 'jpeg'].includes(ext)) {
    return (
      <div className="asset" data-testid="asset-preview">
        <div className="asset__meta">
          <span>
            {file.path} · {formatBytes(file.sizeBytes)}
          </span>
          {download}
        </div>
        <div className="asset__stage">
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, same-origin blob */}
          <img src={url} alt={file.path} className="asset__img" />
        </div>
      </div>
    );
  }
  return (
    <EmptyState title={name} action={download}>
      {ext === 'eps' ? 'EPS figure' : 'Font file'} · {formatBytes(file.sizeBytes)}. Binary files are
      used when compiling; they cannot be edited here.
    </EmptyState>
  );
}
