import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippet,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { extensionOf, isBinaryPath } from '@latex-cloud/shared';
import { shortAuthors } from '../../latex/bib';
import { type CommandSpec, COMMANDS } from '../../latex/data/commands';
import { ENVIRONMENTS, type EnvironmentSpec } from '../../latex/data/environments';
import {
  BIB_STYLES,
  DOCUMENT_CLASSES,
  FLOAT_PLACEMENTS,
  INCLUDEGRAPHICS_KEYS,
  LABEL_PREFIXES,
  PACKAGES,
  TIKZ_LIBRARIES,
} from '../../latex/data/packages';
import { WORD_SNIPPETS } from '../../latex/data/snippets';
import { mathContextAt, openEnvironments } from '../../latex/math-context';
import type { ProjectIndex } from '../../latex/project-index';
import { renderMathInto } from './katex';
import { usageBoost } from './settings';
import { withExit } from './snippet-text';

export interface SourceDeps {
  index: () => ProjectIndex;
  /** Path of the file being edited (labels in it rank first). */
  path: () => string;
}

export const CITE_COMMANDS = new Set([
  'cite',
  'cite*',
  'citep',
  'citep*',
  'citet',
  'citet*',
  'citealp',
  'citealt',
  'citeauthor',
  'citeyear',
  'citeyearpar',
  'nocite',
  'parencite',
  'Parencite',
  'textcite',
  'Textcite',
  'autocite',
  'Autocite',
  'footcite',
  'fullcite',
  'smartcite',
  'supercite',
  'cites',
  'parencites',
  'textcites',
  'citetitle',
  'citeurl',
  'Cite',
]);
export const REF_COMMANDS = new Set([
  'ref',
  'eqref',
  'pageref',
  'autoref',
  'Autoref',
  'nameref',
  'cref',
  'Cref',
  'cpageref',
  'Cpageref',
  'crefrange',
  'vref',
  'Vref',
  'labelcref',
  'subref',
  'hyperref',
]);
const COMMA_LISTS = new Set([
  ...CITE_COMMANDS,
  'cref',
  'Cref',
  'labelcref',
  'usepackage',
  'RequirePackage',
  'usetikzlibrary',
  'bibliography',
]);
const COLORS = [
  'red',
  'green',
  'blue',
  'cyan',
  'magenta',
  'yellow',
  'black',
  'gray',
  'white',
  'darkgray',
  'lightgray',
  'brown',
  'lime',
  'olive',
  'orange',
  'pink',
  'purple',
  'teal',
  'violet',
];

