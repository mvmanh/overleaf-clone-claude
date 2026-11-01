import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { parseCollabEvent } from './events';
import { mintCollabToken, verifyCollabToken } from './token';
import { buildDoc, isEmptyUpdate, replaceText, seedDoc, textDiff, textOf } from './ytext';

const SECRET = 'x'.repeat(40);
const USER = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';

describe('collab token', () => {
  it('round-trips claims', () => {
    const { token } = mintCollabToken(SECRET, { userId: USER, projectId: PROJECT });
    const r = verifyCollabToken(SECRET, token);
    expect(r.ok && r.claims.sub).toBe(USER);
    expect(r.ok && r.claims.pid).toBe(PROJECT);
  });

  it('rejects a token signed with another secret', () => {
    const { token } = mintCollabToken('y'.repeat(40), { userId: USER, projectId: PROJECT });
    expect(verifyCollabToken(SECRET, token)).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects tampered claims', () => {
    const { token } = mintCollabToken(SECRET, { userId: USER, projectId: PROJECT });
    const [v, , sig] = token.split('.');
    const other = Buffer.from(
      JSON.stringify({ sub: USER, pid: USER, iat: 1, exp: 9e9, jti: 'abcdefghij' }),
    ).toString('base64url');
    expect(verifyCollabToken(SECRET, `${v}.${other}.${sig}`).ok).toBe(false);
  });

  it('expires (with a small skew allowance)', () => {
    const now = Date.UTC(2026, 0, 1);
    const { token } = mintCollabToken(
      SECRET,
      { userId: USER, projectId: PROJECT },
      { now, ttlSeconds: 60 },
    );
    expect(verifyCollabToken(SECRET, token, { now: now + 80_000 }).ok).toBe(true);
    expect(verifyCollabToken(SECRET, token, { now: now + 120_000 })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects garbage and weak secrets', () => {
    expect(verifyCollabToken(SECRET, 'nope').ok).toBe(false);
    expect(verifyCollabToken(SECRET, 'v1.a.b').ok).toBe(false);
    expect(() => mintCollabToken('short', { userId: USER, projectId: PROJECT })).toThrow();
  });
});

describe('textDiff / replaceText', () => {
  it.each([
    ['hello world', 'hello brave world'],
    ['abc', ''],
    ['', 'abc'],
    ['aaaa', 'aa'],
    ['x 😀 y', 'x 😃 y'],
    ['same', 'same'],
  ])('%j → %j', (a, b) => {
    const d = textDiff(a, b);
    expect(a.slice(0, d.from) + d.insert + a.slice(d.from + d.remove)).toBe(b);
    const doc = seedDoc(a);
    replaceText(doc, b);
    expect(textOf(doc)).toBe(b);
  });

  it('never splits a surrogate pair', () => {
    const d = textDiff('😀', '😃');
    expect(d.from).toBe(0);
    expect(d.remove).toBe(2);
  });

  it('merges with a concurrent edit instead of overwriting it', () => {
    const server = seedDoc('line one\nline two\n');
    const api = new Y.Doc();
    Y.applyUpdate(api, Y.encodeStateAsUpdate(server));
    // A collaborator edits the start while the API replaces the end.
    server.getText('content').insert(0, '% note\n');
    const update = replaceText(api, 'line one\nline 2\n')!;
    Y.applyUpdate(server, update);
    expect(textOf(server)).toBe('% note\nline one\nline 2\n');
  });
});

describe('buildDoc', () => {
  it('replays snapshot + log and skips corrupt rows', () => {
    const doc = seedDoc('a');
    const snapshot = Y.encodeStateAsUpdate(doc);
    const sv = Y.encodeStateVector(doc);
    doc.getText('content').insert(1, 'b');
    const u1 = Y.encodeStateAsUpdate(doc, sv);
    const { doc: rebuilt, failed } = buildDoc(snapshot, [u1, new Uint8Array([9, 9, 9])]);
    expect(textOf(rebuilt)).toBe('ab');
    expect(failed).toBe(1);
  });

  it('recognises empty updates', () => {
    expect(isEmptyUpdate(Y.encodeStateAsUpdate(new Y.Doc()))).toBe(true);
    expect(isEmptyUpdate(Y.encodeStateAsUpdate(seedDoc('x')))).toBe(false);
  });
});

describe('events', () => {
  it('parses known events and ignores the rest', () => {
    expect(parseCollabEvent(JSON.stringify({ type: 'files-changed', projectId: PROJECT }))).toEqual(
      { type: 'files-changed', projectId: PROJECT },
    );
    expect(parseCollabEvent('{"type":"nope"}')).toBeNull();
    expect(parseCollabEvent('not json')).toBeNull();
  });
});
