import { type Diagnostic, linter } from '@codemirror/lint';
import { stripComments } from '../../latex/tex-scan';
import type { ProjectIndex } from '../../latex/project-index';
import { CITE_COMMANDS, REF_COMMANDS } from './sources';

/**
 * Checks that need no compile: environment nesting, references to labels that
 * do not exist, citations of unknown keys, and duplicate labels.
 */
export function lintLatex(doc: string, path: string, idx: ProjectIndex): Diagnostic[] {
  const out: Diagnostic[] = [];
  const src = stripComments(doc);

  // \begin / \end nesting (verbatim-like bodies are skipped).
  const stack: { name: string; from: number; to: number }[] = [];
  const verbatim = /^(verbatim|lstlisting|minted|comment)\*?$/;
  for (const m of src.matchAll(/\\(begin|end)\s*\{([^}]*)\}/g)) {
    const name = m[2]!.trim();
    const from = m.index!;
    const to = from + m[0].length;
    const top = stack[stack.length - 1];
    if (top && verbatim.test(top.name) && !(m[1] === 'end' && name === top.name)) continue;
    if (m[1] === 'begin') stack.push({ name, from, to });
    else if (!top) {
      out.push({
        from,
        to,
        severity: 'error',
        message: `\\end{${name}} has no matching \\begin{${name}}.`,
      });
    } else if (top.name !== name) {
      out.push({
        from,
        to,
        severity: 'error',
        message: `\\end{${name}} closes \\begin{${top.name}} (opened earlier).`,
      });
      const idx = stack.map((s) => s.name).lastIndexOf(name);
      if (idx >= 0) stack.splice(idx);
    } else stack.pop();
  }
  for (const open of stack) {
    if (open.name === 'document' && !/\\end\{document\}/.test(src)) {
      out.push({ ...open, severity: 'error', message: '\\begin{document} is never closed.' });
    } else if (open.name !== 'document') {
      out.push({
        from: open.from,
        to: open.to,
        severity: 'error',
        message: `\\begin{${open.name}} is never closed.`,
      });
    }
  }

  // References and citations against the project index.
  const labels = new Set(idx.labels.map((l) => l.key));
  const keys = new Set(idx.bibEntries.map((e) => e.key));
  for (const m of src.matchAll(/\\([A-Za-z]+)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^{}]*)\}/g)) {
    const cmd = m[1]!;
    const isRef = REF_COMMANDS.has(cmd);
    const isCite = CITE_COMMANDS.has(cmd) && idx.hasBibliography && cmd !== 'nocite';
    if (!isRef && !isCite) continue;
    const argStart = m.index! + m[0].lastIndexOf('{') + 1;
    let offset = 0;
    for (const raw of m[2]!.split(',')) {
      const key = raw.trim();
      const from = argStart + offset + raw.indexOf(key);
      offset += raw.length + 1;
      if (!key || key.includes('#')) continue;
      if (isRef && !labels.has(key)) {
        out.push({
          from,
          to: from + key.length,
          severity: 'warning',
          message: `No \\label{${key}} in this project.`,
        });
      } else if (isCite && !keys.has(key)) {
        out.push({
          from,
          to: from + key.length,
          severity: 'warning',
          message: `No bibliography entry with key "${key}".`,
        });
      }
    }
  }

  // Duplicate labels across the project.
  const counts = new Map<string, number>();
  for (const l of idx.labels) counts.set(l.key, (counts.get(l.key) ?? 0) + 1);
  for (const m of src.matchAll(/\\label\s*\{([^}]+)\}/g)) {
    const key = m[1]!.trim();
    if ((counts.get(key) ?? 0) > 1) {
      const where = idx.labels
        .filter((l) => l.key === key)
        .map((l) => `${l.file}:${l.line}`)
        .join(', ');
      out.push({
        from: m.index!,
        to: m.index! + m[0].length,
        severity: 'warning',
        message: `Label "${key}" is defined more than once (${where}).`,
      });
    }
  }
  void path;
  return out;
}

export function latexLinter(index: () => ProjectIndex, path: () => string) {
  return linter((view) => lintLatex(view.state.doc.toString(), path(), index()), { delay: 600 });
}
