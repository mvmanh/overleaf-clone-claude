export interface BibEntry {
  key: string;
  /** Lower-case entry type, e.g. `article`. */
  type: string;
  fields: Record<string, string>;
  /** 1-based line of the `@type{` in the file. */
  line: number;
}

const SKIP_TYPES = new Set(['string', 'preamble', 'comment']);

/** Reads a braced or quoted value starting at `i`; returns [value, nextIndex]. */
function readValue(src: string, i: number): [string, number] {
  let out = '';
  for (;;) {
    while (/\s/.test(src[i] ?? '')) i++;
    const ch = src[i];
    if (ch === '{') {
      let depth = 0;
      const start = i + 1;
      for (; i < src.length; i++) {
        if (src[i] === '\\') {
          i++;
          continue;
        }
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
      }
      out += src.slice(start, i);
      i++;
    } else if (ch === '"') {
      const start = ++i;
      let depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        else if (src[i] === '"' && depth === 0) break;
      }
      out += src.slice(start, i);
      i++;
    } else {
      const m = /^[\w.:/+-]+/.exec(src.slice(i, i + 200));
      if (!m) return [out, i];
      out += m[0];
      i += m[0].length;
    }
    while (/\s/.test(src[i] ?? '')) i++;
    if (src[i] === '#') {
      i++;
      continue;
    }
    return [out, i];
  }
}

/** Collapses whitespace and strips braces used only for case protection. */
export function cleanBibValue(v: string): string {
  return v
    .replace(/\\[`'^"~=.uvHtcdbk]\{?(\w)\}?/g, '$1') // accents → base letter (good enough for display)
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tolerant BibTeX/biblatex parser for editor features. Never throws: a
 * malformed entry is skipped and parsing resumes at the next `@`.
 */
export function parseBib(src: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const re = /@\s*([A-Za-z]+)\s*([{(])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const type = m[1]!.toLowerCase();
    const line = src.slice(0, m.index).split('\n').length;
    let i = re.lastIndex;
    if (SKIP_TYPES.has(type)) continue;
    const keyMatch = /^\s*([^,\s{}()"#%~\\]+)\s*,/.exec(src.slice(i, i + 300));
    if (!keyMatch) continue;
    const key = keyMatch[1]!;
    i += keyMatch[0].length;
    const fields: Record<string, string> = {};
    const close = m[2] === '{' ? '}' : ')';
    for (let guard = 0; guard < 200 && i < src.length; guard++) {
      while (/[\s,]/.test(src[i] ?? '')) i++;
      if (src[i] === close || src[i] === '@' || i >= src.length) break;
      const f = /^([A-Za-z][\w-]*)\s*=\s*/.exec(src.slice(i, i + 100));
      if (!f) break;
      i += f[0].length;
      const [value, next] = readValue(src, i);
      if (next === i) break;
      fields[f[1]!.toLowerCase()] = cleanBibValue(value);
      i = next;
    }
    entries.push({ key, type, fields, line });
    re.lastIndex = Math.max(re.lastIndex, i);
  }
  return entries;
}

/** "Knuth", "Cormen et al." from a BibTeX author list. */
export function shortAuthors(author: string | undefined): string {
  if (!author) return '';
  const people = author.split(/\s+and\s+/i).map((p) => {
    const t = p.trim();
    if (t.includes(',')) return t.split(',')[0]!.trim();
    const parts = t.split(/\s+/);
    return parts[parts.length - 1] ?? t;
  });
  if (people.length === 1) return people[0]!;
  if (people.length === 2) return `${people[0]} & ${people[1]}`;
  return `${people[0]} et al.`;
}