const div = (cls: string, text?: string) => {
  const el = document.createElement('div');
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

/** Replaces snippet fields with their placeholder names, for previews. */
function sampleFromSnippet(template: string): string {
  return template
    .replace(/[#$]\{(?:\d+:)?([^{}]*)\}/g, (_, name: string) => name || '\\square')
    .replace(/\\([{}])/g, '$1');
}

function commandInfo(spec: CommandSpec, macros: () => Record<string, string>): Completion['info'] {
  return () => {
    const box = div('lc-info');
    if (spec.math) {
      const math = div('lc-info__math');
      void renderMathInto(math, spec.snippet ? sampleFromSnippet(spec.snippet) : `\\${spec.name}`, {
        display: true,
        macros: macros(),
      });
      box.append(math);
    }
    box.append(div('lc-info__title', spec.detail || spec.category));
    const meta = [
      spec.category,
      spec.pkg ? `package: ${spec.pkg.replace(/^class:/, 'class ')}` : 'LaTeX kernel',
    ];
    box.append(div('lc-info__meta', meta.join(' · ')));
    return box;
  };
}

// ── Static option lists (built once) ───────────────────────────────────────

function commandOptions(inMath: boolean, idx: ProjectIndex): Completion[] {
  const loaded = idx.packages;
  const macros = () => idx.katexMacros();
  const seen = new Set<string>();
  const options: Completion[] = [];
  for (const spec of COMMANDS) {
    const label = `\\${spec.name}`;
    const key = `${label}|${spec.pkg ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const needsPkg =
      spec.pkg && !loaded.has(spec.pkg) && !(spec.pkg === 'amssymb' && loaded.has('amsfonts'));
    const modeFit = spec.math ? (inMath ? 3 : -2) : inMath ? -1 : 1;
    options.push({
      label,
      detail: [spec.glyph, needsPkg ? `+ ${spec.pkg!.replace(/^class:/, '')}` : '']
        .filter(Boolean)
        .join('  '),
      type: spec.math ? 'math' : spec.snippet ? 'function' : 'keyword',
      boost: Math.max(
        -99,
        Math.min(99, (spec.rank ?? 0) + modeFit + (needsPkg ? -3 : 0) + usageBoost(label)),
      ),
      info: commandInfo(spec, macros),
      ...(spec.snippet ? { apply: snippet(withExit(spec.snippet)) } : {}),
    });
  }
  // User-defined macros, with their definition as documentation.
  for (const c of idx.commands) {
    const label = `\\${c.name}`;
    const args = Array.from({ length: c.args }, (_, i) =>
      i === 0 && c.optionalDefault !== undefined ? `[\${${c.optionalDefault}}]` : `{\${#${i + 1}}}`,
    ).join('');
    options.push({
      label,
      detail: `${c.file}:${c.line}`,
      type: 'variable',
      section: { name: 'Project macros', rank: -1 },
      boost: 6 + usageBoost(label),
      info: () => {
        const box = div('lc-info');
        const math = div('lc-info__math');
        if (inMath || c.kind === 'operator') {
          const sample = `\\${c.name}${Array.from({ length: c.args }, (_, i) => `{${'xyzw'[i] ?? 'x'}}`).join('')}`;
          void renderMathInto(math, sample, { display: true, macros: idx.katexMacros() });
          box.append(math);
        }
        box.append(div('lc-info__code', `\\${c.name}${c.args ? `[${c.args}]` : ''} → ${c.body}`));
        box.append(div('lc-info__meta', `defined in ${c.file}:${c.line}`));
        return box;
      },
      ...(c.args ? { apply: snippet(withExit(`\\${c.name}${args}`)) } : {}),
    });
  }
  // Environment shortcuts from the command list: \begin… with full bodies.
  return options;
}

function environmentTemplate(env: Pick<EnvironmentSpec, 'name' | 'args' | 'body'>): string {
  return `\\begin{${env.name}}${env.args ?? ''}\n${env.body}\n\\end{${env.name}}`;
}

function environmentOptions(
  idx: ProjectIndex,
  inMath: boolean,
  beginStart: number,
  closeBrace: boolean,
): Completion[] {
  const loaded = idx.packages;
  const defined = new Map(idx.environments.map((e) => [e.name, e]));
  const opts: Completion[] = [];
  const add = (env: EnvironmentSpec, detail: string, boost: number) => {
    opts.push({
      label: env.name,
      detail,
      type: 'type',
      boost: Math.max(-99, Math.min(99, boost + usageBoost(`env:${env.name}`))),
      apply: (view: EditorView, completion: Completion, _from: number, to: number) => {
        const end = closeBrace && view.state.sliceDoc(to, to + 1) === '}' ? to + 1 : to;
        snippet(withExit(environmentTemplate(env)))(view, completion, beginStart, end);
      },
    });
  };
  for (const env of ENVIRONMENTS) {
    if (env.theoremLike) {
      // Defined in the project → offered below with its real title; otherwise a hint.
      if (!defined.has(env.name)) add(env, env.detail, (env.rank ?? 0) - 3);
      continue;
    }
    const needsPkg = env.pkg && !loaded.has(env.pkg);
    const fit = env.math ? (inMath ? 2 : 0) : inMath ? -2 : 1;
    add(
      env,
      needsPkg ? `${env.detail} · + ${env.pkg!.replace(/^class:/, '')}` : env.detail,
      (env.rank ?? 0) + fit - (needsPkg ? 2 : 0),
    );
  }
  for (const e of idx.environments) {
    if (ENVIRONMENTS.some((x) => x.name === e.name && !x.theoremLike)) continue;
    const prefix = LABEL_PREFIXES[e.name] ?? `${e.name.slice(0, 3)}:`;
    const body = e.kind === 'theorem' ? `\t\${}\n\t\\label{${prefix}\${label}}` : '\t${}';
    add(
      {
        name: e.name,
        detail: '',
        args:
          e.kind === 'theorem'
            ? '[${title}]'
            : Array.from({ length: e.args }, () => '{${}}').join(''),
        body,
      },
      e.kind === 'theorem' ? `${e.title} (project theorem)` : 'project environment',
      8,
    );
  }
  return opts;
}

// ── Argument contexts ─────────────────────────────────────────────────────

/** `\cmd[...]{...}{partial` — the command and the argument being typed. */
const ARG_CONTEXT = /\\([A-Za-z]+\*?)\s*((?:\[[^\]]*\]|\{[^{}]*\})*)\{([^{}]*)$/;

function citeOptions(idx: ProjectIndex, partial: string): Completion[] {
  const q = partial.toLowerCase();
  const scored: { c: Completion; score: number }[] = [];
  for (const e of idx.bibEntries) {
    const key = e.key.toLowerCase();
    const hay =
      `${e.fields.author ?? ''} ${e.fields.title ?? ''} ${e.fields.year ?? ''} ${e.fields.journal ?? e.fields.booktitle ?? ''}`.toLowerCase();
    let score = q === '' ? 1 : key.startsWith(q) ? 100 : key.includes(q) ? 60 : 0;
    if (!score && q) score = q.split(/\s+/).every((w) => hay.includes(w)) ? 30 : 0;
    if (!score) continue;
    const who = shortAuthors(e.fields.author || e.fields.editor);
    scored.push({
      score: score + usageBoost(`cite:${e.key}`) * 5,
      c: {
        label: e.key,
        detail: [who, e.fields.year].filter(Boolean).join(', '),
        type: 'cite',
        info: () => {
          const box = div('lc-info lc-info--cite');
          box.append(div('lc-info__title', e.fields.title || '(untitled)'));
          if (e.fields.author) box.append(div('lc-info__authors', e.fields.author));
          const venue =
            e.fields.journal ||
            e.fields.booktitle ||
            e.fields.publisher ||
            e.fields.school ||
            e.fields.howpublished;
          box.append(
            div('lc-info__meta', [venue, e.fields.year, e.type].filter(Boolean).join(' · ')),
          );
          box.append(div('lc-info__meta', e.line ? `${e.file}:${e.line}` : e.file));
          return box;
        },
      },
    });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 200)
    .map((s, i) => ({ ...s.c, boost: 99 - Math.min(i, 198) }));
}

function labelOptions(idx: ProjectIndex, currentPath: string): Completion[] {
  return idx.labels.map((l) => ({
    label: l.key,
    detail: `${l.context} · ${l.file}:${l.line}`,
    type: 'label',
    boost: (l.file === currentPath ? 2 : 0) + usageBoost(`ref:${l.key}`),
    info: () => {
      const box = div('lc-info');
      box.append(div('lc-info__code', l.preview));
      box.append(div('lc-info__meta', `${l.context} in ${l.file}, line ${l.line}`));
      return box;
    },
  }));
}

function fileOptions(
  paths: readonly string[],
  filter: (p: string) => boolean,
  stripExt: boolean,
  detail: string,
): Completion[] {
  return paths.filter(filter).map((p) => ({
    label: stripExt ? p.replace(/\.(tex|bib)$/, '') : p,
    detail,
    type: 'file',
  }));
}

function argumentCompletions(
  context: CompletionContext,
  before: string,
  deps: SourceDeps,
): CompletionResult | null {
  const m = ARG_CONTEXT.exec(before);
  if (!m) return null;
  const cmd = m[1]!;
  const partial = m[3]!;
  const idx = deps.index();
  const commaList = COMMA_LISTS.has(cmd.replace(/\*$/, '')) || COMMA_LISTS.has(cmd);
  const tail = commaList
    ? partial.slice(partial.lastIndexOf(',') + 1).replace(/^\s+/, '')
    : partial;
  const from = context.pos - tail.length;
  const base = cmd.replace(/\*$/, '');

  if (CITE_COMMANDS.has(cmd) || CITE_COMMANDS.has(base)) {
    const options = citeOptions(idx, tail);
    if (!options.length && !idx.bibEntries.length) {
      return {
        from,
        options: [
          {
            label: tail || ' ',
            displayLabel: 'No bibliography entries in this project yet',
            detail: 'add a .bib file',
            apply: tail,
            type: 'text',
          },
        ],
        filter: false,
      };
    }
    return { from, options, filter: false };
  }
  if (REF_COMMANDS.has(base))
    return { from, options: labelOptions(idx, deps.path()), validFor: /^[^,}\s]*$/ };
  switch (base) {
    case 'begin': {
      const inMath = mathContextAt(context.state.doc.toString(), context.pos).inMath;
      const beginStart = context.pos - partial.length - '\\begin{'.length;
      return {
        from,
        options: environmentOptions(idx, inMath, beginStart, true),
        validFor: /^[\w*]*$/,
      };
    }
    case 'end': {
      const open = openEnvironments(context.state.doc.toString(), context.pos).reverse();
      return {
        from,
        options: open.map((name, i) => ({
          label: name,
          detail: i === 0 ? 'innermost open environment' : 'open environment',
          type: 'type',
          boost: 99 - i,
        })),
        validFor: /^[\w*]*$/,
      };
    }
    case 'input':
    case 'include':
    case 'subfile':
    case 'includeonly':
      return {
        from,
        options: fileOptions(
          idx.files,
          (p) => extensionOf(p) === 'tex' && p !== deps.path(),
          base !== 'input',
          'TeX file',
        ),
        validFor: /^[^}]*$/,
      };
    case 'includegraphics':
    case 'includepdf':
    case 'includesvg':
      return {
        from,
        options: fileOptions(
          idx.files,
          (p) => isBinaryPath(p) && !/\.(ttf|otf)$/i.test(p),
          false,
          'image',
        ).map((o) => ({ ...o, type: 'image' })),
        validFor: /^[^}]*$/,
      };
    case 'addbibresource':
      return {
        from,
        options: fileOptions(idx.files, (p) => p.endsWith('.bib'), false, 'bibliography'),
        validFor: /^[^}]*$/,
      };
    case 'bibliography':
      return {
        from,
        options: fileOptions(idx.files, (p) => p.endsWith('.bib'), true, 'bibliography'),
        validFor: /^[^,}]*$/,
      };
    case 'usepackage':
    case 'RequirePackage':
      return {
        from,
        options: PACKAGES.filter(([name]) => !idx.packages.has(name) || name === tail).map(
          ([label, detail]) => ({ label, detail, type: 'package' }),
        ),
        validFor: /^[\w-]*$/,
      };
    case 'documentclass':
      return {
        from,
        options: DOCUMENT_CLASSES.map(([label, detail]) => ({ label, detail, type: 'class' })),
        validFor: /^[\w-]*$/,
      };
    case 'usetikzlibrary':
      return {
        from,
        options: TIKZ_LIBRARIES.map((label) => ({ label, type: 'package' })),
        validFor: /^[\w.-]*$/,
      };
    case 'bibliographystyle':
      return {
        from,
        options: BIB_STYLES.map((label) => ({ label, type: 'class' })),
        validFor: /^[\w-]*$/,
      };
    case 'textcolor':
    case 'color':
    case 'colorbox':
      return m[2]
        ? null
        : {
            from,
            options: COLORS.map((label) => ({ label, type: 'constant' })),
            validFor: /^\w*$/,
          };
    case 'label': {
      const doc = context.state.doc.toString();
      const env = openEnvironments(doc, context.pos)
        .reverse()
        .find((e) => LABEL_PREFIXES[e]);
      let prefix = env ? LABEL_PREFIXES[env] : undefined;
      if (!prefix) {
        const sec = /\\(part|chapter|section|subsection|subsubsection)\*?\s*\{[^}]*\}\s*$/.exec(
          doc.slice(Math.max(0, context.pos - 400), context.pos - partial.length - 7),
        );
        prefix = sec ? LABEL_PREFIXES[sec[1]!] : undefined;
      }
      if (!prefix || partial.includes(':')) return null;
      return {
        from,
        options: [
          {
            label: prefix,
            detail: `suggested prefix for ${env ?? 'this section'}`,
            type: 'label',
            boost: 99,
          },
        ],
        validFor: /^[^:}]*$/,
      };
    }
    default:
      return null;
  }
}

