'use client';

import { useEffect, useState } from 'react';
import type { CollabNotice } from '@latex-cloud/shared';
import { type ConnectionState, CollabSession, type Peer } from './session';

export type CollabState =
  | { kind: 'pending' }
  | { kind: 'ready'; session: CollabSession }
  /** Collaboration is off on this server, or unreachable: autosave fallback. */
  | { kind: 'off'; reason: string };

/** One CollabSession per open project, torn down when the project closes. */
export function useCollabSession(projectId: string, enabled: boolean): CollabState {
  const [state, setState] = useState<CollabState>({ kind: 'pending' });
  useEffect(() => {
    if (!enabled) return;
    const session = new CollabSession(projectId);
    let live = true;
    setState({ kind: 'pending' });
    session
      .start()
      .then((on) => {
        if (!live) return;
        setState(on ? { kind: 'ready', session } : { kind: 'off', reason: 'disabled' });
      })
      .catch((e: unknown) => {
        if (live) setState({ kind: 'off', reason: e instanceof Error ? e.message : 'unavailable' });
      });
    return () => {
      live = false;
      session.destroy();
    };
  }, [projectId, enabled]);
  return state;
}

export function usePeers(session: CollabSession | null): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    if (!session) return setPeers([]);
    return session.onPeers(setPeers);
  }, [session]);
  return peers;
}

export function useConnection(session: CollabSession | null): ConnectionState | null {
  const [s, setS] = useState<ConnectionState | null>(null);
  useEffect(() => {
    if (!session) return setS(null);
    return session.onConnection(setS);
  }, [session]);
  return s;
}

export function useCollabNotices(
  session: CollabSession | null,
  handler: (n: CollabNotice) => void,
): void {
  useEffect(() => {
    if (!session) return;
    return session.onNotice(handler);
  }, [session, handler]);
}
