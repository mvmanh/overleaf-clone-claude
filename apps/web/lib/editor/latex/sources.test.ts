import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectIndex } from '../../latex/project-index';
import { lintLatex } from './lint';
import { latexCompletionSource } from './sources';

let idx: ProjectIndex;

beforeEach(() => {
  idx = new ProjectIndex();
  idx.setFiles([
    'main.tex',
    'chapters/intro.tex',
    'refs.bib',
    'figures/plot.png',
    'figures/diagram.pdf',
    'fonts/x.otf',
  ]);
  idx.update(
    'refs.bib',
    `@book{taocp, author={Donald E. Knuth}, title={The Art of Computer Programming}, year={1968}}
     @article{dijkstra59, author={Edsger W. Dijkstra}, title={A note on two problems}, journal={Numer. Math.}, year={1959}}
     @inproceedings{knuth84, author={Knuth, Donald}, title={Literate Programming}, year={1984}}`,
  );
  idx.update(
    'chapters/intro.tex',
    '\\section{Intro}\\label{sec:intro}\n\\begin{equation}E=mc^2\\label{eq:energy}\\end{equation}',
  );
  idx.update(
    'main.tex',
    '\\usepackage{amsmath,cleveref}\\newcommand{\\R}{\\mathbb{R}}\\newtheorem{lemma}{Lemma}',
  );
});

function complete(docWithCursor: string, explicit = false): CompletionResult | null {
  const pos = docWithCursor.indexOf('|');
  const doc = docWithCursor.replace('|', '');
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  const source = latexCompletionSource({ index: () => idx, path: () => 'main.tex' });
  return source(new CompletionContext(state, pos, explicit));
}

const labels = (r: CompletionResult | null) => (r?.options ?? []).map((o) => o.label);
const top = (r: CompletionResult | null) =>
  [...(r?.options ?? [])].sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0)).map((o) => o.label);

describe('citations', () => {
  it('lists every key with author and year after \\cite{', () => {
    const r = complete('See \\cite{|}');
    expect(labels(r).sort()).toEqual(['dijkstra59', 'knuth84', 'taocp']);
    expect(r!.options.find((o) => o.label === 'taocp')!.detail).toBe('Knuth, 1968');
  });

  it('matches by author or title words, not only by key', () => {
    expect(labels(complete('\\citep{knuth|}'))).toEqual(['knuth84', 'taocp']);
    expect(labels(complete('\\parencite{literate|}'))).toEqual(['knuth84']);
    expect(labels(complete('\\textcite{dijk|}'))).toEqual(['dijkstra59']);
  });

  it('completes the key after a comma and with optional arguments', () => {
    const r = complete('\\cite[p.~3]{taocp, dij|}');
    expect(labels(r)).toEqual(['dijkstra59']);
    expect(r!.from).toBe('\\cite[p.~3]{taocp, '.length);
  });
});

describe('references and files', () => {
  it('lists labels from every file with their context', () => {
    const r = complete('see \\cref{|}');
    expect(labels(r)).toEqual(['sec:intro', 'eq:energy']);
    expect(r!.options[1]!.detail).toBe('equation · chapters/intro.tex:2');
  });

  it('offers only images for \\includegraphics and .tex for \\input', () => {
    expect(labels(complete('\\includegraphics[width=3cm]{|}'))).toEqual([
      'figures/diagram.pdf',
      'figures/plot.png',
    ]);
    expect(labels(complete('\\input{|}'))).toEqual(['chapters/intro.tex']);
    expect(labels(complete('\\include{|}'))).toEqual(['chapters/intro']);
    expect(labels(complete('\\addbibresource{|}'))).toEqual(['refs.bib']);
    expect(labels(complete('\\bibliography{|}'))).toEqual(['refs']);
  });

  it('suggests packages not yet loaded', () => {
    const l = labels(complete('\\usepackage{|}'));
    expect(l).toContain('siunitx');
    expect(l).not.toContain('amsmath');
  });
});

