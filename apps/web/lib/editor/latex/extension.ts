import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  pickedCompletion,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import { lintGutter, lintKeymap } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension, Prec } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import type { ProjectIndex } from '../../latex/project-index';
import { autoExpandHandler, latexKeymap } from './input';
import { latexLinter } from './lint';
import { mathPreview } from './preview';
import { recordUsage, type EditorSettings } from './settings';
import { latexCompletionSource } from './sources';

export interface LatexExtensionDeps {
  index: () => ProjectIndex;
  path: () => string;
  settings: () => EditorSettings;
}

/** Editor chrome shared by every file type (a trimmed, configurable basicSetup). */
export function baseSetup(settings: EditorSettings): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of('\t'),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    settings.lineWrapping ? EditorView.lineWrapping : [],
    EditorView.theme({ '&': { fontSize: `${settings.fontSize}px` } }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
  ];
}

const usageKey = (type: string | undefined, label: string) =>
  type === 'cite'
    ? `cite:${label}`
    : type === 'label'
      ? `ref:${label}`
      : type === 'snippet'
        ? `snip:${label}`
        : type === 'type'
          ? `env:${label}`
          : label;

/** Everything LaTeX-specific: completion, snippets, previews, checks. */
export function latexSetup(deps: LatexExtensionDeps, settings: EditorSettings): Extension {
  // Must be created once: CodeMirror tracks completion sources by identity, and
  // a new function per lookup would restart the query on every transaction.
  const data = [
    {
      autocomplete: latexCompletionSource(deps),
      closeBrackets: { brackets: settings.autoClose ? ['(', '[', '{', '$'] : ['(', '[', '{'] },
      commentTokens: { line: '%' },
    },
  ];
  return [
    EditorState.languageData.of(() => data),
    closeBrackets(),
    autocompletion({
      activateOnTyping: settings.autocomplete === 'typing',
      maxRenderedOptions: 80,
      icons: true,
      closeOnBlur: true,
      interactionDelay: 50,
      optionClass: (c) => `lc-cm-option lc-cm-option--${c.type ?? 'text'}`,
    }),
    Prec.high(autoExpandHandler(deps.settings)),
    latexKeymap(deps.settings),
    settings.mathPreview ? mathPreview(deps.index) : [],
    settings.lint ? [latexLinter(deps.index, deps.path), lintGutter()] : [],
    EditorView.updateListener.of((u) => {
      for (const tr of u.transactions) {
        const picked = tr.annotation(pickedCompletion);
        if (picked) recordUsage(usageKey(picked.type, picked.label));
      }
    }),
  ];
}

/** BibTeX and other text files: base editing plus bracket closing and comments. */
export function plainSetup(settings: EditorSettings, comment = '%'): Extension {
  const data = [{ commentTokens: { line: comment } }];
  return [
    EditorState.languageData.of(() => data),
    closeBrackets(),
    autocompletion({ activateOnTyping: settings.autocomplete === 'typing' }),
  ];
}
