import { describe, expect, it, vi } from 'vitest';
import { FileSession, type SaveStatus } from './file-session';

function setup(opts: { put?: (c: string, m: string) => Promise<{ sha256: string }> } = {}) {
  let doc = 'v0';
  const statuses: SaveStatus['kind'][] = [];
  const puts: [string, string][] = [];
  let server = { content: 'v0', sha256: 'h0' };
  const put =
    opts.put ??
    (async (content: string, ifMatch: string) => {
      puts.push([content, ifMatch]);
      if (ifMatch !== server.sha256) throw Object.assign(new Error('conflict'), { status: 412 });
      server = { content, sha256: `h(${content})` };
      return { sha256: server.sha256 };
    });
  vi.useFakeTimers();
  const s = new FileSession({
    baseSha: 'h0',
    getContent: () => doc,
    put,
    fetchLatest: async () => server,
    onStatus: (st) => statuses.push(st.kind),
    debounceMs: 1000,
    retryMs: 5000,
  });
  return {
    s,
    statuses,
    puts,
    edit: (t: string) => {
      doc = t;
      s.markChanged();
    },
    setServer: (content: string) => {
      server = { content, sha256: `h(${content})` };
    },
  };
}

describe('FileSession', () => {
  it('debounces edits into one save with the base hash', async () => {
    const t = setup();
    t.edit('v1');
    t.edit('v12');
    expect(t.s.current.kind).toBe('dirty');
    await vi.advanceTimersByTimeAsync(999);
    expect(t.puts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.puts).toEqual([['v12', 'h0']]);
    expect(t.s.current.kind).toBe('saved');
    expect(t.s.hasUnsavedChanges).toBe(false);
  });

  it('chains saves using the hash returned by the previous save', async () => {
    const t = setup();
    t.edit('a');
    await t.s.flush();
    t.edit('ab');
    await t.s.flush();
    expect(t.puts).toEqual([
      ['a', 'h0'],
      ['ab', 'h(a)'],
    ]);
  });

  it('edits made during an in-flight save are saved afterwards', async () => {
    let release!: () => void;
    const calls: string[] = [];
    let n = 0;
    const t = setup({
      put: (c) => {
        calls.push(c);
        n++;
        return n === 1
          ? new Promise((r) => {
              release = () => r({ sha256: 'h1' });
            })
          : Promise.resolve({ sha256: `h${n}` });
      },
    });
    t.edit('first');
    const p = t.s.flush();
    t.edit('second');
    release();
    await p;
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(['first', 'second']);
    expect(t.s.current.kind).toBe('saved');
  });

  it('stops on 412 and resolves by overwrite or reload', async () => {
    const t = setup();
    t.setServer('theirs');
    t.edit('mine');
    await t.s.flush();
    expect(t.s.current.kind).toBe('conflict');
    t.edit('mine2'); // more typing does not trigger saves while in conflict
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.puts).toHaveLength(1);

    await t.s.overwrite();
    expect(t.puts.at(-1)).toEqual(['mine2', 'h(theirs)']);
    expect(t.s.current.kind).toBe('saved');

    t.setServer('theirs again');
    t.edit('mine3');
    await t.s.flush();
    expect(t.s.current.kind).toBe('conflict');
    expect(await t.s.reload()).toBe('theirs again');
    expect(t.s.current.kind).toBe('saved');
  });

  it('retries transient failures and stays dirty meanwhile', async () => {
    let fail = true;
    const t = setup({
      put: async () => {
        if (fail) throw Object.assign(new Error('offline'), { status: 0 });
        return { sha256: 'ok' };
      },
    });
    t.edit('x');
    await t.s.flush();
    expect(t.s.current).toEqual({ kind: 'error', message: 'offline' });
    expect(t.s.hasUnsavedChanges).toBe(true);
    fail = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.s.current.kind).toBe('saved');
  });
});
