import { stripComments } from './tex-scan';

/** Environments whose body is math mode. */
export const MATH_ENVIRONMENTS = new Set(
  [
    'equation',
    'align',
    'gather',
    'multline',
    'flalign',
    'alignat',
    'eqnarray',
    'math',
    'displaymath',
    'dmath',
    'dgroup',
    'darray',
    'empheq',
    'IEEEeqnarray',
  ].flatMap((e) => [e, `${e}*`]),
);

/** Commands whose braced argument is text even inside math. */
const TEXT_IN_MATH =
  /^\\(text|textrm|textit|textbf|textsf|texttt|textup|textnormal|mbox|hbox|intertext|shortintertext|operatorname\*?|label|ref|eqref|tag\*?)\s*\{/;

export type MathKind = 'inline' | 'display' | 'environment';

export interface MathContext {
  inMath: boolean;
  kind?: MathKind;
  /** Environment name when kind is 'environment'. */
  environment?: string;
  /** Offset where the math content starts (after the opening delimiter). */
  start?: number;
}

/**
 * Decides whether `pos` is in math mode by scanning the document prefix the way
 * TeX would ($, $$, \( \), \[ \], math environments, \text{} inside math).
 * Inline math does not survive a blank line (TeX would error there anyway).
 */
export function mathContextAt(doc: string, pos: number): MathContext {
  const s = stripComments(doc.slice(0, pos));
  let closer: string | null = null;
  let kind: MathKind | undefined;
  let env: string | undefined;
  let start = 0;
  let depth = 0;
  const textStack: number[] = [];
  const exit = () => {
    closer = null;
    kind = undefined;
    env = undefined;
    textStack.length = 0;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\') {
      const rest = s.slice(i, i + 40);
      const n = s[i + 1];
      if (closer === null && n === '(') {
        closer = '\\)';
        kind = 'inline';
        start = i + 2;
        i++;
        continue;
      }
      if (closer === null && n === '[') {
        closer = '\\]';
        kind = 'display';
        start = i + 2;
        i++;
        continue;
      }
      if ((n === ')' && closer === '\\)') || (n === ']' && closer === '\\]')) {
        exit();
        i++;
        continue;
      }
      const be = /^\\(begin|end)\s*\{([^}]*)\}/.exec(rest);
      if (be) {
        const name = be[2]!.trim();
        if (be[1] === 'begin' && closer === null && MATH_ENVIRONMENTS.has(name)) {
          closer = `env:${name}`;
          kind = 'environment';
          env = name;
          start = i + be[0].length;
        } else if (be[1] === 'end' && closer === `env:${name}`) {
          exit();
        }
        i += be[0].length - 1;
        continue;
      }
      if (closer !== null && textStack.length === 0) {
        const t = TEXT_IN_MATH.exec(rest);
        if (t) {
          depth++;
          textStack.push(depth);
          i += t[0].length - 1;
          continue;
        }
      }
      // Skip the command name or the escaped character (\$, \{, \\ …).
      const name = /^\\([A-Za-z@]+|.)/.exec(rest);
      i += (name?.[0].length ?? 1) - 1;
      continue;
    }
    if (c === '{') {
      depth++;
      continue;
    }
    if (c === '}') {
      if (textStack.length && textStack[textStack.length - 1] === depth) textStack.pop();
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (c === '$') {
      if (textStack.length) continue; // `$` inside \text{} starts nested math: ignore for simplicity
      if (s[i + 1] === '$') {
        if (closer === null) {
          closer = '$$';
          kind = 'display';
          start = i + 2;
        } else if (closer === '$$') exit();
        i++;
      } else if (closer === null) {
        closer = '$';
        kind = 'inline';
        start = i + 1;
      } else if (closer === '$') exit();
      continue;
    }
    if (
      c === '\n' &&
      (closer === '$' || closer === '\\)') &&
      /^\n[ \t]*\n/.test(s.slice(i, i + 40))
    )
      exit();
  }
  if (closer === null || textStack.length) return { inMath: false };
  return { inMath: true, kind, ...(env ? { environment: env } : {}), start };
}

/** Environments opened before `pos` and not yet closed (innermost last). */
export function openEnvironments(doc: string, pos: number): string[] {
  const s = stripComments(doc.slice(0, pos));
  const stack: string[] = [];
  for (const m of s.matchAll(/\\(begin|end)\s*\{([^}]*)\}/g)) {
    const name = m[2]!.trim();
    if (m[1] === 'begin') stack.push(name);
    else {
      const idx = stack.lastIndexOf(name);
      if (idx >= 0) stack.splice(idx);
    }
  }
  return stack;
}
