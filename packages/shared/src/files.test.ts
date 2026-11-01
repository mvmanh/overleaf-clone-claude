import { describe, expect, it } from 'vitest';
import {
  CreateFileRequest,
  extensionOf,
  isTexRoot,
  isTextPath,
  MAX_TEXT_FILE_BYTES,
  RenameFileRequest,
  SaveFileRequest,
} from './index';

describe('file contracts', () => {
  it('classifies text paths by extension', () => {
    expect(isTextPath('chapters/intro.tex')).toBe(true);
    expect(isTextPath('refs.BIB')).toBe(true);
    expect(isTextPath('figure.png')).toBe(false);
    expect(isTextPath('Makefile')).toBe(false);
    expect(extensionOf('.hidden')).toBe('');
    expect(isTexRoot('main.tex')).toBe(true);
    expect(isTexRoot('refs.bib')).toBe(false);
  });

  it('applies the shared path safety rules', () => {
    for (const bad of ['../x.tex', '/abs.tex', 'a//b.tex', 'latexmkrc', '-x.tex', 'a\\b.tex']) {
      expect(CreateFileRequest.safeParse({ path: bad }).success, bad).toBe(false);
    }
    expect(CreateFileRequest.parse({ path: ' chapters/one.tex ' })).toEqual({
      path: 'chapters/one.tex',
      content: '',
    });
  });

  it('only creates text files, but renames any safe path', () => {
    expect(CreateFileRequest.safeParse({ path: 'img.png' }).success).toBe(false);
    expect(RenameFileRequest.safeParse({ path: 'img/plot.png' }).success).toBe(true);
  });

  it('bounds content size in UTF-8 bytes', () => {
    expect(
      SaveFileRequest.safeParse({ content: 'ê'.repeat(MAX_TEXT_FILE_BYTES / 2) }).success,
    ).toBe(true);
    expect(
      SaveFileRequest.safeParse({ content: 'ê'.repeat(MAX_TEXT_FILE_BYTES / 2 + 1) }).success,
    ).toBe(false);
  });
});
