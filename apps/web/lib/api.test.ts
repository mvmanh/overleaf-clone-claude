import { describe, expect, it } from 'vitest';
import { safeNextPath } from './api';

describe('safeNextPath', () => {
  it.each([
    [null, '/projects'],
    ['/projects/abc', '/projects/abc'],
    ['https://evil.example', '/projects'],
    ['//evil.example', '/projects'],
    ['/\\evil.example', '/projects'],
    ['projects', '/projects'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
