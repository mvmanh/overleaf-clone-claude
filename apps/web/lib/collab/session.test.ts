import { describe, expect, it } from 'vitest';
import { collabColorFor, initialsOf, parseCollabDocName } from '@latex-cloud/shared';
import { peersFrom, resolveCollabUrl } from './session';

const P = '22222222-2222-4222-8222-222222222222';
const F = '33333333-3333-4333-8333-333333333333';
const user = (id: string, name: string) => ({ id, name, ...collabColorFor(id) });
const ME = user('11111111-1111-4111-8111-111111111111', 'Alice Nguyen');
const BOB = user('44444444-4444-4444-8444-444444444444', 'Bob Tran');
const CAROL = user('55555555-5555-4555-8555-555555555555', 'Carol Le');

describe('resolveCollabUrl', () => {
  it('keeps absolute URLs and maps same-origin paths to ws(s)', () => {
    expect(resolveCollabUrl('ws://localhost:4100/collab', { protocol: 'http:', host: 'x' })).toBe(
      'ws://localhost:4100/collab',
    );
    expect(resolveCollabUrl('/collab', { protocol: 'https:', host: 'tex.example.org' })).toBe(
      'wss://tex.example.org/collab',
    );
    expect(resolveCollabUrl('/collab', { protocol: 'http:', host: 'localhost:3000' })).toBe(
      'ws://localhost:3000/collab',
    );
  });
});

describe('peersFrom', () => {
  it('groups tabs per user, drops myself and sorts by name', () => {
    const peers = peersFrom(
      [
        [1, { user: ME, fileId: F }],
        [2, { user: CAROL, fileId: null }],
        [3, { user: BOB, fileId: F }],
        [4, { user: BOB, fileId: 'not-a-file-but-a-string' }],
        [5, { fileId: F }],
      ],
      ME.id,
    );
    expect(peers.map((p) => p.user.name)).toEqual(['Bob Tran', 'Carol Le']);
    expect(peers[0]!.fileIds).toEqual([F, 'not-a-file-but-a-string']);
    expect(peers[1]!.fileIds).toEqual([]);
  });
});

describe('shared collab helpers', () => {
  it('parses only well-formed document names', () => {
    expect(parseCollabDocName(`project.${P}`)).toEqual({ kind: 'project', projectId: P });
    expect(parseCollabDocName(`file.${P}.${F}`)).toEqual({ kind: 'file', projectId: P, fileId: F });
    expect(parseCollabDocName(`file.${P}`)).toBeNull();
    expect(parseCollabDocName(`project.${P}/../x`)).toBeNull();
  });

  it('gives stable colours and readable initials', () => {
    expect(collabColorFor(BOB.id)).toEqual(collabColorFor(BOB.id));
    expect(collabColorFor(BOB.id).color).toMatch(/^#[0-9a-f]{6}$/);
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('Nguyễn Văn An')).toBe('NA');
    expect(initialsOf('carol')).toBe('CA');
  });
});
