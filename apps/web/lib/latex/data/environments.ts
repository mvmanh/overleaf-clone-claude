/**
 * Environment catalogue. `body` is the snippet placed between \begin{…}
 * and \end{…} (CodeMirror snippet syntax); `args` follows \begin{name}.
 */
export interface EnvironmentSpec {
  name: string;
  args?: string;
  body: string;
  detail: string;
  math?: boolean;
  pkg?: string;
  /** Requires a \newtheorem definition (theorem-like). */
  theoremLike?: boolean;
  rank?: number;
}

const T = '\t';

export const ENVIRONMENTS: readonly EnvironmentSpec[] = [
  // Lists
  { name: 'itemize', body: `${T}\\item \${}`, detail: 'bulleted list', rank: 5 },
  { name: 'enumerate', body: `${T}\\item \${}`, detail: 'numbered list', rank: 5 },
  {
    name: 'description',
    body: `${T}\\item[\${term}] \${description}`,
    detail: 'labelled list',
    rank: 2,
  },
  // Floats
  {
    name: 'figure',
    args: '[${htbp}]',
    body: `${T}\\centering\n${T}\\includegraphics[width=\${0.8}\\linewidth]{\${file}}\n${T}\\caption{\${caption}}\n${T}\\label{fig:\${label}}`,
    detail: 'figure with image, caption and label',
    rank: 5,
  },
  {
    name: 'table',
    args: '[${htbp}]',
    body: `${T}\\centering\n${T}\\caption{\${caption}}\n${T}\\label{tab:\${label}}\n${T}\\begin{tabular}{\${lcr}}\n${T}${T}\\toprule\n${T}${T}\${A} & \${B} & \${C} \\\\\n${T}${T}\\midrule\n${T}${T}\${} &  &  \\\\\n${T}${T}\\bottomrule\n${T}\\end{tabular}`,
    detail: 'table with booktabs rules',
    rank: 5,
  },
  {
    name: 'tabular',
    args: '{${lcr}}',
    body: `${T}\${A} & \${B} & \${C} \\\\\n${T}\\hline\n${T}\${} &  &  \\\\`,
    detail: 'table body',
    rank: 4,
  },
  {
    name: 'tabularx',
    args: '{\\linewidth}{${lX}}',
    body: `${T}\${A} & \${B} \\\\`,
    detail: 'full-width table',
    pkg: 'tabularx',
  },
  {
    name: 'longtable',
    args: '{${lcr}}',
    body: `${T}\${A} & \${B} & \${C} \\\\`,
    detail: 'multi-page table',
    pkg: 'longtable',
  },
  {
    name: 'subfigure',
    args: '{${0.48}\\linewidth}',
    body: `${T}\\centering\n${T}\\includegraphics[width=\\linewidth]{\${file}}\n${T}\\caption{\${caption}}\n${T}\\label{fig:\${label}}`,
    detail: 'sub-figure (subcaption)',
    pkg: 'subcaption',
  },
  {
    name: 'wrapfigure',
    args: '{${r}}{${0.4}\\linewidth}',
    body: `${T}\\centering\n${T}\\includegraphics[width=\\linewidth]{\${file}}\n${T}\\caption{\${caption}}`,
    detail: 'text-wrapped figure',
    pkg: 'wrapfig',
  },
  // Display math
  {
    name: 'equation',
    body: `${T}\${}\n${T}\\label{eq:\${label}}`,
    detail: 'numbered equation',
    math: true,
    rank: 5,
  },
  { name: 'equation*', body: `${T}\${}`, detail: 'unnumbered equation', math: true, rank: 4 },
  {
    name: 'align',
    body: `${T}\${a} &= \${b} \\\\\n${T}&= \${c}`,
    detail: 'aligned equations (amsmath)',
    math: true,
    pkg: 'amsmath',
    rank: 5,
  },
  {
    name: 'align*',
    body: `${T}\${a} &= \${b} \\\\\n${T}&= \${c}`,
    detail: 'aligned, unnumbered (amsmath)',
    math: true,
    pkg: 'amsmath',
    rank: 5,
  },
  {
    name: 'gather',
    body: `${T}\${a} \\\\\n${T}\${b}`,
    detail: 'centred equations (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'gather*',
    body: `${T}\${a} \\\\\n${T}\${b}`,
    detail: 'centred, unnumbered (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'multline',
    body: `${T}\${first} \\\\\n${T}\${last}`,
    detail: 'long equation over lines (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'flalign',
    body: `${T}\${a} &= \${b}`,
    detail: 'flush aligned (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'alignat',
    args: '{${2}}',
    body: `${T}\${a} &= \${b} &\\quad \${c} &= \${d}`,
    detail: 'aligned columns (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'subequations',
    body: `${T}\\begin{align}\n${T}${T}\${}\n${T}\\end{align}`,
    detail: 'numbered (1a), (1b)… (amsmath)',
    pkg: 'amsmath',
  },
  // Inner math
  {
    name: 'cases',
    body: `${T}\${value} & \\text{if } \${condition} \\\\\n${T}\${value} & \\text{otherwise}`,
    detail: 'piecewise definition (amsmath)',
    math: true,
    pkg: 'amsmath',
    rank: 4,
  },
  {
    name: 'dcases',
    body: `${T}\${value} & \\text{if } \${condition} \\\\\n${T}\${value} & \\text{otherwise}`,
    detail: 'display-style cases (mathtools)',
    math: true,
    pkg: 'mathtools',
  },
  {
    name: 'split',
    body: `${T}\${a} &= \${b} \\\\\n${T}&= \${c}`,
    detail: 'split one equation (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'aligned',
    body: `${T}\${a} &= \${b} \\\\\n${T}&= \${c}`,
    detail: 'aligned block inside math (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'gathered',
    body: `${T}\${a} \\\\\n${T}\${b}`,
    detail: 'gathered block inside math (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'pmatrix',
    body: `${T}\${a} & \${b} \\\\\n${T}\${c} & \${d}`,
    detail: '( matrix ) (amsmath)',
    math: true,
    pkg: 'amsmath',
    rank: 4,
  },
  {
    name: 'bmatrix',
    body: `${T}\${a} & \${b} \\\\\n${T}\${c} & \${d}`,
    detail: '[ matrix ] (amsmath)',
    math: true,
    pkg: 'amsmath',
    rank: 4,
  },
  {
    name: 'Bmatrix',
    body: `${T}\${a} & \${b} \\\\\n${T}\${c} & \${d}`,
    detail: '{ matrix } (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'vmatrix',
    body: `${T}\${a} & \${b} \\\\\n${T}\${c} & \${d}`,
    detail: '| determinant | (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'Vmatrix',
    body: `${T}\${a} & \${b} \\\\\n${T}\${c} & \${d}`,
    detail: '‖ matrix ‖ (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'matrix',
    body: `${T}\${a} & \${b} \\\\\n${T}\${c} & \${d}`,
    detail: 'matrix without delimiters (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'smallmatrix',
    body: `${T}\${a} & \${b} \\\\ \${c} & \${d}`,
    detail: 'inline matrix (amsmath)',
    math: true,
    pkg: 'amsmath',
  },
  {
    name: 'array',
    args: '{${cc}}',
    body: `${T}\${a} & \${b} \\\\\n${T}\${c} & \${d}`,
    detail: 'array (columns l, c, r)',
    math: true,
  },
  // Theorems
  ...[
    'theorem',
    'lemma',
    'proposition',
    'corollary',
    'definition',
    'example',
    'remark',
    'conjecture',
    'claim',
    'notation',
    'exercise',
  ].map(
    (name): EnvironmentSpec => ({
      name,
      args: '[${title}]',
      body: `${T}\${}\n${T}\\label{${name.slice(0, 3)}:\${label}}`,
      detail: `${name} (define with \\newtheorem)`,
      theoremLike: true,
      rank: name === 'theorem' || name === 'lemma' || name === 'definition' ? 4 : 2,
    }),
  ),
  {
    name: 'proof',
    body: `${T}\${}`,
    detail: 'proof ending with ∎ (amsthm)',
    pkg: 'amsthm',
    rank: 4,
  },
  // Text
  { name: 'abstract', body: `${T}\${}`, detail: 'abstract', rank: 3 },
  { name: 'center', body: `${T}\${}`, detail: 'centred text', rank: 2 },
  { name: 'flushleft', body: `${T}\${}`, detail: 'left-aligned text' },
  { name: 'flushright', body: `${T}\${}`, detail: 'right-aligned text' },
  { name: 'quote', body: `${T}\${}`, detail: 'short quotation' },
  { name: 'quotation', body: `${T}\${}`, detail: 'long quotation' },
  { name: 'verbatim', body: `\${}`, detail: 'verbatim text' },
  {
    name: 'minipage',
    args: '{${0.48}\\linewidth}',
    body: `${T}\${}`,
    detail: 'box of given width',
  },
  {
    name: 'multicols',
    args: '{${2}}',
    body: `${T}\${}`,
    detail: 'multiple columns',
    pkg: 'multicol',
  },
  { name: 'document', body: `\${}`, detail: 'document body' },
  { name: 'titlepage', body: `${T}\${}`, detail: 'custom title page' },
  {
    name: 'thebibliography',
    args: '{${99}}',
    body: `${T}\\bibitem{\${key}} \${Author, Title, Year.}`,
    detail: 'manual bibliography',
  },
  // Code & algorithms
  {
    name: 'lstlisting',
    args: '[language=${Python}, caption={${caption}}]',
    body: `\${code}`,
    detail: 'code listing',
    pkg: 'listings',
    rank: 3,
  },
  {
    name: 'algorithm',
    args: '[${htbp}]',
    body: `${T}\\caption{\${Name}}\n${T}\\label{alg:\${label}}\n${T}\\begin{algorithmic}[1]\n${T}${T}\\State \${}\n${T}\\end{algorithmic}`,
    detail: 'algorithm float',
    pkg: 'algorithm',
    rank: 3,
  },
  {
    name: 'algorithmic',
    args: '[${1}]',
    body: `${T}\\State \${}`,
    detail: 'pseudocode (algpseudocode)',
    pkg: 'algpseudocode',
  },
  {
    name: 'algorithm2e',
    args: '[${H}]',
    body: `${T}\\caption{\${Name}}\n${T}\\KwIn{\${input}}\n${T}\\KwOut{\${output}}\n${T}\${}`,
    detail: 'algorithm2e',
    pkg: 'algorithm2e',
  },
  // Graphics
  {
    name: 'tikzpicture',
    args: '[${scale=1}]',
    body: `${T}\\draw (\${0,0}) -- (\${1,1});`,
    detail: 'TikZ drawing',
    pkg: 'tikz',
    rank: 3,
  },
  {
    name: 'axis',
    args: '[xlabel=${$x$}, ylabel=${$y$}]',
    body: `${T}\\addplot[domain=\${-2:2}] {\${x^2}};`,
    detail: 'pgfplots axis',
    pkg: 'pgfplots',
  },
  {
    name: 'tikzcd',
    body: `${T}\${A} \\arrow[r, "\${f}"] & \${B}`,
    detail: 'commutative diagram',
    pkg: 'tikz-cd',
  },
  // Beamer
  {
    name: 'frame',
    args: '{${Title}}',
    body: `${T}\${}`,
    detail: 'slide (beamer)',
    pkg: 'class:beamer',
    rank: 2,
  },
  {
    name: 'columns',
    body: `${T}\\begin{column}{0.5\\textwidth}\n${T}${T}\${}\n${T}\\end{column}\n${T}\\begin{column}{0.5\\textwidth}\n${T}${T}\n${T}\\end{column}`,
    detail: 'two columns (beamer)',
    pkg: 'class:beamer',
  },
  {
    name: 'block',
    args: '{${Title}}',
    body: `${T}\${}`,
    detail: 'highlighted block (beamer)',
    pkg: 'class:beamer',
  },
];
