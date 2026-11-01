import { type LanguageSupport, StreamLanguage, type StreamParser } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import type { Extension } from '@codemirror/state';
import { extensionOf } from '@latex-cloud/shared';
import { bibtex } from './bibtex';

const TEX = new Set([
  'tex',
  'ltx',
  'sty',
  'cls',
  'dtx',
  'ins',
  'def',
  'cfg',
  'clo',
  'tikz',
  'pgf',
  'bbl',
  'bbx',
  'cbx',
  'lbx',
]);

const cache = new Map<string, StreamLanguage<unknown>>();
function lang(name: string, parser: StreamParser<unknown>) {
  let l = cache.get(name);
  if (!l) cache.set(name, (l = StreamLanguage.define(parser)));
  return l;
}

export type EditorLanguage = 'latex' | 'bibtex' | 'plain';

export function languageName(path: string): EditorLanguage {
  const ext = extensionOf(path);
  if (TEX.has(ext)) return 'latex';
  if (ext === 'bib') return 'bibtex';
  return 'plain';
}

export function languageFor(path: string): Extension | LanguageSupport | [] {
  switch (languageName(path)) {
    case 'latex':
      return lang('latex', stex as StreamParser<unknown>);
    case 'bibtex':
      return lang('bibtex', bibtex as StreamParser<unknown>);
    default:
      return [];
  }
}
