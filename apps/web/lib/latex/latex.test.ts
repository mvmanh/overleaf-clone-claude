import { describe, expect, it } from 'vitest';
import { cleanBibValue, parseBib, shortAuthors } from './bib';
import { mathContextAt, openEnvironments } from './math-context';
import { scanTex, stripComments } from './tex-scan';

describe('parseBib', () => {
  it('parses braced, quoted, numeric and concatenated values', () => {
    const bib = `
% a comment
@string{acm = "ACM Press"}
@Article{knuth:1984,
  author = {Donald E. Knuth and {Leslie} Lamport},
  title  = "Literate {P}rogramming",
  year   = 1984,
  journal = acm # " Journal",
}
@inproceedings( dijkstra59 , title={A note on {two} problems}, booktitle={Numer. Math.} )
@comment{ ignored @book{fake, title={x}} }
`;
    const entries = parseBib(bib);
    expect(entries.map((e) => e.key)).toEqual(['knuth:1984', 'dijkstra59', 'fake']);
    const k = entries[0]!;
    expect(k).toMatchObject({ type: 'article', line: 4 });
    expect(k.fields).toMatchObject({
      title: 'Literate Programming',
      year: '1984',
      author: 'Donald E. Knuth and Leslie Lamport',
    });
    expect(entries[1]!.fields.title).toBe('A note on two problems');
  });

  it('survives malformed input', () => {
    expect(() =>
      parseBib('@article{broken, title={unclosed\n@book{ok, title={Fine}}'),
    ).not.toThrow();
    expect(parseBib('@book{ok2, title={Fine}}').map((e) => e.key)).toEqual(['ok2']);
    expect(parseBib('')).toEqual([]);
  });

  it('formats authors and accents for display', () => {
    expect(shortAuthors('Knuth, Donald E.')).toBe('Knuth');
    expect(shortAuthors('Thomas H. Cormen and Charles E. Leiserson')).toBe('Cormen & Leiserson');
    expect(shortAuthors('A and B and C')).toBe('A et al.');
    expect(cleanBibValue('Erd{\\H{o}}s and {G}\\"odel')).toBe('Erdos and Godel');
  });
});

describe('scanTex', () => {
  const tex = String.raw`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage{amsmath, amsthm,cleveref}
\addbibresource{refs.bib}
\bibliography{other,more.bib}
\newcommand{\R}{\mathbb{R}}
\newcommand\norm[1]{\left\lVert#1\right\rVert}
\newcommand{\pr}[2][P]{#1(#2)}
\DeclareMathOperator*{\argmax}{arg\,max}
\def\eps{\varepsilon}
\newtheorem{lemma}[theorem]{Lemma}
\newenvironment{note}[1]{\par}{\par}
% \label{commented}
\begin{document}
\section{Intro}\label{sec:intro}
\begin{equation}
  E = mc^2 \label{eq:emc}
\end{equation}
\begin{figure}\centering\caption{X}\label{fig:x}\end{figure}
\bibitem{manual}
\end{document}`;
  const s = scanTex(tex);

  it('finds labels with context and line, ignoring comments', () => {
    expect(s.labels.map((l) => [l.key, l.context, l.line])).toEqual([
      ['sec:intro', 'section', 15],
      ['eq:emc', 'equation', 17],
      ['fig:x', 'figure', 19],
    ]);
  });

  it('finds macro definitions with arity and defaults', () => {
    const byName = Object.fromEntries(s.commands.map((c) => [c.name, c]));
    expect(byName.R).toMatchObject({ args: 0, body: '\\mathbb{R}' });
    expect(byName.norm).toMatchObject({ args: 1 });
    expect(byName.pr).toMatchObject({ args: 2, optionalDefault: 'P' });
    expect(byName.argmax).toMatchObject({ kind: 'operator', body: '\\operatorname*{arg\\,max}' });
    expect(byName.eps).toMatchObject({ kind: 'def', body: '\\varepsilon' });
  });

  it('finds environments, packages, bibliographies and class', () => {
    expect(s.environments).toEqual([
      { name: 'lemma', kind: 'theorem', title: 'Lemma', args: 0 },
      { name: 'note', kind: 'environment', args: 1 },
    ]);
    expect(s.packages.map((p) => p.name)).toEqual(['inputenc', 'amsmath', 'amsthm', 'cleveref']);
    expect(s.bibResources).toEqual(['refs.bib', 'other.bib', 'more.bib']);
    expect(s.bibitems).toEqual(['manual']);
    expect(s.documentClass).toBe('article');
  });

  it('strips comments but keeps escaped percent signs and offsets', () => {
    const t = 'a\\% b % c\nd';
    expect(stripComments(t)).toBe('a\\% b    \nd');
    expect(stripComments(t)).toHaveLength(t.length);
  });
});

describe('mathContextAt', () => {
  const at = (doc: string) => mathContextAt(doc.replace('|', ''), doc.indexOf('|'));

  it.each([
    ['text $x|$', true],
    ['text $x$ |', false],
    ['$$ a + |', true],
    ['\\( a |', true],
    ['\\[ a \\] |', false],
    ['\\begin{align*} x &= |', true],
    ['\\begin{align} x \\end{align} |', false],
    ['$ \\text{for all |', false],
    ['$ \\text{a} + |', true],
    ['price \\$5 and |', false],
    ['% $ comment\n|', false],
    ['$ a\n\nb |', false],
    ['\\begin{equation}\\begin{cases} a |', true],
    ['$\\operatorname{rank}(A) = |', true],
  ])('%j → %s', (doc, expected) => {
    expect(at(doc).inMath).toBe(expected);
  });

  it('reports the kind and environment', () => {
    expect(at('\\begin{gather*} |')).toMatchObject({
      inMath: true,
      kind: 'environment',
      environment: 'gather*',
    });
    expect(at('$|')).toMatchObject({ kind: 'inline' });
  });
});

describe('openEnvironments', () => {
  it('returns unclosed environments innermost last', () => {
    const doc = '\\begin{document}\\begin{itemize}\\item a\\begin{enumerate}\\end{enumerate}';
    expect(openEnvironments(doc, doc.length)).toEqual(['document', 'itemize']);
  });
});

describe('ProjectIndex', () => {
  it('aggregates across files and reflects live updates', async () => {
    const { ProjectIndex } = await import('./project-index');
    const idx = new ProjectIndex();
    idx.setFiles(['main.tex', 'chap/one.tex', 'refs.bib', 'fig.png']);
    idx.update('refs.bib', '@book{knuth, author={Knuth}, title={TAOCP}, year={1968}}');
    idx.update('main.tex', '\\usepackage{amsmath}\\newcommand{\\R}{\\mathbb{R}}\\label{main}');
    idx.update('chap/one.tex', '\\section{A}\\label{sec:a}\\bibitem{local}');
    expect(idx.bibEntries.map((e) => e.key).sort()).toEqual(['knuth', 'local']);
    expect(idx.labels.map((l) => `${l.file}:${l.key}`)).toEqual([
      'main.tex:main',
      'chap/one.tex:sec:a',
    ]);
    expect(idx.packages.has('amsmath')).toBe(true);
    expect(idx.katexMacros()).toEqual({ '\\R': '\\mathbb{R}' });

    let calls = 0;
    idx.subscribe(() => calls++);
    idx.update('chap/one.tex', '\\label{sec:b}');
    expect(idx.labels.map((l) => l.key)).toEqual(['main', 'sec:b']);
    idx.setFiles(['main.tex']);
    expect(idx.bibEntries).toEqual([]);
    expect(calls).toBe(2);
  });
});
