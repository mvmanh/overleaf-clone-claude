import { acceptCompletion, completionStatus, snippet } from '@codemirror/autocomplete';
import { indentMore } from '@codemirror/commands';
import { Prec } from '@codemirror/state';
import { EditorView, type KeyBinding, keymap } from '@codemirror/view';
import { findAutoExpansion } from '../../latex/data/auto-expand';
import { mathContextAt } from '../../latex/math-context';
import type { EditorSettings } from './settings';
import { escapeSnippetText, withExit } from './snippet-text';

/**
 * Typing-time behaviour: auto-expanding snippets and \[ \] / \( \) pairing.
 * The typed character is committed first; the expansion is a separate
 * transaction (non-joinable user event), so Ctrl/Cmd+Z undoes only the
 * expansion and leaves what was typed.
 */
export function autoExpandHandler(settings: () => EditorSettings) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    const s = settings();
    if (text.length !== 1 || from !== to || view.composing) return false;
    if (view.state.selection.ranges.length > 1 || view.state.readOnly) return false;
    const line = view.state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from);
    const mode = mathContextAt(view.state.doc.toString(), from).inMath ? 'math' : 'text';

    // \[ → \[ | \]   and   \( → \( | \)
    if (
      s.autoClose &&
      mode === 'text' &&
      (text === '[' || text === '(') &&
      /(^|[^\\])\\$/.test(before)
    ) {
      const close = text === '[' ? '\\]' : '\\)';
      if (
        line.text
          .slice(from - line.from)
          .trimStart()
          .startsWith(close)
      )
        return false;
      view.dispatch({
        changes: { from, insert: text },
        selection: { anchor: from + 1 },
        userEvent: 'input.type',
      });
      snippet(`${text === '[' ? '[' : '('} \${} ${close}`)(view, { label: 'pair' }, from, from + 1);
      return true;
    }

    if ((mode === 'math' && !s.autoMath) || (mode === 'text' && !s.textShortcuts)) return false;
    const match = findAutoExpansion(before + text, mode);
    if (!match) return false;
    view.dispatch({
      changes: { from, insert: text },
      selection: { anchor: from + 1 },
      userEvent: 'input.type',
    });
    const start = from + 1 - match.length;
    if (/[#$]\{/.test(match.template)) {
      snippet(withExit(match.template))(
        view,
        { label: `auto:${String(match.rule.trigger)}` },
        start,
        from + 1,
      );
    } else {
      // No fields: a plain edit keeps any enclosing snippet's fields alive
      // (e.g. typing x1 inside the numerator of \frac{}{}). A non-joinable
      // user event still makes it a separate undo step.
      const insert = match.template.replace(/\\([{}])/g, '$1');
      view.dispatch({
        changes: { from: start, to: from + 1, insert },
        selection: { anchor: start + insert.length },
        userEvent: 'input.complete',
      });
    }
    return true;
  });
}

/** Enter after `\begin{env}` inserts the matching `\end{env}` if it is missing. */
function closeEnvironmentOnEnter(settings: () => EditorSettings) {
  return (view: EditorView): boolean => {
    if (!settings().autoClose) return false;
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty || state.selection.ranges.length > 1) return false;
    const line = state.doc.lineAt(sel.head);
    const before = line.text.slice(0, sel.head - line.from);
    const after = line.text.slice(sel.head - line.from);
    const m = /\\begin\{([^}]+)\}((?:\[[^\]]*\]|\{[^}]*\})*)\s*$/.exec(before);
    if (!m || after.trim() !== '') return false;
    const name = m[1]!;
    const doc = state.doc.toString();
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const begins = (doc.match(new RegExp(`\\\\begin\\{${esc}\\}`, 'g')) ?? []).length;
    const ends = (doc.match(new RegExp(`\\\\end\\{${esc}\\}`, 'g')) ?? []).length;
    if (ends >= begins) return false;
    const indent = /^\s*/.exec(line.text)![0];
    const unit = '\t';
    const insert = `\n${indent}${unit}\n${indent}\\end{${name}}`;
    view.dispatch({
      changes: { from: sel.head, insert },
      selection: { anchor: sel.head + 1 + indent.length + unit.length },
      userEvent: 'input',
      scrollIntoView: true,
    });
    return true;
  };
}

/** Wraps each selection (or inserts at the cursor) with a template around `$SEL`. */
function wrap(template: (mode: 'math' | 'text') => string) {
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false;
    const range = view.state.selection.main;
    const mode = mathContextAt(view.state.doc.toString(), range.from).inMath ? 'math' : 'text';
    const selected = view.state.sliceDoc(range.from, range.to);
    const t = template(mode);
    const body = selected
      ? t.replace('$SEL', escapeSnippetText(selected))
      : t.replace('$SEL', '${}');
    snippet(withExit(body))(view, { label: 'wrap' }, range.from, range.to);
    return true;
  };
}

export const LATEX_SHORTCUTS: { key: string; mac: string; description: string }[] = [
  { key: 'Ctrl+B', mac: '⌘B', description: 'Bold (\\textbf, or \\mathbf in math)' },
  { key: 'Ctrl+I', mac: '⌘I', description: 'Italic (\\textit, or \\mathit in math)' },
  { key: 'Ctrl+M', mac: '⌘M', description: 'Wrap in inline math $…$' },
  { key: 'Ctrl+Shift+M', mac: '⌘⇧M', description: 'Wrap in display math \\[…\\]' },
  { key: 'Ctrl+Shift+E', mac: '⌘⇧E', description: 'Wrap in an environment (type its name once)' },
  { key: 'Ctrl+/', mac: '⌘/', description: 'Toggle comment' },
  { key: 'Ctrl+Space', mac: '⌃Space', description: 'Show suggestions' },
  { key: 'Tab', mac: 'Tab', description: 'Accept suggestion / next snippet field' },
  { key: 'Shift+Tab', mac: '⇧Tab', description: 'Previous snippet field' },
  {
    key: 'Enter after \\begin{…}',
    mac: 'Enter after \\begin{…}',
    description: 'Insert the matching \\end{…}',
  },
];

export function latexKeymap(settings: () => EditorSettings) {
  const bindings: KeyBinding[] = [
    { key: 'Enter', run: closeEnvironmentOnEnter(settings) },
    {
      key: 'Mod-b',
      preventDefault: true,
      run: wrap((m) => (m === 'math' ? '\\mathbf{$SEL}' : '\\textbf{$SEL}')),
    },
    {
      key: 'Mod-i',
      preventDefault: true,
      run: wrap((m) => (m === 'math' ? '\\mathit{$SEL}' : '\\textit{$SEL}')),
    },
    { key: 'Mod-m', preventDefault: true, run: wrap(() => '$$SEL$') },
    { key: 'Mod-Shift-m', preventDefault: true, run: wrap(() => '\\[\n\t$SEL\n\\]') },
    {
      key: 'Mod-Shift-e',
      preventDefault: true,
      run: wrap(() => '\\begin{${env}}\n\t$SEL\n\\end{${env}}'),
    },
    // Tab accepts an open suggestion; otherwise indents (never moves focus out).
    {
      key: 'Tab',
      run: (v) => (completionStatus(v.state) === 'active' ? acceptCompletion(v) : false),
    },
  ];
  return [Prec.high(keymap.of(bindings)), keymap.of([{ key: 'Tab', run: indentMore }])];
}
