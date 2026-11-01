import { z } from 'zod';
import { ProjectRole } from './projects';

/**
 * Real-time collaboration contract (Phase 2). One Yjs document per text file,
 * plus one presence-only "project room" per project. Browser-safe: token
 * signing lives in @latex-cloud/collab-protocol (server only).
 */

/** Name of the shared text inside each file's Y.Doc. */
export const COLLAB_TEXT_FIELD = 'content';

export type CollabDocRef =
  | { kind: 'project'; projectId: string }
  | { kind: 'file'; projectId: string; fileId: string };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PROJECT_DOC = new RegExp(`^project\\.(${UUID})$`);
const FILE_DOC = new RegExp(`^file\\.(${UUID})\\.(${UUID})$`);

export const projectRoomName = (projectId: string) => `project.${projectId}`;
export const fileDocName = (projectId: string, fileId: string) => `file.${projectId}.${fileId}`;

/** Parses a document name; null for anything that is not ours (rejected on connect). */
export function parseCollabDocName(name: string): CollabDocRef | null {
  const p = PROJECT_DOC.exec(name);
  if (p) return { kind: 'project', projectId: p[1]! };
  const f = FILE_DOC.exec(name);
  if (f) return { kind: 'file', projectId: f[1]!, fileId: f[2]! };
  return null;
}

/** Identity shown to collaborators. Set by the server, never trusted from clients. */
export const CollabUser = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  colorLight: z.string(),
});
export type CollabUser = z.infer<typeof CollabUser>;

export const CollabTokenResponse = z.object({
  /** Short-lived, project-scoped bearer token for the collab WebSocket. */
  token: z.string(),
  expiresAt: z.string().datetime(),
  /** WebSocket URL (absolute ws(s)://… or a same-origin path like `/collab`). */
  url: z.string(),
  role: ProjectRole,
  user: CollabUser,
});
export type CollabTokenResponse = z.infer<typeof CollabTokenResponse>;

/** Server → client stateless messages (JSON). */
export const CollabNotice = z.discriminatedUnion('type', [
  /** The file list changed (create/rename/upload/delete): refetch it. */
  z.object({ type: z.literal('files-changed') }),
  /** This file was deleted while open: keep the buffer, stop syncing. */
  z.object({ type: z.literal('file-deleted'), fileId: z.string().uuid() }),
  /** Your role in the project changed; null = access removed. */
  z.object({ type: z.literal('role-changed'), role: ProjectRole.nullable() }),
  /** Project settings (name, main file, engine) changed. */
  z.object({ type: z.literal('project-changed') }),
]);
export type CollabNotice = z.infer<typeof CollabNotice>;

export function parseCollabNotice(payload: string): CollabNotice | null {
  try {
    const r = CollabNotice.safeParse(JSON.parse(payload));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Presence state each client publishes in the project room (validated server-side). */
export interface ProjectPresence {
  user: CollabUser;
  /** File currently open, if any. */
  fileId: string | null;
}

/**
 * Stable, readable colour per user (cursor, selection, avatar). 12 hues
 * spaced around the wheel; dark enough for white initials, with a light
 * tint for selection backgrounds.
 */
const PALETTE: Array<[string, string]> = [
  ['#d9480f', '#d9480f33'],
  ['#1971c2', '#1971c233'],
  ['#2f9e44', '#2f9e4433'],
  ['#9c36b5', '#9c36b533'],
  ['#c2255c', '#c2255c33'],
  ['#0c8599', '#0c859933'],
  ['#e67700', '#e6770033'],
  ['#5f3dc4', '#5f3dc433'],
  ['#087f5b', '#087f5b33'],
  ['#a61e4d', '#a61e4d33'],
  ['#364fc7', '#364fc733'],
  ['#5c940d', '#5c940d33'],
];

export function collabColorFor(userId: string): { color: string; colorLight: string } {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  const [color, colorLight] = PALETTE[h % PALETTE.length]!;
  return { color, colorLight };
}

/** Initials for an avatar: "Ada Lovelace" → "AL", "carol" → "CA". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}
