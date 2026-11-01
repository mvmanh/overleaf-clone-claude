import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import {
  COLLAB_TEXT_FIELD,
  type CollabNotice,
  CollabTokenResponse,
  type CollabUser,
  fileDocName,
  parseCollabNotice,
  projectRoomName,
  type ProjectRole,
} from '@latex-cloud/shared';
import { ApiError, apiFetch } from '../api';

/** One collaborator as seen in the project room (deduplicated per user). */
export interface Peer {
  user: CollabUser;
  /** Files this user has open (several tabs → several files). */
  fileIds: string[];
}

export type ConnectionState = 'connecting' | 'connected' | 'offline';

/** An open file document, bound to the shared socket. */
export interface FileBinding {
  doc: Y.Doc;
  text: Y.Text;
  provider: HocuspocusProvider;
  undoManager: Y.UndoManager;
  /** Resolves once the server state is loaded (rejects if access is refused). */
  ready: Promise<void>;
  destroy(): void;
}

type Listener<T> = (value: T) => void;

/** `/collab` → `ws(s)://<this host>/collab`; absolute URLs pass through. */
export function resolveCollabUrl(url: string, loc: Pick<Location, 'protocol' | 'host'>): string {
  if (/^wss?:\/\//.test(url)) return url;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${url}`;
}

/** Groups awareness states by user, ignoring ourselves and invalid entries. */
export function peersFrom(
  states: Iterable<[number, Record<string, unknown>]>,
  selfUserId: string,
): Peer[] {
  const byUser = new Map<string, Peer>();
  for (const [, state] of states) {
    const user = state.user as CollabUser | undefined;
    if (!user?.id || user.id === selfUserId) continue;
    const peer = byUser.get(user.id) ?? { user, fileIds: [] };
    const fileId = typeof state.fileId === 'string' ? state.fileId : null;
    if (fileId && !peer.fileIds.includes(fileId)) peer.fileIds.push(fileId);
    byUser.set(user.id, peer);
  }
  return [...byUser.values()].sort((a, b) => a.user.name.localeCompare(b.user.name));
}

/**
 * Real-time session for one project: a single multiplexed WebSocket carrying
 * the presence room and every open file document. Tokens are fetched from the
 * API (cookie-authenticated) and refreshed before they expire, including on
 * reconnect after a network drop.
 */
export class CollabSession {
  private socket: HocuspocusProviderWebsocket | null = null;
  private room: HocuspocusProvider | null = null;
  private tokenCache: { token: string; expiresAt: number } | null = null;
  private info: CollabTokenResponse | null = null;
  private peers: Peer[] = [];
  private connection: ConnectionState = 'connecting';
  private readonly peerListeners = new Set<Listener<Peer[]>>();
  private readonly noticeListeners = new Set<Listener<CollabNotice>>();
  private readonly connectionListeners = new Set<Listener<ConnectionState>>();
  private destroyed = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly projectId: string) {}

  get user(): CollabUser | null {
    return this.info?.user ?? null;
  }

  get role(): ProjectRole | null {
    return this.info?.role ?? null;
  }

  /**
   * Connects. Resolves false when the server has collaboration turned off
   * (the editor then uses compare-and-swap autosave instead).
   */
  async start(): Promise<boolean> {
    try {
      this.info = await this.fetchToken();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'COLLAB_DISABLED') return false;
      throw e;
    }
    if (this.destroyed) return false;
    this.socket = new HocuspocusProviderWebsocket({
      url: resolveCollabUrl(this.info.url, window.location),
      // Reconnect quickly at first, then back off (network drops, deploys).
      // minDelay must not exceed delay, or the retry helper silently gives up.
      delay: 1_000,
      minDelay: 500,
      factor: 1.5,
      maxDelay: 10_000,
      maxAttempts: 0,
    });
    // The browser knows about a lost network long before a socket timeout:
    // say so at once, and reconnect as soon as the network is back.
    const onOffline = () => {
      this.socket?.disconnect();
      this.setConnection('offline');
    };
    const onOnline = () => void this.socket?.connect();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    this.cleanups.push(() => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    });
    this.socket.on('status', ({ status }: { status: string }) =>
      this.setConnection(
        status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline',
      ),
    );
    this.room = this.provider(projectRoomName(this.projectId), new Y.Doc());
    this.room.on('stateless', ({ payload }: { payload: string }) => {
      const notice = parseCollabNotice(payload);
      if (notice) for (const l of this.noticeListeners) l(notice);
    });
    const awareness = this.room.awareness!;
    awareness.setLocalStateField('user', this.info.user);
    awareness.setLocalStateField('fileId', null);
    awareness.on('change', () => {
      this.peers = peersFrom(
        awareness.getStates() as Map<number, Record<string, unknown>>,
        this.info!.user.id,
      );
      for (const l of this.peerListeners) l(this.peers);
    });
    return true;
  }

  /** Announces which file this tab is editing (presence list, file tree dots). */
  setCurrentFile(fileId: string | null): void {
    this.room?.awareness?.setLocalStateField('fileId', fileId);
  }

  openFile(fileId: string): FileBinding {
    if (!this.socket || !this.info) throw new Error('collab session not started');
    const doc = new Y.Doc();
    const text = doc.getText(COLLAB_TEXT_FIELD);
    const provider = this.provider(fileDocName(this.projectId, fileId), doc);
    provider.awareness?.setLocalStateField('user', this.info.user);
    const undoManager = new Y.UndoManager(text);
    const ready = new Promise<void>((resolve, reject) => {
      provider.on('synced', () => resolve());
      provider.on('authenticationFailed', ({ reason }: { reason: string }) =>
        reject(new Error(reason || 'Access denied')),
      );
    });
    // Never an unhandled rejection: callers await `ready` when they need it.
    ready.catch(() => {});
    return {
      doc,
      text,
      provider,
      undoManager,
      ready,
      destroy: () => {
        undoManager.destroy();
        provider.destroy();
        doc.destroy();
      },
    };
  }

  onPeers(l: Listener<Peer[]>): () => void {
    this.peerListeners.add(l);
    l(this.peers);
    return () => this.peerListeners.delete(l);
  }

  onNotice(l: Listener<CollabNotice>): () => void {
    this.noticeListeners.add(l);
    return () => this.noticeListeners.delete(l);
  }

  onConnection(l: Listener<ConnectionState>): () => void {
    this.connectionListeners.add(l);
    l(this.connection);
    return () => this.connectionListeners.delete(l);
  }

  get connectionState(): ConnectionState {
    return this.connection;
  }

  destroy(): void {
    this.destroyed = true;
    for (const c of this.cleanups.splice(0)) c();
    this.room?.destroy();
    this.socket?.destroy();
    this.peerListeners.clear();
    this.noticeListeners.clear();
    this.connectionListeners.clear();
  }

  private provider(name: string, document: Y.Doc): HocuspocusProvider {
    const provider = new HocuspocusProvider({
      websocketProvider: this.socket!,
      name,
      document,
      token: () => this.token(),
      // Each provider gets its own address on the shared socket. Without it, a
      // remount (file reopened, role change, React StrictMode) races: the old
      // provider's Close reaches the server after the new one authenticated
      // and silently drops the new connection.
      sessionAwareness: true,
    });
    provider.attach();
    return provider;
  }

  private setConnection(s: ConnectionState): void {
    if (s === this.connection) return;
    this.connection = s;
    for (const l of this.connectionListeners) l(s);
  }

  private async fetchToken(): Promise<CollabTokenResponse> {
    const r = await apiFetch(
      `/api/v1/projects/${encodeURIComponent(this.projectId)}/collab/token`,
      CollabTokenResponse,
      { method: 'POST' },
    );
    this.tokenCache = { token: r.token, expiresAt: Date.parse(r.expiresAt) };
    return r;
  }

  /** A token valid for at least another minute (fetched again when needed). */
  private async token(): Promise<string> {
    const cached = this.tokenCache;
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
    try {
      this.info = await this.fetchToken();
    } catch (e) {
      // Offline: try the old token; the server will ask again after reconnecting.
      if (cached) return cached.token;
      throw e;
    }
    return this.tokenCache!.token;
  }
}
