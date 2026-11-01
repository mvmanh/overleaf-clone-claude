import type { Diagnostic } from '@latex-cloud/compiler-protocol';

export interface ParseOptions {
  /**
   * Absolute directories the compile ran in (e.g. `/work/src`). Paths under
   * them are rewritten to project-relative form; other absolute paths (TeX
   * Live's own files) are dropped from `file` so internals are not leaked.
   */
  workspaceRoots?: readonly string[];
  /** Parse at most this many characters of log (logs are untrusted input). */
  maxLogChars?: number;
  maxDiagnostics?: number;
}

const DEFAULT_MAX_LOG_CHARS = 4 * 1024 * 1024;
const DEFAULT_MAX_DIAGNOSTICS = 200;

/** `path:line: message` as produced by `-file-line-error`. */
const FILE_LINE_ERROR = /^(.*?\.(?:tex|sty|cls|bib|bbl|ltx|dtx|def|cfg|clo|aux|toc)):(\d+): (.+)$/;
const BANG_ERROR = /^! (.+)$/;
const LINE_MARKER = /^l\.(\d+)(?: (.*))?$/;
const INPUT_LINE = /on input line (\d+)\.?/;
const LATEX_WARNING = /^(?:LaTeX|Package (\S+)|Class (\S+)) Warning: (.+)$/;
const BOX_WARNING =
  /^((?:Over|Under)full \\[hv]box .*?) (?:in paragraph |in alignment |detected )at lines? (\d+)(?:--\d+)?/;
const CONTINUATION = /^\((\S+)\)\s+(.*)$/;
/** Messages TeX emits after the real error; noise once an error is known. */
const FOLLOW_ON = /^(Emergency stop|==> Fatal error occurred)/;

interface Classifier {
  test: RegExp;
  code: string;
  hint?: string;
}

const CLASSIFIERS: Classifier[] = [
  {
    test: /Undefined control sequence/,
    code: 'undefined-control-sequence',
    hint: 'Check the command spelling, or load the package that defines it.',
  },
  {
    test: /File `([^']+)' not found/,
    code: 'missing-file',
    hint: 'Check the file name and that it is uploaded to the project (paths are case-sensitive).',
  },
  {
    test: /Missing \$ inserted/,
    code: 'missing-math-delimiter',
    hint: 'A math-only command was used outside math mode, or a $ is unbalanced.',
  },
  {
    test: /Environment (\S+) undefined/,
    code: 'undefined-environment',
    hint: 'Load the package that provides this environment.',
  },
  {
    test: /\\begin\{[^}]+\} on input line \d+ ended by \\end/,
    code: 'mismatched-environment',
  },
  { test: /Emergency stop/, code: 'emergency-stop' },
  {
    test: /Runaway argument/,
    code: 'runaway-argument',
    hint: 'A closing brace is probably missing.',
  },
  { test: /Too many \}'s|Extra \}, or forgotten/, code: 'unbalanced-braces' },
  {
    test: /I can't write on file|Not writing to .* \(openout_any = p\)/,
    code: 'write-denied',
    hint: 'Documents may only write files inside the project build directory.',
  },
  {
    test: /\\write18|shell escape/i,
    code: 'shell-escape-denied',
    hint: 'Shell escape is disabled for security.',
  },
  { test: /Citation `[^']+' .*undefined/, code: 'undefined-citation' },
  { test: /Reference `[^']+' .*undefined/, code: 'undefined-reference' },
];

function classify(message: string): Pick<Diagnostic, 'code' | 'hint'> {
  for (const c of CLASSIFIERS) {
    if (c.test.test(message)) return c.hint ? { code: c.code, hint: c.hint } : { code: c.code };
  }
  return {};
}

function normaliseFile(raw: string, roots: readonly string[]): string | undefined {
  let p = raw.trim();
  for (const root of roots) {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    if (p.startsWith(prefix)) {
      p = p.slice(prefix.length);
      break;
    }
  }
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('/') || p.includes('..')) return undefined;
  return p.length > 0 ? p : undefined;
}

/** Turns a raw TeX/latexmk log into structured diagnostics. Never throws. */
export function parseTexLog(log: string, options: ParseOptions = {}): Diagnostic[] {
  const roots = options.workspaceRoots ?? [];
  const maxDiagnostics = options.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS;
  const text = log.slice(0, options.maxLogChars ?? DEFAULT_MAX_LOG_CHARS);
  const lines = text.split(/\r?\n/);
  const out: Diagnostic[] = [];
  const seen = new Set<string>();

  const push = (d: Diagnostic): void => {
    const key = `${d.severity}|${d.file ?? ''}|${d.line ?? ''}|${d.message}`;
    if (seen.has(key) || out.length >= maxDiagnostics) return;
    seen.add(key);
    out.push(d);
  };

  for (let i = 0; i < lines.length && out.length < maxDiagnostics; i++) {
    const line = lines[i]!;

    const fle = FILE_LINE_ERROR.exec(line);
    if (fle) {
      const message = fle[3]!.trim();
      if (FOLLOW_ON.test(message) && out.some((d) => d.severity === 'error')) continue;
      const file = normaliseFile(fle[1]!, roots);
      const excerpt = lines.slice(i, i + 4).join('\n');
      push({
        severity: 'error',
        message,
        ...(file ? { file } : {}),
        line: Number(fle[2]),
        excerpt,
        ...classify(message),
      });
      continue;
    }

    const bang = BANG_ERROR.exec(line);
    if (bang) {
      const message = bang[1]!.trim();
      if (FOLLOW_ON.test(message) && out.some((d) => d.severity === 'error')) continue;
      let lineNo: number | undefined;
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const m = LINE_MARKER.exec(lines[j]!);
        if (m) {
          lineNo = Number(m[1]);
          break;
        }
      }
      push({
        severity: 'error',
        message,
        ...(lineNo ? { line: lineNo } : {}),
        excerpt: lines.slice(i, i + 4).join('\n'),
        ...classify(message),
      });
      continue;
    }

    const warn = LATEX_WARNING.exec(line);
    if (warn) {
      let message = warn[3]!.trim();
      // Package warnings continue on following lines prefixed with `(pkg)`.
      for (let j = i + 1; j < lines.length; j++) {
        const cont = CONTINUATION.exec(lines[j]!);
        if (!cont) break;
        message += ` ${cont[2]!.trim()}`;
        i = j;
      }
      const source = warn[1] ?? warn[2];
      const lineMatch = INPUT_LINE.exec(message);
      push({
        severity: 'warning',
        message: source ? `${source}: ${message}` : message,
        ...(lineMatch ? { line: Number(lineMatch[1]) } : {}),
        ...classify(message),
      });
      continue;
    }

    const box = BOX_WARNING.exec(line);
    if (box) {
      push({ severity: 'info', message: box[1]!, line: Number(box[2]), code: 'bad-box' });
    }
  }
  return out;
}
