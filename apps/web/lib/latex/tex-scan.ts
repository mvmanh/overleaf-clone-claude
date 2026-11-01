/** Static facts about one .tex/.sty/.cls file, extracted without running TeX. */
export interface TexLabel {
  key: string;
  line: number;
  /** Environment or sectioning command the label belongs to (equation, figure, section…). */
  context: string;
  /** Trimmed source line, for previews. */
  preview: string;
}

export interface TexCommandDef {
  name: string;
  /** Number of arguments (from `[n]`). */
  args: number;
  /** Default of the optional first argument, if declared. */
  optionalDefault?: string;
  /** Replacement text (for previews and KaTeX macros). */
  body: string;
  line: number;
  kind: 'newcommand' | 'operator' | 'def';
}

export interface TexEnvironmentDef {
  name: string;
  /** `theorem` for \newtheorem, `environment` for \newenvironment. */
  kind: 'theorem' | 'environment';
  title?: string;
  args: number;
}

export interface TexScan {
  labels: TexLabel[];
  commands: TexCommandDef[];
  environments: TexEnvironmentDef[];
  packages: { name: string; options: string }[];
  /** Bibliography files referenced via \addbibresource / \bibliography. */
  bibResources: string[];
  /** Keys from \bibitem (thebibliography). */
  bibitems: string[];
  documentClass?: string;
}

/** Replaces comments with spaces, keeping offsets and line numbers intact. */
export function stripComments(src: string): string {
  return src.replace(
    /(^|[^\\])((?:\\\\)*)%[^\n]*/g,
    (m, pre: string, bs: string) => pre + bs + ' '.repeat(m.length - pre.length - bs.length),
  );
}

/** Reads a brace group starting at `i` (which must be `{`); returns [content, endIndex]. */
export function readGroup(src: string, i: number): [string, number] | null {
  if (src[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return [src.slice(i + 1, j), j + 1];
  }
  return null;
}

const SECTIONING =
  /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(\[[^\]]*\])?\s*\{/g;

export function scanTex(source: string): TexScan {
  const src = stripComments(source);
  const lines = source.split('\n');
  // Line lookup by binary search over precomputed line starts.
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const scan: TexScan = {
    labels: [],
    commands: [],
    environments: [],
    packages: [],
    bibResources: [],
    bibitems: [],
  };

  // Environment stack + last sectioning command, to give labels a context.
  type Marker = { at: number; kind: 'begin' | 'end' | 'section'; name: string };
  const markers: Marker[] = [];
  for (const m of src.matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
    markers.push({ at: m.index!, kind: m[1] as 'begin' | 'end', name: m[2]!.trim() });
  }
  for (const m of src.matchAll(SECTIONING))
    markers.push({ at: m.index!, kind: 'section', name: m[1]! });
  markers.sort((a, b) => a.at - b.at);

  const contextAt = (offset: number) => {
    const stack: string[] = [];
    let section = 'document';
    for (const mk of markers) {
      if (mk.at > offset) break;
      if (mk.kind === 'begin') stack.push(mk.name);
      else if (mk.kind === 'end') {
        const idx = stack.lastIndexOf(mk.name);
        if (idx >= 0) stack.splice(idx);
      } else section = mk.name;
    }
    const env = [...stack]
      .reverse()
      .find((e) => e !== 'document' && e !== 'center' && e !== 'minipage');
    return env ?? section;
  };

  for (const m of src.matchAll(/\\label\s*\{([^}]+)\}/g)) {
    const line = lineOf(m.index!);
    scan.labels.push({
      key: m[1]!.trim(),
      line,
      context: contextAt(m.index!),
      preview: (lines[line - 1] ?? '').trim().slice(0, 160),
    });
  }

  const defRe =
    /\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator)(\*?)\s*(\{\s*\\([A-Za-z@]+)\s*\}|\\([A-Za-z@]+))\s*(\[(\d)\])?\s*(\[([^\]]*)\])?\s*/g;
  for (const m of src.matchAll(defRe)) {
    const name = m[4] ?? m[5]!;
    const end = m.index! + m[0].length;
    const body = readGroup(src, end)?.[0] ?? '';
    const isOperator = m[1] === 'DeclareMathOperator';
    scan.commands.push({
      name,
      args: m[7] ? Number(m[7]) : 0,
      ...(m[9] !== undefined ? { optionalDefault: m[9] } : {}),
      body: isOperator ? `\\operatorname${m[2] ? '*' : ''}{${body}}` : body,
      line: lineOf(m.index!),
      kind: isOperator ? 'operator' : 'newcommand',
    });
  }
  for (const m of src.matchAll(/\\def\s*\\([A-Za-z@]+)((?:#\d)*)\s*(?=\{)/g)) {
    const body = readGroup(src, m.index! + m[0].length)?.[0] ?? '';
    scan.commands.push({
      name: m[1]!,
      args: (m[2] ?? '').length / 2,
      body,
      line: lineOf(m.index!),
      kind: 'def',
    });
  }

  for (const m of src.matchAll(/\\newtheorem\*?\s*\{([^}]+)\}\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g)) {
    scan.environments.push({ name: m[1]!.trim(), kind: 'theorem', title: m[2]!.trim(), args: 0 });
  }
  for (const m of src.matchAll(/\\(?:re)?newenvironment\*?\s*\{([^}]+)\}\s*(?:\[(\d)\])?/g)) {
    scan.environments.push({
      name: m[1]!.trim(),
      kind: 'environment',
      args: m[2] ? Number(m[2]) : 0,
    });
  }

  for (const m of src.matchAll(
    /\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g,
  )) {
    for (const name of m[2]!.split(',')) {
      const n = name.trim();
      if (n) scan.packages.push({ name: n, options: (m[1] ?? '').trim() });
    }
  }
  for (const m of src.matchAll(/\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g))
    scan.bibResources.push(m[1]!.trim());
  for (const m of src.matchAll(/\\bibliography\s*\{([^}]+)\}/g)) {
    for (const f of m[1]!.split(','))
      if (f.trim())
        scan.bibResources.push(f.trim().endsWith('.bib') ? f.trim() : `${f.trim()}.bib`);
  }
  for (const m of src.matchAll(/\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g))
    scan.bibitems.push(m[1]!.trim());
  const cls = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/.exec(src);
  if (cls) scan.documentClass = cls[1]!.trim();
  return scan;
}