describe('environments', () => {
  it('offers catalogue and project environments after \\begin{', () => {
    const r = complete('\\begin{ali|}');
    expect(labels(r)).toEqual(expect.arrayContaining(['align', 'align*', 'figure', 'lemma']));
    expect(r!.options.find((o) => o.label === 'lemma')!.detail).toContain('project theorem');
  });

  it('closes the innermost open environment first', () => {
    const r = complete('\\begin{figure}\\begin{center}\n\\end{|}');
    expect(top(r)[0]).toBe('center');
  });

  it('suggests a label prefix from the surrounding environment', () => {
    expect(labels(complete('\\begin{equation}\n x \\label{|}'))).toEqual(['eq:']);
    expect(labels(complete('\\begin{figure}\\label{|}'))).toEqual(['fig:']);
    expect(complete('\\begin{figure}\\label{fig:x|}')).toBeNull();
  });

  it('offers float placements', () => {
    expect(labels(complete('\\begin{figure}[|'))).toContain('htbp');
  });
});

describe('commands', () => {
  it('ranks math symbols first in math and text commands first in text', () => {
    const inMath = top(complete('$x = \\t|$'));
    const inText = top(complete('Hello \\t|'));
    expect(inMath.indexOf('\\theta')).toBeLessThan(inMath.indexOf('\\textbf'));
    expect(inText.indexOf('\\textbf')).toBeLessThan(inText.indexOf('\\theta'));
  });

  it('includes project macros and marks commands that need a package', () => {
    const r = complete('$\\|$');
    const R = r!.options.find((o) => o.label === '\\R');
    expect(R?.detail).toBe('main.tex:1');
    expect(r!.options.find((o) => o.label === '\\mathbb')!.detail).toContain('+ amssymb');
    expect(r!.options.find((o) => o.label === '\\cref')!.detail).not.toContain('+');
  });
});

describe('word snippets', () => {
  it('appear at the start of a line, not mid-sentence (unless requested)', () => {
    expect(labels(complete('  fig|'))).toContain('fig');
    expect(complete('a nice fig|')).toBeNull();
    expect(labels(complete('a nice fig|', true))).toContain('fig');
  });

  it('math snippets appear anywhere inside math', () => {
    const l = labels(complete('$a + pm|$'));
    expect(l).toContain('pmat');
    expect(l).not.toContain('fig');
  });
});

describe('lintLatex', () => {
  const diag = (doc: string) =>
    lintLatex(doc, 'main.tex', idx).map((d) => `${d.severity}: ${d.message}`);

  it('reports environment nesting errors', () => {
    expect(diag('\\begin{itemize}\\end{enumerate}')[0]).toMatch(/closes \\begin\{itemize\}/);
    expect(diag('\\end{figure}')[0]).toMatch(/no matching/);
    expect(diag('\\begin{proof} x')[0]).toMatch(/never closed/);
    expect(diag('\\begin{verbatim}\\end{fake}\\end{verbatim}')).toEqual([]);
    expect(diag('% \\begin{figure}')).toEqual([]);
  });

  it('flags unknown labels and citation keys, but not known ones', () => {
    expect(diag('\\ref{sec:intro} \\eqref{eq:missing}')).toEqual([
      'warning: No \\label{eq:missing} in this project.',
    ]);
    expect(diag('\\cite{taocp,nobody}')).toEqual([
      'warning: No bibliography entry with key "nobody".',
    ]);
  });

  it('flags duplicate labels across files', () => {
    idx.update('main.tex', '\\label{sec:intro}');
    expect(diag('\\label{sec:intro}')[0]).toMatch(
      /more than once \(chapters\/intro.tex:1, main.tex:1\)/,
    );
  });

  it('does not check citations when the project has no bibliography', () => {
    const empty = new ProjectIndex();
    expect(lintLatex('\\cite{x}', 'main.tex', empty)).toEqual([]);
  });
});
