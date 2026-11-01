/**
 * Word-triggered snippets (VS Code style): type the prefix at the start of a
 * line (or anywhere in math for math snippets) and pick it from the list, or
 * press Tab right after the prefix.
 */
export interface WordSnippet {
  prefix: string;
  label: string;
  body: string;
  mode: 'text' | 'math';
  category: string;
}

const T = '\t';
const env = (name: string, inner: string, args = '') =>
  `\\begin{${name}}${args}\n${inner}\n\\end{${name}}`;

export const WORD_SNIPPETS: readonly WordSnippet[] = [
  // Document skeletons
  {
    prefix: 'article',
    label: 'Article skeleton',
    category: 'Document',
    mode: 'text',
    body: `\\documentclass[11pt]{article}\n\\usepackage{amsmath,amssymb,amsthm}\n\\usepackage{graphicx}\n\\usepackage{hyperref}\n\n\\title{\${Title}}\n\\author{\${Author}}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{\${Introduction}}\n\${}\n\n\\end{document}`,
  },
  {
    prefix: 'beamer',
    label: 'Beamer presentation skeleton',
    category: 'Document',
    mode: 'text',
    body: `\\documentclass{beamer}\n\\usetheme{\${metropolis}}\n\\title{\${Title}}\n\\author{\${Author}}\n\n\\begin{document}\n\\begin{frame}\n${T}\\titlepage\n\\end{frame}\n\n\\begin{frame}{\${First slide}}\n${T}\${}\n\\end{frame}\n\\end{document}`,
  },
  {
    prefix: 'pkg',
    label: '\\usepackage{…}',
    category: 'Document',
    mode: 'text',
    body: '\\usepackage{${package}}',
  },
  {
    prefix: 'mathpkgs',
    label: 'Math package set',
    category: 'Document',
    mode: 'text',
    body: '\\usepackage{amsmath,amssymb,amsthm,mathtools}\n\\newtheorem{theorem}{Theorem}[section]\n\\newtheorem{lemma}[theorem]{Lemma}\n\\newtheorem{proposition}[theorem]{Proposition}\n\\newtheorem{corollary}[theorem]{Corollary}\n\\theoremstyle{definition}\n\\newtheorem{definition}[theorem]{Definition}\n\\theoremstyle{remark}\n\\newtheorem{remark}[theorem]{Remark}',
  },
  {
    prefix: 'geom',
    label: 'Page margins (geometry)',
    category: 'Document',
    mode: 'text',
    body: '\\usepackage[margin=${2.5cm}]{geometry}',
  },
  {
    prefix: 'biblatex',
    label: 'biblatex setup',
    category: 'Document',
    mode: 'text',
    body: '\\usepackage[backend=biber,style=${numeric}]{biblatex}\n\\addbibresource{${references.bib}}',
  },
  {
    prefix: 'newcmd',
    label: '\\newcommand',
    category: 'Document',
    mode: 'text',
    body: '\\newcommand{\\${name}}[${1}]{${#1}}',
  },
  {
    prefix: 'newthm',
    label: '\\newtheorem',
    category: 'Document',
    mode: 'text',
    body: '\\newtheorem{${theorem}}{${Theorem}}[${section}]',
  },
  {
    prefix: 'mathop',
    label: '\\DeclareMathOperator',
    category: 'Document',
    mode: 'text',
    body: '\\DeclareMathOperator{\\${rank}}{${rank}}',
  },
  // Sectioning
  {
    prefix: 'part',
    label: 'Part',
    category: 'Structure',
    mode: 'text',
    body: '\\part{${title}}\n\\label{part:${label}}',
  },
  {
    prefix: 'chap',
    label: 'Chapter',
    category: 'Structure',
    mode: 'text',
    body: '\\chapter{${title}}\n\\label{ch:${label}}\n${}',
  },
  {
    prefix: 'sec',
    label: 'Section',
    category: 'Structure',
    mode: 'text',
    body: '\\section{${title}}\n\\label{sec:${label}}\n${}',
  },
  {
    prefix: 'ssec',
    label: 'Subsection',
    category: 'Structure',
    mode: 'text',
    body: '\\subsection{${title}}\n\\label{sec:${label}}\n${}',
  },
  {
    prefix: 'sssec',
    label: 'Subsubsection',
    category: 'Structure',
    mode: 'text',
    body: '\\subsubsection{${title}}\n${}',
  },
  {
    prefix: 'para',
    label: 'Paragraph',
    category: 'Structure',
    mode: 'text',
    body: '\\paragraph{${title}} ${}',
  },
  // Lists
  {
    prefix: 'item',
    label: 'Bulleted list',
    category: 'Lists',
    mode: 'text',
    body: env('itemize', `${T}\\item \${}`),
  },
  {
    prefix: 'enum',
    label: 'Numbered list',
    category: 'Lists',
    mode: 'text',
    body: env('enumerate', `${T}\\item \${}`),
  },
  {
    prefix: 'desc',
    label: 'Description list',
    category: 'Lists',
    mode: 'text',
    body: env('description', `${T}\\item[\${term}] \${}`),
  },
  // Floats
  {
    prefix: 'fig',
    label: 'Figure',
    category: 'Floats',
    mode: 'text',
    body: env(
      'figure',
      `${T}\\centering\n${T}\\includegraphics[width=\${0.8}\\linewidth]{\${file}}\n${T}\\caption{\${caption}}\n${T}\\label{fig:\${label}}`,
      '[htbp]',
    ),
  },
  {
    prefix: 'figs',
    label: 'Two side-by-side sub-figures',
    category: 'Floats',
    mode: 'text',
    body: env(
      'figure',
      `${T}\\centering\n${T}\\begin{subfigure}{0.48\\linewidth}\n${T}${T}\\includegraphics[width=\\linewidth]{\${a}}\n${T}${T}\\caption{\${A}}\n${T}${T}\\label{fig:\${la}}\n${T}\\end{subfigure}\\hfill\n${T}\\begin{subfigure}{0.48\\linewidth}\n${T}${T}\\includegraphics[width=\\linewidth]{\${b}}\n${T}${T}\\caption{\${B}}\n${T}${T}\\label{fig:\${lb}}\n${T}\\end{subfigure}\n${T}\\caption{\${caption}}`,
      '[htbp]',
    ),
  },
  {
    prefix: 'tab',
    label: 'Table (booktabs)',
    category: 'Floats',
    mode: 'text',
    body: env(
      'table',
      `${T}\\centering\n${T}\\caption{\${caption}}\n${T}\\label{tab:\${label}}\n${T}\\begin{tabular}{\${lcc}}\n${T}${T}\\toprule\n${T}${T}\${Name} & \${A} & \${B} \\\\\n${T}${T}\\midrule\n${T}${T}\${} &  &  \\\\\n${T}${T}\\bottomrule\n${T}\\end{tabular}`,
      '[htbp]',
    ),
  },
  {
    prefix: 'tabular',
    label: 'Tabular',
    category: 'Floats',
    mode: 'text',
    body: env('tabular', `${T}\${A} & \${B} \\\\\n${T}\\hline\n${T}\${} &  \\\\`, '{${ll}}'),
  },
  {
    prefix: 'algo',
    label: 'Algorithm (algpseudocode)',
    category: 'Floats',
    mode: 'text',
    body: env(
      'algorithm',
      `${T}\\caption{\${Name}}\n${T}\\label{alg:\${label}}\n${T}\\begin{algorithmic}[1]\n${T}${T}\\Require \${input}\n${T}${T}\\Ensure \${output}\n${T}${T}\\State \${}\n${T}\\end{algorithmic}`,
      '[htbp]',
    ),
  },
  {
    prefix: 'lst',
    label: 'Code listing',
    category: 'Floats',
    mode: 'text',
    body: env('lstlisting', '${code}', '[language=${Python}, caption={${caption}}]'),
  },
  {
    prefix: 'tikz',
    label: 'TikZ picture',
    category: 'Floats',
    mode: 'text',
    body: env(
      'tikzpicture',
      `${T}\\draw[->] (0,0) -- (\${2},0) node[right] {$x$};\n${T}\\draw[->] (0,0) -- (0,\${2}) node[above] {$y$};\n${T}\${}`,
      '[scale=${1}]',
    ),
  },
  {
    prefix: 'plot',
    label: 'pgfplots plot',
    category: 'Floats',
    mode: 'text',
    body: env(
      'tikzpicture',
      `${T}\\begin{axis}[xlabel=$x$, ylabel=$y$, grid=major]\n${T}${T}\\addplot[domain=\${-2:2}, samples=\${100}] {\${x^2}};\n${T}\\end{axis}`,
    ),
  },
  {
    prefix: 'frame',
    label: 'Beamer frame',
    category: 'Floats',
    mode: 'text',
    body: env('frame', `${T}\${}`, '{${Title}}'),
  },
  {
    prefix: 'mini',
    label: 'Minipage',
    category: 'Floats',
    mode: 'text',
    body: env('minipage', `${T}\${}`, '{${0.48}\\linewidth}'),
  },
  // Display math
  {
    prefix: 'eq',
    label: 'Numbered equation',
    category: 'Math blocks',
    mode: 'text',
    body: env('equation', `${T}\${}\n${T}\\label{eq:\${label}}`),
  },
  {
    prefix: 'eq*',
    label: 'Unnumbered equation',
    category: 'Math blocks',
    mode: 'text',
    body: '\\[\n\t${}\n\\]',
  },
  {
    prefix: 'ali',
    label: 'align',
    category: 'Math blocks',
    mode: 'text',
    body: env('align', `${T}\${a} &= \${b} \\\\\n${T}&= \${c}`),
  },
  {
    prefix: 'ali*',
    label: 'align*',
    category: 'Math blocks',
    mode: 'text',
    body: env('align*', `${T}\${a} &= \${b} \\\\\n${T}&= \${c}`),
  },
  {
    prefix: 'gat',
    label: 'gather*',
    category: 'Math blocks',
    mode: 'text',
    body: env('gather*', `${T}\${}`),
  },
  // Theorems
  ...(
    [
      ['thm', 'theorem', 'thm'],
      ['lem', 'lemma', 'lem'],
      ['prop', 'proposition', 'prop'],
      ['cor', 'corollary', 'cor'],
      ['defn', 'definition', 'def'],
      ['rem', 'remark', 'rem'],
      ['exa', 'example', 'ex'],
    ] as const
  ).map(
    ([prefix, name, lp]): WordSnippet => ({
      prefix,
      label: name[0]!.toUpperCase() + name.slice(1),
      category: 'Theorems',
      mode: 'text',
      body: env(name, `${T}\${}\n${T}\\label{${lp}:\${label}}`, '[${title}]'),
    }),
  ),
  {
    prefix: 'prf',
    label: 'Proof',
    category: 'Theorems',
    mode: 'text',
    body: env('proof', `${T}\${}`),
  },
  {
    prefix: 'thmprf',
    label: 'Theorem + proof',
    category: 'Theorems',
    mode: 'text',
    body: `${env('theorem', `${T}\${statement}\n${T}\\label{thm:\${label}}`)}\n${env('proof', `${T}\${}`)}`,
  },
  // Inline text helpers
  { prefix: 'fn', label: 'Footnote', category: 'Inline', mode: 'text', body: '\\footnote{${}}' },
  {
    prefix: 'href',
    label: 'Hyperlink',
    category: 'Inline',
    mode: 'text',
    body: '\\href{${url}}{${text}}',
  },
  { prefix: 'todo', label: 'TODO note', category: 'Inline', mode: 'text', body: '\\todo{${note}}' },
  // Math (inside math mode)
  {
    prefix: 'frac',
    label: 'Fraction',
    category: 'Math',
    mode: 'math',
    body: '\\frac{${num}}{${den}}',
  },
  {
    prefix: 'sum',
    label: 'Sum with limits',
    category: 'Math',
    mode: 'math',
    body: '\\sum_{${i=1}}^{${n}} ${}',
  },
  {
    prefix: 'prod',
    label: 'Product with limits',
    category: 'Math',
    mode: 'math',
    body: '\\prod_{${i=1}}^{${n}} ${}',
  },
  {
    prefix: 'int',
    label: 'Integral',
    category: 'Math',
    mode: 'math',
    body: '\\int_{${a}}^{${b}} ${f(x)} \\,\\mathrm{d}${x}',
  },
  {
    prefix: 'iint',
    label: 'Double integral',
    category: 'Math',
    mode: 'math',
    body: '\\iint_{${D}} ${f} \\,\\mathrm{d}${A}',
  },
  {
    prefix: 'lim',
    label: 'Limit',
    category: 'Math',
    mode: 'math',
    body: '\\lim_{${n} \\to ${\\infty}} ${}',
  },
  {
    prefix: 'dv',
    label: 'Derivative d/dx',
    category: 'Math',
    mode: 'math',
    body: '\\frac{\\mathrm{d}${f}}{\\mathrm{d}${x}}',
  },
  {
    prefix: 'pdv',
    label: 'Partial derivative ∂/∂x',
    category: 'Math',
    mode: 'math',
    body: '\\frac{\\partial ${f}}{\\partial ${x}}',
  },
  {
    prefix: 'pmat',
    label: '2×2 matrix ( )',
    category: 'Math',
    mode: 'math',
    body: env('pmatrix', `${T}\${a} & \${b} \\\\\n${T}\${c} & \${d}`),
  },
  {
    prefix: 'bmat',
    label: '2×2 matrix [ ]',
    category: 'Math',
    mode: 'math',
    body: env('bmatrix', `${T}\${a} & \${b} \\\\\n${T}\${c} & \${d}`),
  },
  {
    prefix: 'vmat',
    label: 'Determinant',
    category: 'Math',
    mode: 'math',
    body: env('vmatrix', `${T}\${a} & \${b} \\\\\n${T}\${c} & \${d}`),
  },
  {
    prefix: 'nmat',
    label: 'n×n matrix with dots',
    category: 'Math',
    mode: 'math',
    body: env(
      'pmatrix',
      `${T}\${a}_{11} & \\cdots & \${a}_{1n} \\\\\n${T}\\vdots & \\ddots & \\vdots \\\\\n${T}\${a}_{m1} & \\cdots & \${a}_{mn}`,
    ),
  },
  {
    prefix: 'case',
    label: 'Piecewise (cases)',
    category: 'Math',
    mode: 'math',
    body: env('cases', `${T}\${a} & \\text{if } \${x > 0} \\\\\n${T}\${b} & \\text{otherwise}`),
  },
  {
    prefix: 'set',
    label: 'Set builder { x | … }',
    category: 'Math',
    mode: 'math',
    body: '\\left\\\\{ ${x} \\,\\middle|\\, ${x > 0} \\right\\\\}',
  },
  {
    prefix: 'norm',
    label: 'Norm ‖x‖',
    category: 'Math',
    mode: 'math',
    body: '\\left\\lVert ${x} \\right\\rVert',
  },
  {
    prefix: 'abs',
    label: 'Absolute value |x|',
    category: 'Math',
    mode: 'math',
    body: '\\left| ${x} \\right|',
  },
  {
    prefix: 'inner',
    label: 'Inner product ⟨x, y⟩',
    category: 'Math',
    mode: 'math',
    body: '\\langle ${x}, ${y} \\rangle',
  },
  {
    prefix: 'ceil',
    label: 'Ceiling ⌈x⌉',
    category: 'Math',
    mode: 'math',
    body: '\\left\\lceil ${x} \\right\\rceil',
  },
  {
    prefix: 'floor',
    label: 'Floor ⌊x⌋',
    category: 'Math',
    mode: 'math',
    body: '\\left\\lfloor ${x} \\right\\rfloor',
  },
  {
    prefix: 'bin',
    label: 'Binomial (n k)',
    category: 'Math',
    mode: 'math',
    body: '\\binom{${n}}{${k}}',
  },
  {
    prefix: 'taylor',
    label: 'Taylor series',
    category: 'Math',
    mode: 'math',
    body: '\\sum_{${k}=0}^{\\infty} \\frac{${f}^{(${k})}(${a})}{${k}!} (${x} - ${a})^{${k}}',
  },
  {
    prefix: 'seq',
    label: 'Sequence (a_n)',
    category: 'Math',
    mode: 'math',
    body: '(${a}_{${n}})_{${n} \\in \\mathbb{N}}',
  },
  {
    prefix: 'fn',
    label: 'Function f: A → B',
    category: 'Math',
    mode: 'math',
    body: '${f} \\colon ${A} \\to ${B}',
  },
  {
    prefix: 'eps',
    label: 'ε–δ definition',
    category: 'Math',
    mode: 'math',
    body: '\\forall \\varepsilon > 0\\ \\exists \\delta > 0 : |${x} - ${a}| < \\delta \\implies |f(${x}) - f(${a})| < \\varepsilon',
  },
  { prefix: 'O', label: 'Big-O', category: 'Math', mode: 'math', body: '\\mathcal{O}(${n})' },
];
