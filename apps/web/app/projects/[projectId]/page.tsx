import type { Metadata } from 'next';
import { EditorShell } from './EditorShell';

export const metadata: Metadata = { title: 'Editor' };

export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <EditorShell projectId={projectId} />;
}