function bracketCompletions(context: CompletionContext, before: string): CompletionResult | null {
  const place = /\\begin\{(figure|table|figure\*|table\*|algorithm|wrapfigure)\}\[([^\]]*)$/.exec(
    before,
  );
  if (place) {
    return {
      from: context.pos - place[2]!.length,
      options: FLOAT_PLACEMENTS.map(([label, detail]) => ({ label, detail, type: 'constant' })),
      validFor: /^[!htbpH]*$/,
    };
  }
  const gfx = /\\includegraphics\[([^\]]*)$/.exec(before);
  if (gfx) {
    const tail = gfx[1]!.slice(gfx[1]!.lastIndexOf(',') + 1).replace(/^\s+/, '');
    return {
      from: context.pos - tail.length,
      options: INCLUDEGRAPHICS_KEYS.map(([label, detail]) => ({ label, detail, type: 'property' })),
    };
  }
  const cls = /\\documentclass\[([^\]]*)$/.exec(before);
  if (cls) {
    const tail = cls[1]!.slice(cls[1]!.lastIndexOf(',') + 1).replace(/^\s+/, '');
    return {
      from: context.pos - tail.length,
      options: [
        '10pt',
        '11pt',
        '12pt',
        'a4paper',
        'letterpaper',
        'twocolumn',
        'twoside',
        'draft',
        'final',
        'landscape',
        'reqno',
        'leqno',
        'fleqn',
        'titlepage',
      ].map((label) => ({ label, type: 'property' })),
    };
  }
  return null;
}

