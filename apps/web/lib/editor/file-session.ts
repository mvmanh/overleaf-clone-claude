export type SaveStatus =
  | { kind: 'saved' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'conflict' }
  /** Collaborative editing: disconnected; edits are kept and sent on reconnect. */
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

export interface FileSessionOptions {
  /** Hash of the content the editor started from (server version). */
  baseSha: string;
  getContent: () => string;
  /** PUT with If-Match; resolves the new hash. Rejects with `{ status }` on HTTP errors. */
  put: (content: string, ifMatch: string) => Promise<{ sha256: string }>;
  fetchLatest: () => Promise<{ content: string; sha256: string }>;
  onStatus: (s: SaveStatus) => void;
  debounceMs?: number;
  retryMs?: number;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
}

/**
 * Autosave state machine for one open text file (framework-free, unit-tested).
 *
 * - Edits are debounced, then saved with compare-and-swap (If-Match).
 * - At most one request in flight; edits during a save trigger another save.
 * - A 412 means someone else saved first: we stop and let the user choose
 *   (keep mine = overwrite, or take theirs = reload). Nothing is lost silently.
 * - Other failures retry with a delay and keep the text dirty.
 */
export class FileSession {
  private baseSha: string;
  private status: SaveStatus = { kind: 'saved' };
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private changedSinceSave = false;
  private disposed = false;
  private readonly debounceMs: number;
  private readonly retryMs: number;
  private readonly timers: NonNullable<FileSessionOptions['timers']>;

  constructor(private readonly opts: FileSessionOptions) {
    this.baseSha = opts.baseSha;
    this.debounceMs = opts.debounceMs ?? 1000;
    this.retryMs = opts.retryMs ?? 5000;
    this.timers = opts.timers ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as number),
    };
  }

  get current(): SaveStatus {
    return this.status;
  }

  /** True while there are edits the server does not have yet. */
  get hasUnsavedChanges(): boolean {
    return this.status.kind !== 'saved';
  }

  markChanged(): void {
    if (this.disposed) return;
    this.changedSinceSave = true;
    if (this.status.kind === 'conflict') return; // wait for the user's decision
    if (this.status.kind !== 'saving') this.set({ kind: 'dirty' });
    this.schedule(this.debounceMs);
  }

  /** Saves immediately (Ctrl/Cmd+S, file switch, unload). */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (this.status.kind === 'conflict') return;
    if (this.inFlight) {
      await this.inFlight;
      if (this.changedSinceSave && this.current.kind !== 'conflict') return this.flush();
      return;
    }
    if (!this.changedSinceSave) return;
    this.inFlight = this.saveOnce();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
    if (this.changedSinceSave && this.status.kind === 'saved') this.schedule(this.debounceMs);
  }

  /** Conflict resolution: keep my text, replacing the newer server version. */
  async overwrite(): Promise<void> {
    const latest = await this.opts.fetchLatest();
    this.baseSha = latest.sha256;
    this.changedSinceSave = true;
    this.set({ kind: 'dirty' });
    await this.flush();
  }

  /** Conflict resolution: discard my edits; returns the server text to load. */
  async reload(): Promise<string> {
    const latest = await this.opts.fetchLatest();
    this.baseSha = latest.sha256;
    this.changedSinceSave = false;
    this.cancelTimer();
    this.set({ kind: 'saved' });
    return latest.content;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private async saveOnce(): Promise<void> {
    this.changedSinceSave = false;
    const content = this.opts.getContent();
    this.set({ kind: 'saving' });
    try {
      const { sha256 } = await this.opts.put(content, this.baseSha);
      this.baseSha = sha256;
      this.set(this.changedSinceSave ? { kind: 'dirty' } : { kind: 'saved' });
    } catch (err) {
      this.changedSinceSave = true;
      const status = (err as { status?: number }).status;
      if (status === 412) {
        this.set({ kind: 'conflict' });
        return;
      }
      const message = err instanceof Error ? err.message : 'Could not save.';
      this.set({ kind: 'error', message });
      if (status !== 403 && status !== 404) this.schedule(this.retryMs);
    }
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private set(s: SaveStatus): void {
    this.status = s;
    if (!this.disposed) this.opts.onStatus(s);
  }
}