function snippetOptions(mode: 'text' | 'math'): Completion[] {
  return WORD_SNIPPETS.filter((s) => s.mode === mode).map((s) => ({
    label: s.prefix,
    displayLabel: s.prefix,
    detail: s.label,
    type: 'snippet',
    section: { name: 'Snippets', rank: 1 },
    boost: 4 + usageBoost(`snip:${s.prefix}`),
    apply: snippet(withExit(s.body)),
    info: () => {
      const box = div('lc-info');
      const pre = document.createElement('pre');
      pre.className = 'lc-info__pre';
      pre.textContent = sampleFromSnippet(s.body).replace(/\\square/g, '…');
      box.append(div('lc-info__title', `${s.label} — snippet`), pre);
      return box;
    },
  }));
}

/** The LaTeX completion source (registered via languageData `autocomplete`). */
export function latexCompletionSource(deps: SourceDeps) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);

    // 1. \command names (including partial names typed inside arguments).
    const cmd = /\\[A-Za-z@]*\*?$/.exec(before);
    if (cmd && !/\\\\[A-Za-z@]*\*?$/.test(before.slice(-cmd[0].length - 1))) {
      const inMath = mathContextAt(context.state.doc.toString(), context.pos).inMath;
      return {
        from: context.pos - cmd[0].length,
        options: commandOptions(inMath, deps.index()),
        validFor: /^\\[A-Za-z@]*\*?$/,
      };
    }

    // 2. Inside an argument: keys, labels, files, packages, environments…
    const arg = argumentCompletions(context, before, deps);
    if (arg) return arg;
    const bracket = bracketCompletions(context, before);
    if (bracket) return bracket;

    // 3. Word snippets: at the start of a line (text), anywhere in math, or on Ctrl+Space.
    const word = /[A-Za-z][A-Za-z*]*$/.exec(before);
    if (!word) return null;
    const ctx = mathContextAt(context.state.doc.toString(), context.pos);
    const atLineStart = /^\s*$/.test(before.slice(0, before.length - word[0].length));
    if (!context.explicit && !ctx.inMath && !atLineStart) return null;
    if (!context.explicit && word[0].length < 2) return null;
    return {
      from: context.pos - word[0].length,
      options: snippetOptions(ctx.inMath ? 'math' : 'text'),
      validFor: /^[A-Za-z*]*$/,
    };
  };
}
